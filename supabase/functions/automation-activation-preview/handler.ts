import { scheduledOccurrence, recordDateOccurrence } from '../automation-schedule/calendar.ts';

export interface PreviewFlow {
  readonly organization_id: string;
  readonly trigger_type: string;
  readonly trigger_config: Readonly<Record<string, unknown>> | null;
}
export interface PreviewDependencies {
  readonly authorize: (request: Request, flowId: string) => Promise<PreviewFlow | Response>;
  readonly records: (flow: PreviewFlow, offset: number, limit: number) => Promise<readonly Record<string, unknown>[]>;
  readonly now: () => Date;
}
export const previewHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: previewHeaders });
}
export async function handleActivationPreview(request: Request, deps: PreviewDependencies): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { headers: previewHeaders });
  if (request.method !== 'POST') return response({ error: 'Use POST.' }, 405);
  let body: unknown;
  try { body = await request.json(); }
  catch { return response({ error: 'Pedido inválido.' }, 400); }
  if (typeof body !== 'object' || body === null || !('flow_id' in body) || typeof body.flow_id !== 'string'
    || !/^[0-9a-f-]{36}$/i.test(body.flow_id)) return response({ error: 'Automação inválida.' }, 400);
  try {
    const flow = await deps.authorize(request, body.flow_id);
    if (flow instanceof Response) return flow;
    if (!['scheduled', 'record_date'].includes(flow.trigger_type)) return response({ error: 'A prévia exige um gatilho agendado ou de data.' }, 400);
    const now = deps.now();
    const config = flow.trigger_config ?? {};
    const scheduled = flow.trigger_type === 'scheduled' ? scheduledOccurrence(config, now) : null;
    let count = 0;
    let scanned = 0;
    let truncated = false;
    if (flow.trigger_type !== 'scheduled' || scheduled) {
      const deadline = Date.now() + 25_000;
      for (let offset = 0; offset < 5000; offset += 500) {
        const rows = await deps.records(flow, offset, 500);
        for (const row of rows) {
          scanned += 1;
          if (scheduled || recordDateOccurrence(config, row, now)) count += 1;
        }
        if (rows.length < 500) break;
        if (offset === 4500) truncated = (await deps.records(flow, 5000, 1)).length > 0;
        if (Date.now() >= deadline) { truncated = true; break; }
      }
    }
    return response({ count, scanned, truncated, scope: 'calendar_candidates', as_of: now.toISOString() });
  } catch {
    return response({ error: 'Não foi possível calcular a prévia. Reveja a agenda e tente novamente.' }, 500);
  }
}
