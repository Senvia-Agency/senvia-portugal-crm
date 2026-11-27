import type { PaymentWithSale } from '@/types/finance';

/**
 * Whether a payment counts in Financeiro (A receber, summary figures, card details).
 *
 * A plan sale (Senvia OS subscription, sale.client_org_id) is charged by Stripe on
 * its own, so its future months are not money "to receive": only what was paid
 * shows. The exception is a month Stripe REFUSED: the server records it as a
 * pending payment tied to that invoice (stripe_invoice_id), and that is a real debt
 * that must show as "Em atraso" until Stripe charges it.
 */
export function countsInFinance(payment: Pick<PaymentWithSale, 'status' | 'stripe_invoice_id'> & { sale: { client_org_id?: string | null } | null }): boolean {
  if (!payment.sale?.client_org_id) return true;
  return payment.status === 'paid' || !!payment.stripe_invoice_id;
}
