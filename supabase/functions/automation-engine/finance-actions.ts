import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.2';
import type { CrmActionInput } from './crm-actions.ts';

export type FinanceActionOutcome =
  | { readonly kind: 'next'; readonly branch?: 'approval_required'; readonly detail: Record<string, unknown>; readonly context?: Record<string, unknown> }
  | { readonly kind: 'fail'; readonly error: string };

const requestKinds: Readonly<Record<string, string>> = {
  request_issue_invoice: 'issue_invoice', request_issue_receipt: 'issue_receipt',
  request_sale_status: 'change_sale_status', request_billing_dispute: 'mark_billing_disputed',
  request_service_suspension: 'suspend_recurring_service',
};
export function financialRequest(type: string, config: Readonly<Record<string, unknown>>): { kind: string; details: Record<string, unknown> } | null {
  const kind = requestKinds[type];
  if (!kind) return null;
  const reason = typeof config.reason === 'string' ? config.reason.trim() : '';
  if (!reason) throw new InvalidFinancialAction('Explique o motivo do pedido financeiro.');
  if (reason.length > 2000) throw new InvalidFinancialAction('O motivo deve ter no máximo 2000 caracteres.');
  const desired = typeof config.target_status === 'string' ? config.target_status : null;
  if (kind === 'change_sale_status' && !['pending', 'in_progress', 'delivered', 'cancelled'].includes(desired ?? '')) {
    throw new InvalidFinancialAction('Escolha um estado de venda suportado para revisão.');
  }
  return { kind, details: { reason, ...(desired ? { target_status: desired } : {}) } };
}
export class InvalidFinancialAction extends Error {}

export async function executeFinanceAction(db: SupabaseClient, input: CrmActionInput): Promise<FinanceActionOutcome | null> {
  const { type, config, run } = input;
  try {
    if (type === 'create_sale_from_proposal') {
      if (run.subject_type !== 'proposal' || !run.subject_id) throw new InvalidFinancialAction('Esta ação exige uma proposta aceite.');
      const { data, error } = await db.rpc('automation_create_pending_sale', {
        p_organization_id: run.organization_id, p_proposal_id: run.subject_id,
      });
      if (error || !data) throw new InvalidFinancialAction(`Criar venda pendente falhou: ${error?.message ?? 'sem venda devolvida'}`);
      const { data: sale, error: readError } = await db.from('sales').select('id,status').eq('id', data).eq('organization_id', run.organization_id).maybeSingle();
      if (readError || !sale) throw new InvalidFinancialAction('A venda foi preparada, mas não foi possível confirmar o estado. Consulte a ficha antes de repetir.');
      return { kind: 'next', detail: { venda_id: sale.id, estado: sale.status, aprovacao: sale.status === 'pending' ? 'necessária' : 'venda já existente' }, context: { ...run.context, venda_id: sale.id, __action_target: { type: 'sale', id: sale.id } } };
    }
    const request = financialRequest(type, config);
    if (!request) return null;
    if (run.subject_type !== 'sale' || !run.subject_id) throw new InvalidFinancialAction('O pedido financeiro exige uma venda desta organização.');
    const { data, error } = await db.rpc('automation_request_financial_action', {
      p_run_id: run.id, p_node_id: String(config.__node_id ?? ''), p_kind: request.kind, p_details: request.details,
    });
    if (error || !data) throw new InvalidFinancialAction(`Criar pedido financeiro falhou: ${error?.message ?? 'sem pedido devolvido'}`);
    return { kind: 'next', branch: 'approval_required', detail: { pedido_id: data, estado: 'pending', emitido: false } };
  } catch (error) {
    if (error instanceof InvalidFinancialAction) return { kind: 'fail', error: error.message };
    throw error;
  }
}
