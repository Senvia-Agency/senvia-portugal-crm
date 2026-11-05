import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.2';
import type { FailureSummary } from './handler.ts';

export async function settleFailureSummary(db: SupabaseClient, summary: FailureSummary, success: boolean, now: Date): Promise<void> {
  const status = success ? 'sent' : 'failed';
  const finishedAt = now.toISOString();
  const { data: settled, error } = await db.from('automation_failure_summary_recipients').update({
    status, finished_at: finishedAt,
    lease_until: new Date(now.getTime() + (success ? 0 : 15 * 60_000)).toISOString(),
  }).eq('owner_id', summary.owner_id).eq('organization_id', summary.organization_id).eq('summary_date', summary.summary_date)
    .eq('claim_token', summary.claim_token).eq('status', 'claimed').select('organization_id').maybeSingle();
  if (error) throw error;
  if (!settled || Array.isArray(settled) || settled.organization_id !== summary.organization_id) return;
  const { error: flowError } = await db.from('automation_failure_summary_claims').update({ status, finished_at: finishedAt })
    .in('flow_id', [...summary.flow_ids]).eq('organization_id', summary.organization_id).eq('summary_date', summary.summary_date);
  if (flowError) throw flowError;
}
