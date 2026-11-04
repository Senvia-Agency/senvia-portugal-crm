import type { ToolResult } from "../types.ts";
import { databaseFailure } from "./sales-shared.ts";
import {
  salePaymentRowSchema,
  type PaymentBalanceRow,
  type PaymentSummary,
  type SalePaymentRow,
  type SalePaymentView,
  type ScopedSale,
} from "./sales-payments-contracts.ts";

export function parseSalePaymentRow(
  value: unknown,
  operation: string,
): { readonly ok: true; readonly value: SalePaymentRow } | { readonly ok: false; readonly failure: ToolResult } {
  const parsed = salePaymentRowSchema.safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, failure: databaseFailure(operation, parsed.error) };
}

export function normalizePaymentMethod(value: string | null): string | null {
  if (value === "transferencia") return "transfer";
  if (value === "cheque") return "check";
  return value;
}

export function paymentLockReason(payment: SalePaymentRow): "recurring" | "stripe" | "fiscal" | null {
  if (payment.recurring_cycle_id) return "recurring";
  if (
    payment.stripe_invoice_id || payment.stripe_payment_intent_id || payment.stripe_charge_id
    || payment.stripe_gross_amount !== null || payment.stripe_fee_amount !== null
    || payment.stripe_net_amount !== null
  ) return "stripe";
  if (
    payment.invoicexpress_id !== null || payment.credit_note_id !== null || payment.original_payment_id
    || (payment.reversal_status !== undefined && payment.reversal_status !== null && payment.reversal_status !== "none")
    || Number(payment.reversed_amount ?? 0) > 0
  ) return "fiscal";
  return null;
}

export function lockedPaymentResult(payment: SalePaymentRow): ToolResult | null {
  const reason = paymentLockReason(payment);
  if (!reason) return null;
  const messages = {
    recurring: "O pagamento pertence a um ciclo recorrente e só pode ser alterado pelo domínio de recorrência.",
    stripe: "O pagamento foi criado pelo Stripe e só pode ser reconciliado pelo domínio Stripe.",
    fiscal: "O pagamento tem identidade fiscal ou reversão e o histórico fiscal deve ser preservado.",
  } as const;
  return {
    error: messages[reason],
    reason_code: `${reason}_payment_locked`,
    _instruction: "A ação NÃO foi executada. Não alteres nem elimines pagamentos recorrentes, Stripe ou fiscais.",
  };
}

export function paymentSource(payment: SalePaymentRow): SalePaymentView["source"] {
  const reason = paymentLockReason(payment);
  return reason === "recurring" ? "recurring" : reason === "stripe" ? "stripe" : reason === "fiscal" ? "fiscal" : "manual";
}

export function toSalePaymentView(payment: SalePaymentRow): SalePaymentView {
  const reason = paymentLockReason(payment);
  return {
    id: payment.id,
    sale_id: payment.sale_id,
    amount: payment.amount,
    payment_date: payment.payment_date,
    payment_method: normalizePaymentMethod(payment.payment_method),
    invoice_reference: payment.invoice_reference,
    invoice_file_url: payment.invoice_file_url,
    status: payment.status,
    notes: payment.notes,
    bank_account_id: payment.bank_account_id,
    billing_period_start: payment.billing_period_start,
    billing_period_end: payment.billing_period_end,
    created_at: payment.created_at,
    updated_at: payment.updated_at,
    is_recurring: payment.recurring_cycle_id !== null,
    source: paymentSource(payment),
    editable: reason === null,
    edit_block_reason: reason,
  };
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function saleCode(sale: ScopedSale): string | null {
  const value = Reflect.get(sale, "code");
  return typeof value === "string" ? value : null;
}

export function paymentObligation(sale: ScopedSale): number {
  const gross = numberValue(Reflect.get(sale, "gross_value"));
  const total = numberValue(Reflect.get(sale, "total_value"));
  return Math.max(0, gross ?? total ?? 0);
}

export function calculatePaymentSummary(sale: ScopedSale, payments: readonly PaymentBalanceRow[]): PaymentSummary {
  const totalDue = paymentObligation(sale);
  const totalPaid = payments.filter((payment) => payment.status === "paid").reduce((sum, payment) => sum + payment.amount, 0);
  const totalScheduled = payments.filter((payment) => payment.status === "pending").reduce((sum, payment) => sum + payment.amount, 0);
  const paymentStatus = totalPaid === 0 ? "pending" : totalPaid >= totalDue ? "paid" : "partial";
  return {
    total_due: totalDue,
    total_paid: totalPaid,
    total_scheduled: totalScheduled,
    remaining: Math.max(0, totalDue - totalPaid),
    remaining_to_schedule: Math.max(0, totalDue - totalPaid - totalScheduled),
    payment_status: paymentStatus,
  };
}

export function paymentSummaryText(summary: PaymentSummary): string {
  return [
    `devido ${summary.total_due.toFixed(2)} EUR`,
    `pago ${summary.total_paid.toFixed(2)} EUR`,
    `em falta ${summary.remaining.toFixed(2)} EUR`,
    `estado ${summary.payment_status}`,
  ].join(", ");
}
