import { contactRunIdentityFilter } from '../_shared/automation-contact-identity.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.2';
import { InvalidAutomationReentry, readReentryCooldownDays, reentryCooldownDecision } from '../_shared/automation-reentry.ts';

interface ReentryFlow {
  readonly id: string;
  readonly organization_id: string;
  readonly reentry_policy: string;
  readonly trigger_config?: Readonly<Record<string, unknown>> | null;
}
interface ReentrySubject {
  readonly type: string;
  readonly id: string | null;
  readonly phoneKey?: string | null;
  readonly email?: string | null;
  readonly now: Date;
}

export async function checkAutomationReentry(db: SupabaseClient, flow: ReentryFlow, subject: ReentrySubject) {
  if (flow.reentry_policy !== 'after_completion') return { allowed: true, eligibleAt: null };
  const days = readReentryCooldownDays(flow.trigger_config?.reentry_cooldown_days);
  if (days === 0) return { allowed: true, eligibleAt: null };
  const contactFilter = subject.type === 'contact' ? contactRunIdentityFilter(subject) : null;
  if (!contactFilter && !subject.id) throw new InvalidAutomationReentry('Não foi possível identificar o registo para verificar a reentrada.');
  let query = db.from('automation_runs').select('completed_at')
    .eq('organization_id', flow.organization_id).eq('flow_id', flow.id).eq('subject_type', subject.type)
    .in('status', ['completed', 'failed', 'cancelled']).not('completed_at', 'is', null)
    .or('context->>__test.is.null,context->>__test.neq.true');
  query = contactFilter ? contactFilter.insensitive ? query.ilike(contactFilter.column, contactFilter.value) : query.eq(contactFilter.column, contactFilter.value) : query.eq('subject_id', subject.id);
  const { data: latest, error } = await query.order('completed_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new InvalidAutomationReentry('Não foi possível verificar o intervalo de reentrada.');
  return reentryCooldownDecision(days, latest?.completed_at, subject.now);
}
