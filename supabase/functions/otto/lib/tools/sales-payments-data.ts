import type { ToolContext, ToolResult } from "../types.ts";
import { databaseFailure, loadScopedSale, missingResource } from "./sales-shared.ts";
import {
  SALE_PAYMENT_COLUMNS,
  SALE_PAYMENT_SALE_COLUMNS,
  salePaymentRowSchema,
  type SalePaymentRow,
  type ScopedSale,
} from "./sales-payments-contracts.ts";
import { parseSalePaymentRow } from "./sales-payments-domain.ts";

export type SalePaymentLookup =
  | { readonly ok: true; readonly value: { readonly payment: SalePaymentRow; readonly sale: ScopedSale } }
  | { readonly ok: false; readonly failure: ToolResult };

export type SalePaymentSnapshot =
  | { readonly ok: true; readonly value: { readonly sale: ScopedSale; readonly payments: readonly SalePaymentRow[] } }
  | { readonly ok: false; readonly failure: ToolResult };

export async function loadSalePaymentRows(
  ctx: ToolContext,
  saleId: string,
): Promise<{ readonly ok: true; readonly value: readonly SalePaymentRow[] } | { readonly ok: false; readonly failure: ToolResult }> {
  const { data, error } = await ctx.supabaseAdmin
    .from("sale_payments")
    .select(SALE_PAYMENT_COLUMNS)
    .eq("organization_id", ctx.orgId)
    .eq("sale_id", saleId)
    .order("payment_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return { ok: false, failure: databaseFailure("load_sale_payments", error) };
  const parsed = salePaymentRowSchema.array().safeParse(data ?? []);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, failure: databaseFailure("parse_sale_payments", parsed.error) };
}

export async function loadSalePaymentSnapshot(ctx: ToolContext, saleId: string): Promise<SalePaymentSnapshot> {
  const sale = await loadScopedSale(ctx, saleId, SALE_PAYMENT_SALE_COLUMNS);
  if (!sale.ok) return sale;
  const payments = await loadSalePaymentRows(ctx, sale.value.id);
  return payments.ok ? { ok: true, value: { sale: sale.value, payments: payments.value } } : payments;
}

export async function loadSalePayment(ctx: ToolContext, paymentId: string): Promise<SalePaymentLookup> {
  const { data, error } = await ctx.supabaseAdmin
    .from("sale_payments")
    .select(SALE_PAYMENT_COLUMNS)
    .eq("organization_id", ctx.orgId)
    .eq("id", paymentId)
    .maybeSingle();
  if (error) return { ok: false, failure: databaseFailure("load_sale_payment", error) };
  if (!data) return { ok: false, failure: missingResource("Pagamento") };
  const payment = parseSalePaymentRow(data, "parse_sale_payment");
  if (!payment.ok) return payment;
  const sale = await loadScopedSale(ctx, payment.value.sale_id, SALE_PAYMENT_SALE_COLUMNS);
  return sale.ok ? { ok: true, value: { payment: payment.value, sale: sale.value } } : sale;
}
