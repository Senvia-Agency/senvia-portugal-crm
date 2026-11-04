import { z } from 'zod';

const flowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.enum(['draft', 'paused', 'active']),
  version: z.number().int().positive(),
  updated_at: z.string().datetime(),
});
const previewSchema = z.object({
  scanned_records: z.number().int().nonnegative(),
  eligible_records: z.number().int().nonnegative(),
  eligible_stages: z.number().int().nonnegative(),
  observed_local_date: z.string(),
  time_zone: z.string(),
  stages: z.array(z.object({
    stage_id: z.string(),
    node_id: z.string(),
    eligible_records: z.number().int().nonnegative(),
  })),
});
const preparedSchema = z.object({
  action: z.literal('prepared'),
  flow: flowSchema,
  preview: previewSchema,
  confirmation: z.object({
    preview_id: z.string().uuid(),
    snapshot_digest: z.string().regex(/^[0-9a-f]{64}$/i),
    expires_at: z.string().datetime(),
  }),
});
const activatedSchema = z.object({ action: z.literal('activated'), flow: flowSchema.extend({ status: z.literal('active') }) });
const errorSchema = z.object({ error: z.string().min(1), reason_code: z.string().optional() });

export type ConfiguredWorkflowActivationPreview = z.infer<typeof previewSchema>;
export type ConfiguredWorkflowActivationProof = Readonly<{
  previewId: string;
  snapshotDigest: string;
  expiresAt: string;
}>;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type ActivationRequest = Readonly<{ endpoint: string; accessToken: string; fetcher?: Fetcher; signal?: AbortSignal }>;
type PrepareInput = ActivationRequest & Readonly<{ flowId: string; version: number; updatedAt: string }>;

function headers(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
}

async function responseBody(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function activationError(body: unknown, fallback: string): string {
  const parsed = errorSchema.safeParse(body);
  if (!parsed.success) return fallback;
  const messages: Readonly<Record<string, string>> = {
    mfa_required: 'Confirme a autenticação de dois fatores antes de ativar.',
    admin_required: 'Apenas um administrador ativo pode ativar este fluxo.',
    module_disabled: 'O módulo necessário para este fluxo está desativado.',
    flow_stale: 'O fluxo mudou depois da prévia. Prepare uma nova revisão.',
    flow_not_activatable: 'O fluxo já não pode ser ativado neste estado.',
    graph_invalid: 'O grafo não corresponde às etapas configuradas.',
    preview_unavailable: 'Não foi possível calcular uma prévia segura.',
    activation_rejected: 'A confirmação expirou ou deixou de corresponder ao fluxo.',
  };
  return parsed.data.reason_code ? messages[parsed.data.reason_code] ?? parsed.data.error : parsed.data.error;
}

export function configuredWorkflowActivationEndpoint(supabaseUrl: unknown): string | null {
  const parsed = z.string().url().safeParse(supabaseUrl);
  return parsed.success
    ? `${parsed.data.replace(/\/$/, '')}/functions/v1/configured-workflow-activation`
    : null;
}

export async function prepareConfiguredWorkflowActivation(input: PrepareInput) {
  try {
    const response = await (input.fetcher ?? fetch)(input.endpoint, {
      method: 'POST',
      headers: headers(input.accessToken),
      body: JSON.stringify({
        action: 'prepare',
        flow_id: input.flowId,
        expected_version: input.version,
        expected_updated_at: input.updatedAt,
      }),
      signal: AbortSignal.any([...(input.signal ? [input.signal] : []), AbortSignal.timeout(60_000)]),
    });
    const body = await responseBody(response);
    const parsed = preparedSchema.safeParse(body);
    if (!response.ok || !parsed.success) {
      return { ok: false as const, message: activationError(body, 'Não foi possível preparar a prévia de ativação.') };
    }
    return {
      ok: true as const,
      preview: parsed.data.preview,
      proof: {
        previewId: parsed.data.confirmation.preview_id,
        snapshotDigest: parsed.data.confirmation.snapshot_digest,
        expiresAt: parsed.data.confirmation.expires_at,
      } satisfies ConfiguredWorkflowActivationProof,
    };
  } catch {
    return { ok: false as const, message: 'Não foi possível preparar a prévia de ativação.' };
  }
}

export async function activateConfiguredWorkflow(
  input: ActivationRequest & ConfiguredWorkflowActivationProof & Readonly<{ flowId: string }>,
) {
  try {
    const response = await (input.fetcher ?? fetch)(input.endpoint, {
      method: 'POST',
      headers: headers(input.accessToken),
      body: JSON.stringify({
        action: 'activate',
        flow_id: input.flowId,
        preview_id: input.previewId,
        snapshot_digest: input.snapshotDigest,
      }),
      signal: AbortSignal.any([...(input.signal ? [input.signal] : []), AbortSignal.timeout(60_000)]),
    });
    const body = await responseBody(response);
    const parsed = activatedSchema.safeParse(body);
    if (!response.ok || !parsed.success) {
      return { ok: false as const, kind: 'rejected' as const, message: activationError(body, 'A ativação foi recusada.') };
    }
    return { ok: true as const, flow: parsed.data.flow };
  } catch {
    return {
      ok: false as const,
      kind: 'unknown' as const,
      message: 'A resposta perdeu-se depois da confirmação. Atualize o fluxo antes de tentar novamente.',
    };
  }
}
