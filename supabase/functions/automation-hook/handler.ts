export interface HookFlow {
  readonly id: string;
  readonly organization_id: string;
  readonly status: string;
  readonly trigger_type: string;
  readonly trigger_config: Readonly<Record<string, unknown>> | null;
}
export interface HookDependencies {
  readonly flow: (id: string) => Promise<HookFlow | null>;
  readonly adminDenial: (request: Request, organizationId: string) => Promise<Response | null>;
  readonly readHash: (flowId: string) => Promise<string | null>;
  readonly writeHash: (flowId: string, organizationId: string, hash: string) => Promise<void>;
  readonly enroll: (body: Record<string, unknown>) => Promise<unknown>;
}
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-senvia-hook-secret, x-event-id',
  'Content-Type': 'application/json',
};
function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers });
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export async function hashSecret(secret: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
function sameHash(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}
export function mapHookContact(payload: Readonly<Record<string, unknown>>, config: HookFlow['trigger_config']): Record<string, string> {
  const fields = record(config?.webhook_fields) ? config.webhook_fields : {};
  const mapped: Record<string, string> = {};
  for (const field of ['name', 'email', 'phone']) {
    const key = typeof fields[field] === 'string' ? fields[field] : field;
    const value = payload[key];
    if (typeof value === 'string' || typeof value === 'number') mapped[field] = String(value).trim().slice(0, 500);
  }
  if (!mapped.email && !mapped.phone) throw new Error('Indique email ou telefone no pedido.');
  return mapped;
}
export async function handleHook(request: Request, deps: HookDependencies): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return response({ error: 'Use POST.' }, 405);
  const url = new URL(request.url);
  const flowId = url.searchParams.get('flow_id');
  const action = url.searchParams.get('action') ?? 'receive';
  if (!flowId || !/^[0-9a-f-]{36}$/i.test(flowId)) return response({ error: 'Automação inválida.' }, 400);
  if (!['receive', 'rotate', 'test'].includes(action)) return response({ error: 'Ação inválida.' }, 400);
  try {
    const flow = await deps.flow(flowId);
    if (!flow || flow.trigger_type !== 'inbound_webhook') return response({ error: 'Webhook indisponível.' }, 404);
    if (action === 'rotate' || action === 'test') {
      const denied = await deps.adminDenial(request, flow.organization_id);
      if (denied) return denied;
    } else {
      if (flow.status !== 'active') return response({ error: 'Webhook indisponível.' }, 404);
      const supplied = request.headers.get('x-senvia-hook-secret') ?? '';
      if (supplied.length < 32 || supplied.length > 256) return response({ error: 'Não autorizado.' }, 401);
      const expected = await deps.readHash(flow.id);
      if (!expected || !sameHash(await hashSecret(supplied), expected)) return response({ error: 'Não autorizado.' }, 401);
    }
    if (action === 'rotate') {
      const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
      await deps.writeHash(flow.id, flow.organization_id, await hashSecret(secret));
      return response({ secret, header: 'x-senvia-hook-secret', flow_id: flow.id });
    }
    if (Number(request.headers.get('content-length') ?? 0) > 65536) return response({ error: 'Pedido demasiado grande.' }, 413);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 65536) return response({ error: 'Pedido demasiado grande.' }, 413);
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return response({ error: 'JSON inválido.' }, 400); }
    if (!record(payload)) return response({ error: 'Envie um objeto JSON.' }, 400);
    let contact: Record<string, string>;
    try { contact = mapHookContact(payload, flow.trigger_config); } catch (error) {
      return response({ error: error instanceof Error ? error.message : 'Dados inválidos.' }, 400);
    }
    if (action === 'test') return response({ preview: contact, executed: false });
    const eventId = request.headers.get('x-event-id');
    if (eventId && (eventId.length > 200 || !/^[\w.:-]+$/.test(eventId))) return response({ error: 'Identificador do evento inválido.' }, 400);
    const result = await deps.enroll({
      action: 'enroll', flow_id: flow.id, organization_id: flow.organization_id,
      trigger_type: 'inbound_webhook', subject_type: 'contact', record: contact,
      ...(eventId ? { occurrence_key: `hook:${flow.id}:${eventId}` } : {}),
    });
    return response({ accepted: true, result }, 202);
  } catch {
    return response({ error: 'Não foi possível processar o webhook.' }, 500);
  }
}
