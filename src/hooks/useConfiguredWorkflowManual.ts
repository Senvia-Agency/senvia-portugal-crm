import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { useAuth } from '@/contexts/AuthContext';

const preparedSchema = z.object({
  confirmation_id: z.string().uuid(),
  expires_at: z.string().datetime(),
});

const executionSummarySchema = z.object({
  scanned: z.number().int().nonnegative(),
  started: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errors: z.array(z.string()),
});

const errorSchema = z.object({ error: z.string().min(1) });

export type ConfiguredWorkflowExecutionSummary = z.infer<typeof executionSummarySchema>;

export type ConfiguredWorkflowManualState =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'preparing' }>
  | Readonly<{ status: 'awaiting_confirmation'; expiresAt: string }>
  | Readonly<{ status: 'running' }>
  | Readonly<{ status: 'completed'; summary: ConfiguredWorkflowExecutionSummary }>
  | Readonly<{ status: 'failed'; phase: 'prepare' | 'run'; message: string }>
  | Readonly<{ status: 'unknown'; message: string }>;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ManualRequest = Readonly<{
  endpoint: string;
  flowId: string;
  accessToken: string;
  fetcher?: Fetcher;
  signal?: AbortSignal;
}>;

type PrepareResult =
  | Readonly<{ ok: true; confirmationId: string; expiresAt: string }>
  | Readonly<{ ok: false; message: string }>;

type RunResult =
  | Readonly<{ ok: true; summary: ConfiguredWorkflowExecutionSummary }>
  | Readonly<{ ok: false; kind: 'rejected' | 'unknown'; message: string }>;

const PREPARE_FAILURE = 'Não foi possível preparar a confirmação. Tente novamente.';
const UNKNOWN_RESULT = 'Não foi possível confirmar o resultado. Consulte as execuções antes de tentar novamente.';

function requestHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
}

async function readResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function prepareConfiguredWorkflowManual(request: ManualRequest): Promise<PrepareResult> {
  try {
    const response = await (request.fetcher ?? fetch)(request.endpoint, {
      method: 'POST',
      headers: requestHeaders(request.accessToken),
      body: JSON.stringify({ action: 'prepare_configured_manual', flow_id: request.flowId }),
      signal: AbortSignal.any([...(request.signal ? [request.signal] : []), AbortSignal.timeout(60_000)]),
    });
    const body = await readResponseBody(response);
    const error = errorSchema.safeParse(body);
    if (error.success) return { ok: false, message: error.data.error };
    const prepared = preparedSchema.safeParse(body);
    if (!response.ok || !prepared.success) return { ok: false, message: PREPARE_FAILURE };
    return {
      ok: true,
      confirmationId: prepared.data.confirmation_id,
      expiresAt: prepared.data.expires_at,
    };
  } catch {
    return { ok: false, message: PREPARE_FAILURE };
  }
}

export async function runConfiguredWorkflowManual(
  request: ManualRequest & Readonly<{ confirmationId: string }>,
): Promise<RunResult> {
  try {
    const response = await (request.fetcher ?? fetch)(request.endpoint, {
      method: 'POST',
      headers: requestHeaders(request.accessToken),
      body: JSON.stringify({
        action: 'run_configured_manual',
        flow_id: request.flowId,
        confirmation_id: request.confirmationId,
      }),
      signal: AbortSignal.any([...(request.signal ? [request.signal] : []), AbortSignal.timeout(60_000)]),
    });
    const body = await readResponseBody(response);
    const error = errorSchema.safeParse(body);
    if (error.success && response.status < 500) {
      return { ok: false, kind: 'rejected', message: error.data.error };
    }
    const summary = executionSummarySchema.safeParse(body);
    if (!response.ok || !summary.success) {
      return { ok: false, kind: 'unknown', message: UNKNOWN_RESULT };
    }
    return { ok: true, summary: summary.data };
  } catch {
    return { ok: false, kind: 'unknown', message: UNKNOWN_RESULT };
  }
}

