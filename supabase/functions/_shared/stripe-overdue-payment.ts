// Mensalidade do Senvia OS recusada pelo Stripe → pagamento "por receber" na
// venda da empresa cliente, dentro da Senvia Agency. Sem isto, uma cobrança
// falhada só marcava a empresa (payment_failed_at) e nunca aparecia no
// Financeiro > A receber: a Escolha Inteligente ficou em atraso a 25/11/2026
// sem ninguém ver.
//
// A linha leva o id da fatura do Stripe (índice único), por isso:
//   - novas tentativas falhadas da mesma fatura não criam linhas repetidas;
//   - quando a fatura é paga, o webhook e o reconciliador diário transformam
//     ESTA linha em "recebido" em vez de criarem uma segunda.

export const OVERDUE_NOTE_PREFIX = 'Stripe · cobrança recusada';

export type OverdueInvoice = {
  id: string;
  created: number;
  amount_due?: number | null;
  amount_remaining?: number | null;
  due_date?: number | null;
  period_start?: number | null;
  period_end?: number | null;
};

export type OverdueResult = 'created' | 'exists' | 'skipped';

const day = (unix?: number | null): string | null =>
  unix && unix > 0 ? new Date(unix * 1000).toISOString().slice(0, 10) : null;

/** Grava a fatura recusada como pagamento pendente. Idempotente pela fatura. */
export async function recordOverdueStripeInvoice(
  db: any,
  input: { agencyOrgId: string; saleId: string | null | undefined; invoice: OverdueInvoice },
): Promise<OverdueResult> {
  const { agencyOrgId, saleId, invoice } = input;
  const cents = invoice.amount_remaining ?? invoice.amount_due ?? 0;
  if (!saleId || !invoice?.id || !(cents > 0)) return 'skipped';

  const { data: existing, error: findError } = await db
    .from('sale_payments')
    .select('id')
    .eq('stripe_invoice_id', invoice.id)
    .limit(1);
  if (findError) throw new Error(`overdue lookup failed: ${findError.message}`);
  if (existing && existing.length > 0) return 'exists';

  const { error } = await db.from('sale_payments').insert({
    organization_id: agencyOrgId,
    sale_id: saleId,
    amount: Math.round(cents) / 100,
    // A data é a da cobrança: a lista "A receber" mostra-a em atraso a partir
    // do dia seguinte, que é quando a empresa já devia ter pago.
    payment_date: day(invoice.due_date) ?? day(invoice.created) ?? new Date().toISOString().slice(0, 10),
    status: 'pending',
    payment_method: 'card',
    stripe_invoice_id: invoice.id,
    billing_period_start: day(invoice.period_start),
    billing_period_end: day(invoice.period_end),
    notes: `${OVERDUE_NOTE_PREFIX} · ${invoice.id}`,
  });
  if (error) {
    // 23505: outra entrega do mesmo evento (ou o pagamento) gravou primeiro.
    if ((error as any).code === '23505') return 'exists';
    throw new Error(`overdue insert failed: ${error.message}`);
  }
  return 'created';
}

/** Linha pendente desta fatura, se existir (criada por uma cobrança recusada). */
export async function findPendingStripePayment(db: any, invoiceId: string): Promise<string | null> {
  if (!invoiceId) return null;
  const { data, error } = await db
    .from('sale_payments')
    .select('id')
    .eq('stripe_invoice_id', invoiceId)
    .eq('status', 'pending')
    .limit(1);
  if (error) throw new Error(`pending lookup failed: ${error.message}`);
  return data?.[0]?.id ?? null;
}

/**
 * Passa a linha pendente a "recebido" com os dados do pagamento. Só muda uma
 * linha que ainda esteja pendente: devolve false se outra execução já a fechou.
 */
export async function settlePendingStripePayment(
  db: any,
  paymentId: string,
  fields: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await db
    .from('sale_payments')
    .update({ ...fields, status: 'paid' })
    .eq('id', paymentId)
    .eq('status', 'pending')
    .select('id');
  if (error) throw new Error(`pending settle failed: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}
