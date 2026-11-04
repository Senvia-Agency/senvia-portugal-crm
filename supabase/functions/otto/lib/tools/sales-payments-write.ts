import type { ConfirmationPreview, ToolContext, ToolResult } from "../types.ts";
import { databaseFailure, parseArgs, scopeDenied, validateBankAccount } from "./sales-shared.ts";
import {
  calculatePaymentSummary,
  createSalePaymentSchema,
  loadSalePayment,
  loadSalePaymentSnapshot,
  lockedPaymentResult,
  parseSalePaymentRow,
  paymentLockReason,
  paymentSummaryText,
  SALE_PAYMENT_COLUMNS,
  salePaymentIdSchema,
  toSalePaymentView,
  updateSalePaymentSchema,
} from "./sales-payments-shared.ts";
import type { PaymentBalanceRow, SalePaymentRow } from "./sales-payments-shared.ts";

const SALES_ROUTE = "/sales" as const;

function projectedRows(
  rows: readonly SalePaymentRow[],
  paymentId: string,
  amount: number | undefined,
  status: "pending" | "paid" | undefined,
): readonly PaymentBalanceRow[] {
  return rows.map((payment): PaymentBalanceRow => payment.id === paymentId
    ? { amount: amount ?? payment.amount, status: status ?? payment.status }
    : { amount: payment.amount, status: payment.status });
}

export async function createPreview(args: Readonly<Record<string, unknown>>, ctx: ToolContext): Promise<ConfirmationPreview | null> {
  const parsed = parseArgs(createSalePaymentSchema, args);
  if (!parsed.ok) return null;
  if (parsed.value.bank_account_id && await validateBankAccount(ctx, parsed.value.bank_account_id)) return null;
  const snapshot = await loadSalePaymentSnapshot(ctx, parsed.value.sale_id);
  if (!snapshot.ok) return null;
  const current = calculatePaymentSummary(snapshot.value.sale, snapshot.value.payments);
  const after = calculatePaymentSummary(snapshot.value.sale, [...snapshot.value.payments, parsed.value]);
  return {
    title: "Registar pagamento da venda",
    summary: `Registar ${parsed.value.amount.toFixed(2)} EUR em ${parsed.value.payment_date}. Estado atual: ${paymentSummaryText(current)}. Depois: ${paymentSummaryText(after)}.`,
    destination: SALES_ROUTE,
  };
}

export async function updatePreview(args: Readonly<Record<string, unknown>>, ctx: ToolContext): Promise<ConfirmationPreview | null> {
  const parsed = parseArgs(updateSalePaymentSchema, args);
  if (!parsed.ok) return null;
  const lookup = await loadSalePayment(ctx, parsed.value.payment_id);
  if (!lookup.ok || paymentLockReason(lookup.value.payment)) return null;
  if (parsed.value.bank_account_id && await validateBankAccount(ctx, parsed.value.bank_account_id)) return null;
  const snapshot = await loadSalePaymentSnapshot(ctx, lookup.value.payment.sale_id);
  if (!snapshot.ok) return null;
  const fields = Object.keys(parsed.value).filter((key) => key !== "payment_id");
  if (fields.length === 0) return null;
  const current = calculatePaymentSummary(snapshot.value.sale, snapshot.value.payments);
  const after = calculatePaymentSummary(snapshot.value.sale, projectedRows(
    snapshot.value.payments,
    lookup.value.payment.id,
    parsed.value.amount,
    parsed.value.status,
  ));
  return {
    title: "Editar pagamento da venda",
    summary: `Alterar ${fields.join(", ")} do pagamento ${lookup.value.payment.id}. Estado atual: ${paymentSummaryText(current)}. Depois: ${paymentSummaryText(after)}.`,
    destination: SALES_ROUTE,
  };
}

export async function deletePreview(args: Readonly<Record<string, unknown>>, ctx: ToolContext): Promise<ConfirmationPreview | null> {
  const parsed = parseArgs(salePaymentIdSchema, args);
  if (!parsed.ok) return null;
  const lookup = await loadSalePayment(ctx, parsed.value.payment_id);
  if (!lookup.ok || paymentLockReason(lookup.value.payment)) return null;
  const snapshot = await loadSalePaymentSnapshot(ctx, lookup.value.payment.sale_id);
  if (!snapshot.ok) return null;
  const current = calculatePaymentSummary(snapshot.value.sale, snapshot.value.payments);
  const after = calculatePaymentSummary(snapshot.value.sale, snapshot.value.payments.filter((payment) => payment.id !== lookup.value.payment.id));
  return {
    title: "Eliminar pagamento da venda",
    summary: `Eliminar o pagamento ${lookup.value.payment.id} de ${lookup.value.payment.amount.toFixed(2)} EUR. Estado atual: ${paymentSummaryText(current)}. Depois: ${paymentSummaryText(after)}.`,
    destination: SALES_ROUTE,
  };
}

