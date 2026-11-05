import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.57.2';
import { scheduledOccurrence, recordDateOccurrence } from './calendar.ts';

const tables: Readonly<Record<string, string>> = { lead: 'leads', client: 'crm_clients', sale: 'sales', proposal: 'proposals' };
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

serve(async (req: Request): Promise<Response> => {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const db = createClient(url, key, { auth: { persistSession: false } });
  const secret = req.headers.get('x-automation-secret');
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  let authorized = key.length > 0 && bearer === key;
  if (!authorized && secret) {
    const { data, error } = await db.rpc('verify_automation_secret', { p_secret: secret });
    authorized = !error && data === true;
  }
  if (!authorized) return response({ error: 'Não autorizado' }, 401);
  const now = new Date();
  const stopAt = now.getTime() + 50_000;
  let processed = 0;
  const failures: Array<{ flow: string; error: string }> = [];
  try {
    const { data: flows, error } = await db.from('automation_flows')
      .select('id,organization_id,trigger_type,trigger_config').eq('status', 'active')
      .in('trigger_type', ['scheduled', 'record_date']);
    if (error) throw error;
    for (const flow of flows ?? []) {
      try {
        const config = isRecord(flow.trigger_config) ? flow.trigger_config : {};
        const entity = String(config.entity ?? 'lead');
        const table = tables[entity];
        if (!table) throw new Error('Entidade não suportada na agenda.');
        const scheduled = flow.trigger_type === 'scheduled' ? scheduledOccurrence(config, now) : null;
        if (flow.trigger_type === 'scheduled' && !scheduled) continue;
        for (let offset = 0; ; offset += 500) {
          const { data: records, error: readError } = await db.from(table).select('*')
            .eq('organization_id', flow.organization_id).order('id').range(offset, offset + 499);
          if (readError) throw readError;
          for (const record of records ?? []) {
            if (Date.now() >= stopAt) return response({ processed, failures, more_pending: true });
            const occurrence = scheduled ?? recordDateOccurrence(config, record, now);
            if (!occurrence) continue;
            const occurrenceKey = `${record.id}:${occurrence}`;
            const { data: claimed, error: claimError } = await db.rpc('claim_automation_schedule_occurrence', {
              p_flow_id: flow.id, p_organization_id: flow.organization_id,
              p_subject_id: record.id, p_occurrence_key: occurrenceKey,
            });
            if (claimError) throw claimError;
            if (!claimed) continue;
            let failure: string | null = null;
            try {
              const reply = await fetch(`${url}/functions/v1/automation-engine`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
                body: JSON.stringify({ action: 'enroll', deferred_execution: true, flow_id: flow.id, trigger_type: flow.trigger_type,
                  organization_id: flow.organization_id, subject_type: entity, record, occurrence_key: occurrenceKey }),
                signal: AbortSignal.timeout(30_000),
              });
              const result: unknown = await reply.json();
              const hasFailure = isRecord(result) && (typeof result.error === 'string' ||
                (Array.isArray(result.results) && result.results.some(item => isRecord(item) && typeof item.error === 'string')));
              if (!reply.ok || hasFailure) failure = 'Falha ao inscrever o registo no motor.';
            } catch (error) {
              failure = error instanceof Error ? error.message : 'Falha de comunicação com o motor.';
            }
            const { error: updateError } = await db.from('automation_schedule_occurrences').update({
              status: failure ? 'failed' :
 'completed', last_error: failure, updated_at: new Date().toISOString(),
            }).eq('flow_id', flow.id).eq('subject_id', record.id).eq('occurrence_key', occurrenceKey);
            if (updateError) throw updateError;
            if (failure) {
              failures.push({ flow: flow.id, error: failure });
              continue;
            }
            processed += 1;
          }
          if ((records?.length ?? 0) < 500) break;
        }
      } catch (error) {
        failures.push({ flow: flow.id, error: error instanceof Error ? error.message : 'Falha na agenda.' });
      }
    }
    return response({ processed, failures }, failures.length ? 207 : 200);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : 'Falha ao consultar agendas.' }, 500);
  }
});
