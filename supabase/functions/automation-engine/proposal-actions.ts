import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.2';
import { InvalidCrmAction, type CrmActionInput, type CrmActionOutcome } from './crm-actions.ts';

export function proposalExpiryDecision(status: string, validUntil: string | null, today: string): 'expire' | 'already_expired' {
  if (status === 'expired') return 'already_expired';
  if (status !== 'draft' && status !== 'sent') throw new InvalidCrmAction('Só propostas em rascunho ou enviadas podem expirar automaticamente.');
  if (!validUntil || !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) throw new InvalidCrmAction('A proposta não tem uma data de validade explícita.');
  if (validUntil >= today) throw new InvalidCrmAction('A proposta ainda está dentro da validade.');
  return 'expire';
}

export async function executeProposalAction(db: SupabaseClient, input: CrmActionInput): Promise<CrmActionOutcome | null> {
  if (input.type !== 'mark_proposal_expired') return null;
  if (input.run.subject_type !== 'proposal' || !input.run.subject_id || !input.node_id) {
    return { kind: 'fail', error: 'A expiração exige uma proposta e um passo persistidos.' };
  }
  const { data: proposal, error: readError } = await db.from('proposals').select('status,valid_until')
    .eq('id', input.run.subject_id).eq('organization_id', input.run.organization_id).maybeSingle();
  if (readError || !proposal) return { kind: 'fail', error: 'Proposta não encontrada nesta organização.' };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(input.now ?? new Date());
  try { proposalExpiryDecision(proposal.status, proposal.valid_until, today); }
  catch (error) {
    if (error instanceof InvalidCrmAction) return { kind: 'fail', error: error.message };
    throw error;
  }
  const { data, error } = await db.rpc('automation_expire_proposal', {
    p_org_id: input.run.organization_id, p_run_id: input.run.id, p_node_id: input.node_id,
  });
  if (error || !data) return { kind: 'fail', error: `Expirar proposta falhou: ${error?.message ?? 'sem resultado'}` };
  return { kind: 'next', detail: data, context: { ...input.run.context, status: 'expired' } };
}
