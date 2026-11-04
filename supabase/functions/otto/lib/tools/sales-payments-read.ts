import type { Tool, ToolContext, ToolResult } from "../types.ts";
import { parseArgs } from "./sales-shared.ts";
import {
  calculatePaymentSummary,
  loadSalePayment,
  loadSalePaymentRows,
  loadSalePaymentSnapshot,
  saleCode,
  salePaymentIdSchema,
  salePaymentListSchema,
  toSalePaymentView,
  type ScopedSale,
} from "./sales-payments-shared.ts";

function saleView(sale: ScopedSale, totalDue: number) {
  return { id: sale.id, code: saleCode(sale), total_due: totalDue };
}

async function listSalePayments(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const parsed = parseArgs(salePaymentListSchema, args);
  if (!parsed.ok) return parsed.failure;
  const snapshot = await loadSalePaymentSnapshot(ctx, parsed.value.sale_id);
  if (!snapshot.ok) return snapshot.failure;
  const summary = calculatePaymentSummary(snapshot.value.sale, snapshot.value.payments);
  return {
    sale: saleView(snapshot.value.sale, summary.total_due),
    payments: snapshot.value.payments.map(toSalePaymentView),
    summary,
    count: snapshot.value.payments.length,
    resource: { type: "sale_payments", id: snapshot.value.sale.id, route: "/sales" },
  };
}

async function getSalePaymentDetails(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const parsed = parseArgs(salePaymentIdSchema, args);
  if (!parsed.ok) return parsed.failure;
  const lookup = await loadSalePayment(ctx, parsed.value.payment_id);
  if (!lookup.ok) return lookup.failure;
  const rows = await loadSalePaymentRows(ctx, lookup.value.sale.id);
  if (!rows.ok) return rows.failure;
  const summary = calculatePaymentSummary(lookup.value.sale, rows.value);
  return {
    payment: toSalePaymentView(lookup.value.payment),
    sale: saleView(lookup.value.sale, summary.total_due),
    summary,
    resource: { type: "sale_payment", id: lookup.value.payment.id, route: "/sales" },
  };
}

export const salePaymentReadTools: Tool[] = [
  {
    name: "list_sale_payments",
    description: "Listar os pagamentos nativos de uma venda, incluindo o resumo devido/pago/agendado e quais linhas manuais continuam editáveis.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { sale_id: { type: "string", format: "uuid" } },
      required: ["sale_id"],
    },
    module: "sales",
    permission: { module: "sales", subarea: "payments", action: "view" },
    execute: listSalePayments,
  },
  {
    name: "get_sale_payment_details",
    description: "Consultar um pagamento nativo, a venda pai e o resumo financeiro atual sem permitir acesso fora do âmbito da venda.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { payment_id: { type: "string", format: "uuid" } },
      required: ["payment_id"],
    },
    module: "sales",
    permission: { module: "sales", subarea: "payments", action: "view" },
    execute: getSalePaymentDetails,
  },
];
