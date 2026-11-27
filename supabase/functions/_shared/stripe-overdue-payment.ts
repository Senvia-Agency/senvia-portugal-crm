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

export type OverdueCycleResult = 'opened' | 'linked' | 'already_paid' | 'skipped';

/**
 * Abre o ciclo da recorrência desta fatura como em falta e liga-lhe o pagamento
 * pendente. É isto que o painel da venda soma em "Por liquidar"; e a recorrência
 * passa a "Em atraso". Quando a fatura é paga, syncPaidStripeSale encontra o
 * ciclo pelo id da fatura e fecha-o, e volta a pôr a recorrência "Em dia".
 * Idempotente: pode correr em cada nova tentativa falhada da mesma fatura.
 */
export async function openOverdueStripeCycle(
  db: any,
  input: { agencyOrgId: string; saleId: string | null | undefined; invoice: OverdueInvoice },
): Promise<OverdueCycleResult> {
  const { agencyOrgId, saleId, invoice } = input;
  const cents = invoice.amount_remaining ?? invoice.amount_due ?? 0;
  const periodStart = day(invoice.period_start);
  const periodEnd = day(invoice.period_end);
  if (!saleId || !invoice?.id || !(cents > 0) || !periodStart || !periodEnd || periodEnd < periodStart) return 'skipped';

  const { data: recurrences, error: recurrenceError } = await db
    .from('sale_recurrences')
    .select('id')
    .eq('sale_id', saleId)
    .eq('organization_id', agencyOrgId)
    .in('service_status', ['pending', 'active', 'paused'])
    .order('created_at', { ascending: false })
    .limit(1);
  if (recurrenceError) throw new Error(`overdue recurrence lookup failed: ${recurrenceError.message}`);
  const recurrenceId = recurrences?.[0]?.id as string | undefined;
  if (!recurrenceId) return 'skipped';

  const chargeDay = day(invoice.due_date) ?? day(invoice.created) ?? periodEnd;
  const dueDate = chargeDay < periodStart ? periodStart : chargeDay > periodEnd ? periodEnd : chargeDay;

  // 1. O ciclo desta fatura, se já existir; senão o do mesmo período ainda sem fatura.
  const { data: byInvoice, error: byInvoiceError } = await db
    .from('sale_recurring_cycles')
    .select('id, status')
    .eq('stripe_invoice_id', invoice.id)
    .limit(1);
  if (byInvoiceError) throw new Error(`overdue cycle lookup failed: ${byInvoiceError.message}`);
  let cycle: { id: string; status: string } | null = byInvoice?.[0] ?? null;
  let result: OverdueCycleResult = 'linked';

  if (!cycle) {
    const { data: byPeriod, error: byPeriodError } = await db
      .from('sale_recurring_cycles')
      .select('id, status, stripe_invoice_id')
      .eq('recurrence_id', recurrenceId)
      .eq('period_start', periodStart)
      .eq('period_end', periodEnd)
      .limit(1);
    if (byPeriodError) throw new Error(`overdue cycle period lookup failed: ${byPeriodError.message}`);
    const samePeriod = byPeriod?.[0];
    if (samePeriod) {
      // Período já coberto por outra fatura: não se mexe.
      if (samePeriod.stripe_invoice_id && samePeriod.stripe_invoice_id !== invoice.id) return 'skipped';
      cycle = samePeriod;
    }
  }
  if (cycle?.status === 'paid') return 'already_paid';

  if (cycle) {
    const { error } = await db.from('sale_recurring_cycles').update({
      stripe_invoice_id: invoice.id,
      stripe_invoice_status: 'open',
      failure_reason: 'Cobrança recusada pelo Stripe',
      updated_at: new Date().toISOString(),
    }).eq('id', cycle.id).neq('status', 'paid');
    if (error) throw new Error(`overdue cycle update failed: ${error.message}`);
  } else {
    const { data: created, error } = await db.from('sale_recurring_cycles').insert({
      recurrence_id: recurrenceId,
      sale_id: saleId,
      organization_id: agencyOrgId,
      currency: 'EUR',
      period_start: periodStart,
      period_end: periodEnd,
      due_date: dueDate,
      amount: Math.round(cents) / 100,
      status: 'failed',
      stripe_invoice_id: invoice.id,
      stripe_invoice_status: 'open',
      failure_reason: 'Cobrança recusada pelo Stripe',
    }).select('id').maybeSingle();
    if (error) throw new Error(`overdue cycle insert failed: ${error.message}`);
    if (!created?.id) return 'skipped';
    cycle = { id: created.id, status: 'failed' };
    result = 'opened';
  }

  // 2. O pagamento pendente da fatura passa a pertencer a este ciclo.
  const { error: linkError } = await db.from('sale_payments')
    .update({ recurring_cycle_id: cycle.id })
    .eq('stripe_invoice_id', invoice.id)
    .eq('status', 'pending')
    .is('recurring_cycle_id', null);
  if (linkError) throw new Error(`overdue payment link failed: ${linkError.message}`);

  // 3. A recorrência fica "Em atraso" até o Stripe cobrar.
  const { error: recurrenceUpdateError } = await db.from('sale_recurrences')
    .update({ billing_status: 'past_due', updated_at: new Date().toISOString() })
    .eq('id', recurrenceId)
    .eq('billing_status', 'current');
  if (recurrenceUpdateError) throw new Error(`overdue recurrence update failed: ${recurrenceUpdateError.message}`);

  return result;
}