export async function createSalePayment(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const parsed = parseArgs(createSalePaymentSchema, args);
  if (!parsed.ok) return parsed.failure;
  const snapshot = await loadSalePaymentSnapshot(ctx, parsed.value.sale_id);
  if (!snapshot.ok) return snapshot.failure;
  if (parsed.value.bank_account_id) {
    const invalidBank = await validateBankAccount(ctx, parsed.value.bank_account_id);
    if (invalidBank) return invalidBank;
  }
  const { data, error } = await ctx.supabaseUser.from("sale_payments").insert({
    organization_id: ctx.orgId,
    sale_id: parsed.value.sale_id,
    amount: parsed.value.amount,
    payment_date: parsed.value.payment_date,
    payment_method: parsed.value.payment_method ?? null,
    status: parsed.value.status,
    notes: parsed.value.notes ?? null,
    invoice_reference: parsed.value.invoice_reference ?? null,
    bank_account_id: parsed.value.bank_account_id ?? null,
  }).select(SALE_PAYMENT_COLUMNS).single();
  if (error) return databaseFailure("create_sale_payment", error);
  if (!data) return { error: "O pagamento criado não pôde ser confirmado.", reason_code: "payment_create_unverified" };
  const created = parseSalePaymentRow(data, "parse_created_sale_payment");
  if (!created.ok) return created.failure;
  return {
    operation: "created",
    payment: toSalePaymentView(created.value),
    summary: calculatePaymentSummary(snapshot.value.sale, [...snapshot.value.payments, parsed.value]),
    resource: { type: "sale_payment", id: created.value.id, route: SALES_ROUTE },
  };
}

export async function updateSalePayment(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const parsed = parseArgs(updateSalePaymentSchema, args);
  if (!parsed.ok) return parsed.failure;
  const lookup = await loadSalePayment(ctx, parsed.value.payment_id);
  if (!lookup.ok) return lookup.failure;
  const locked = lockedPaymentResult(lookup.value.payment);
  if (locked) return locked;
  const snapshot = await loadSalePaymentSnapshot(ctx, lookup.value.sale.id);
  if (!snapshot.ok) return snapshot.failure;
  const updates = {
    ...(parsed.value.amount !== undefined ? { amount: parsed.value.amount } : {}),
    ...(parsed.value.payment_date !== undefined ? { payment_date: parsed.value.payment_date } : {}),
    ...(parsed.value.payment_method !== undefined ? { payment_method: parsed.value.payment_method } : {}),
    ...(parsed.value.status !== undefined ? { status: parsed.value.status } : {}),
    ...(parsed.value.notes !== undefined ? { notes: parsed.value.notes } : {}),
    ...(parsed.value.invoice_reference !== undefined ? { invoice_reference: parsed.value.invoice_reference } : {}),
    ...(parsed.value.bank_account_id !== undefined ? { bank_account_id: parsed.value.bank_account_id } : {}),
  };
  if (Object.keys(updates).length === 0) return { error: "Nenhum campo editável foi indicado.", reason_code: "empty_update" };
  if (parsed.value.bank_account_id) {
    const invalidBank = await validateBankAccount(ctx, parsed.value.bank_account_id);
    if (invalidBank) return invalidBank;
  }
  const { data, error } = await ctx.supabaseUser.from("sale_payments").update(updates)
    .eq("organization_id", ctx.orgId).eq("sale_id", lookup.value.sale.id).eq("id", lookup.value.payment.id)
    .select(SALE_PAYMENT_COLUMNS).maybeSingle();
  if (error) return databaseFailure("update_sale_payment", error);
  if (!data) return scopeDenied();
  const updated = parseSalePaymentRow(data, "parse_updated_sale_payment");
  if (!updated.ok) return updated.failure;
  return {
    operation: "updated",
    payment: toSalePaymentView(updated.value),
    summary: calculatePaymentSummary(snapshot.value.sale, projectedRows(
      snapshot.value.payments,
      lookup.value.payment.id,
      parsed.value.amount,
      parsed.value.status,
    )),
    resource: { type: "sale_payment", id: updated.value.id, route: SALES_ROUTE },
  };
}

export async function deleteSalePayment(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const parsed = parseArgs(salePaymentIdSchema, args);
  if (!parsed.ok) return parsed.failure;
  const lookup = await loadSalePayment(ctx, parsed.value.payment_id);
  if (!lookup.ok) return lookup.failure;
  const locked = lockedPaymentResult(lookup.value.payment);
  if (locked) return locked;
  const snapshot = await loadSalePaymentSnapshot(ctx, lookup.value.sale.id);
  if (!snapshot.ok) return snapshot.failure;
  const { data, error } = await ctx.supabaseUser.from("sale_payments").delete()
    .eq("organization_id", ctx.orgId).eq("sale_id", lookup.value.sale.id).eq("id", lookup.value.payment.id)
    .select("id").maybeSingle();
  if (error) return databaseFailure("delete_sale_payment", error);
  if (!data || data.id !== lookup.value.payment.id) return scopeDenied();
  return {
    operation: "deleted",
    deleted_payment: { id: lookup.value.payment.id },
    summary: calculatePaymentSummary(snapshot.value.sale, snapshot.value.payments.filter((payment) => payment.id !== lookup.value.payment.id)),
    resource: { type: "sale_payment", id: lookup.value.payment.id, route: SALES_ROUTE },
  };
}