export function isConfiguredManualProofExpired(expiresAt: string, now = Date.now()): boolean {
  const expiry = Date.parse(expiresAt);
  return !Number.isFinite(expiry) || expiry <= now;
}

function automationEngineEndpoint(): string | null {
  const parsed = z.string().url().safeParse(import.meta.env.VITE_SUPABASE_URL);
  if (!parsed.success) return null;
  return `${parsed.data.replace(/\/$/, '')}/functions/v1/automation-engine`;
}

export function useConfiguredWorkflowManual(flowId: string) {
  const { session, organization } = useAuth();
  const [state, setState] = useState<ConfiguredWorkflowManualState>({ status: 'idle' });
  const confirmationRef = useRef<Readonly<{ id: string; expiresAt: string }> | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const lifecycleRef = useRef(0);
  const accessToken = session?.access_token ?? null;
  const scope = session?.user.id && organization?.id
    ? `${session.user.id}:${organization.id}:${flowId}`
    : null;

  useEffect(() => {
    lifecycleRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = null;
    confirmationRef.current = null;
    setState({ status: 'idle' });
    return () => {
      lifecycleRef.current += 1;
      requestRef.current?.abort();
    };
  }, [scope]);

  const prepare = useCallback(async (): Promise<void> => {
    if (requestRef.current || state.status === 'preparing' || state.status === 'running' || state.status === 'unknown') return;
    const endpoint = automationEngineEndpoint();
    if (!endpoint || !accessToken || !scope || flowId.trim().length === 0) {
      setState({ status: 'failed', phase: 'prepare', message: 'Inicie sessão e selecione uma organização para executar o fluxo.' });
      return;
    }
    const generation = lifecycleRef.current;
    const controller = new AbortController();
    requestRef.current = controller;
    confirmationRef.current = null;
    setState({ status: 'preparing' });
    const result = await prepareConfiguredWorkflowManual({ endpoint, flowId, accessToken, signal: controller.signal });
    if (lifecycleRef.current !== generation || controller.signal.aborted) return;
    requestRef.current = null;
    if (result.ok === false) {
      setState({ status: 'failed', phase: 'prepare', message: result.message });
      return;
    }
    confirmationRef.current = { id: result.confirmationId, expiresAt: result.expiresAt };
    setState({ status: 'awaiting_confirmation', expiresAt: result.expiresAt });
  }, [accessToken, flowId, scope, state.status]);

  const cancelConfirmation = useCallback((): void => {
    if (state.status !== 'awaiting_confirmation') return;
    confirmationRef.current = null;
    setState({ status: 'idle' });
  }, [state.status]);

  const confirm = useCallback(async (): Promise<void> => {
    if (requestRef.current || state.status !== 'awaiting_confirmation') return;
    const endpoint = automationEngineEndpoint();
    const proof = confirmationRef.current;
    if (!proof || !endpoint || !accessToken || !scope) {
      confirmationRef.current = null;
      setState({ status: 'failed', phase: 'run', message: 'A confirmação deixou de estar disponível. Prepare uma nova execução.' });
      return;
    }
    if (isConfiguredManualProofExpired(proof.expiresAt)) {
      confirmationRef.current = null;
      setState({ status: 'failed', phase: 'run', message: 'A confirmação expirou. Prepare uma nova execução.' });
      return;
    }
    const generation = lifecycleRef.current;
    const controller = new AbortController();
    requestRef.current = controller;
    confirmationRef.current = null;
    setState({ status: 'running' });
    const result = await runConfiguredWorkflowManual({
      endpoint,
      flowId,
      confirmationId: proof.id,
      accessToken,
      signal: controller.signal,
    });
    if (lifecycleRef.current !== generation || controller.signal.aborted) return;
    requestRef.current = null;
    if (result.ok === true) {
      setState({ status: 'completed', summary: result.summary });
      return;
    }
    setState(result.kind === 'unknown'
      ? { status: 'unknown', message: result.message }
      : { status: 'failed', phase: 'run', message: result.message });
  }, [accessToken, flowId, scope, state.status]);

  return { state, prepare, confirm, cancelConfirmation } as const;
}
