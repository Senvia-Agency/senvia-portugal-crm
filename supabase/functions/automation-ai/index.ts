import { createClient } from 'npm:@supabase/supabase-js@2.57.2';
import { z } from 'npm:zod@3.25.76';
import { paidQuota } from '../_shared/paid-quota.ts';
import { getAIConfigs, chatCompletionResilient } from '../otto/lib/ai.ts';
import { analyzeText, AnalysisError, inputSchema } from './analysis.ts';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-automation-secret',
  'Content-Type': 'application/json',
};
function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers });
}
const runSchema = z.object({ organization_id: z.string().uuid(), flow_id: z.string().uuid(), status: z.string(), context: z.record(z.unknown()).nullable() });
const graphSchema = z.object({ nodes: z.array(z.object({ id: z.string(), type: z.string() })) });
const snapshotSchema = z.object({ graph: graphSchema });
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey, { auth: { persistSession: false } });
  const bearer = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  let authorized = serviceKey.length > 0 && bearer === serviceKey;
  if (!authorized && request.headers.get('x-automation-secret')) {
    const { data } = await db.rpc('verify_automation_secret', { p_secret: request.headers.get('x-automation-secret') });
    authorized = data === true;
  }
  if (!authorized) return reply({ error: 'Não autorizado.' }, 401);
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 20000) return reply({ error: 'AI_INPUT_TOO_LARGE' }, 413);
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return reply({ error: 'AI_INVALID_INPUT' }, 400); }
    const input = inputSchema.safeParse(value);
    if (!input.success) return reply({ error: 'AI_INVALID_INPUT' }, 400);
    const { data: row, error } = await db.from('automation_runs').select('organization_id,flow_id,status,context').eq('id', input.data.run_id).maybeSingle();
    if (error) throw new AnalysisError('AI_RUN_READ_FAILED', 500);
    const run = runSchema.safeParse(row);
    if (!run.success || run.data.status !== 'running') return reply({ error: 'AI_RUN_UNAVAILABLE' }, 409);
    const snapshot = snapshotSchema.safeParse(run.data.context?.__flow_snapshot);
    let graph = snapshot.success ? snapshot.data.graph : null;
    if (!graph) {
      const { data: flow, error: flowError } = await db.from('automation_flows').select('graph')
        .eq('id', run.data.flow_id).eq('organization_id', run.data.organization_id).maybeSingle();
      if (flowError) throw new AnalysisError('AI_FLOW_READ_FAILED', 500);
      const parsed = graphSchema.safeParse(flow?.graph);
      graph = parsed.success ? parsed.data : null;
    }
    if (!graph?.nodes.some(node => node.id === input.data.node_id && node.type === `ai_${input.data.mode}`)) return reply({ error: 'AI_NODE_UNAVAILABLE' }, 409);
    if (!await paidQuota(db, `automation-ai:minute:${run.data.organization_id}`, 30, 60)
      || !await paidQuota(db, `automation-ai:day:${run.data.organization_id}`, 500, 86400)) return reply({ error: 'AI_QUOTA_EXCEEDED' }, 429);
    let configs;
    try { configs = getAIConfigs(); } catch { throw new AnalysisError('AI_NOT_CONFIGURED', 503); }
    let model = '';
    const result = await analyzeText(input.data, async messages => {
      const completion = await chatCompletionResilient(configs, { messages: [...messages], stream: false, temperature: 0 });
      model = completion.model;
      return completion.resp;
    });
    return reply({ ...result, model });
  } catch (error) {
    return reply({ error: error instanceof AnalysisError ? error.code : 'AI_UNAVAILABLE' }, error instanceof AnalysisError ? error.status : 502);
  }
});
