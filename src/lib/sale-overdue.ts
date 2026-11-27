// What a sale owes now, with the same rule as Financeiro > A receber: a payment
// still pending whose date has passed is late ("Em atraso").
//
// A recurring sale charged by Stripe gets its refused month as such a payment line
// (stripe-webhook / reconcile-stripe-payments), not as a cycle of the recurrence.
// The sale screen and the recurrence card must count it too, or a client who did
// not pay shows "Em falta 0,00 €" and "Em dia".

export interface PaymentLine {
  amount: number | string;
  status: string;
  payment_date: string;
  stripe_invoice_id?: string | null;
}

export interface CycleLine {
  status: string;
  stripe_invoice_id?: string | null;
}

/** Today in Lisbon, yyyy-MM-dd: a due date is a calendar day there. */
export function lisbonToday(now = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' });
}

const num = (value: number | string) => {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : value;
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Pending payments whose date is before today. */
export function overduePayments<T extends PaymentLine>(payments: readonly T[], today = lisbonToday()): T[] {
  return payments.filter((p) => p.status === 'pending' && p.payment_date.slice(0, 10) < today);
}

export function sumAmounts(lines: readonly { amount: number | string }[]): number {
  return Math.round(lines.reduce((sum, line) => sum + num(line.amount), 0) * 100) / 100;
}

/**
 * Late payments that the recurrence's own cycles do not already show as unpaid
 * (same Stripe invoice), so a debt is never counted twice on the card.
 */
export function overdueOutsideCycles<T extends PaymentLine>(payments: readonly T[], cycles: readonly CycleLine[], today = lisbonToday()): T[] {
  const openInvoices = new Set(
    cycles.filter((c) => (c.status === 'pending' || c.status === 'failed') && c.stripe_invoice_id).map((c) => c.stripe_invoice_id as string),
  );
  return overduePayments(payments, today).filter((p) => !p.stripe_invoice_id || !openInvoices.has(p.stripe_invoice_id));
}
