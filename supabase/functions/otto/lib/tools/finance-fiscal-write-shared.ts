import type { ConfirmationPreview, ToolContext, ToolResult } from "../types.ts";
import {
  financeCancelInvoiceArgsSchema,
  type FinanceInvoice,
  financeInvoiceSchema,
  financeIssueInvoiceArgsSchema,
  financeSendInvoiceArgsSchema,
} from "./finance-contracts.ts";
import {
  financeCanReadLinkedRecord,
  financeError,
  financeVisibleSale,
} from "./finance-shared.ts";

type InvoiceResult =
  | { readonly ok: true; readonly invoice: FinanceInvoice }
  | { readonly ok: false; readonly result: ToolResult };

export async function financeInvoiceSnapshotDigest(
  invoice: FinanceInvoice,
): Promise<string> {
  const snapshot = {
    id: invoice.id,
    provider: invoice.provider ?? null,
    invoicexpress_id: invoice.invoicexpress_id,
    reference: invoice.reference,
    document_type: invoice.document_type,
    status: invoice.status,
    total: invoice.total,
    sale_id: invoice.sale_id,
    payment_id: invoice.payment_id,
    pdf_path: invoice.pdf_path,
    updated_at: invoice.updated_at,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function loadInvoice(
  ctx: ToolContext,
  invoiceId: string,
): Promise<InvoiceResult> {
  const { data, error } = await ctx.supabaseAdmin.from("invoices")
    .select(
      "id,provider,invoicexpress_id,reference,document_type,status,client_name,total,date,due_date,sale_id,payment_id,pdf_path,email_status,email_sent_at,created_at,updated_at",
    )
    .eq("organization_id", ctx.orgId).eq("id", invoiceId).maybeSingle();
  if (error) {
    return {
      ok: false,
      result: financeError(
        "Não foi possível consultar a fatura.",
        "invoice_lookup_failed",
      ),
    };
  }
  const parsed = financeInvoiceSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      result: financeError("Fatura não encontrada.", "invoice_not_found"),
    };
  }
  const access = await financeCanReadLinkedRecord(
    ctx,
    parsed.data.sale_id,
    parsed.data.payment_id,
  );
  return access.ok
    ? { ok: true, invoice: parsed.data }
    : { ok: false, result: access.result };
}

export async function issuePreview(
  args: Readonly<Record<string, unknown>>,
  ctx: ToolContext,
): Promise<ConfirmationPreview | null> {
  const input = financeIssueInvoiceArgsSchema.safeParse(args);
  if (!input.success) return null;
  const sale = await financeVisibleSale(ctx, input.data.sale_id);
  if (!sale.ok) return null;
  if (!sale.value.updated_at) return null;
  const amount = sale.value.gross_value ?? sale.value.total_value;
  return {
    title: "Emitir fatura",
    summary: `Emitir uma fatura para a venda ${
      sale.value.code ?? sale.value.id
    }, no valor contratual de ${
      amount.toFixed(2)
    } EUR, através do fornecedor fiscal configurado.`,
    destination: "/financeiro/faturas",
    preparedArgs: {
      ...input.data,
      expected_sale_updated_at: sale.value.updated_at,
      expected_sale_amount: amount,
    },
  };
}

export async function cancelPreview(
  args: Readonly<Record<string, unknown>>,
  ctx: ToolContext,
): Promise<ConfirmationPreview | null> {
  const input = financeCancelInvoiceArgsSchema.safeParse(args);
  if (!input.success) return null;
  const loaded = await loadInvoice(ctx, input.data.invoice_id);
  if (!loaded.ok || !loaded.invoice.updated_at) return null;
  return {
      title: "Anular documento fiscal",
      summary: `Anular ${
        loaded.invoice.reference ?? loaded.invoice.id
      }. Motivo: ${input.data.reason}. A operação pode gerar uma nota de crédito no fornecedor fiscal.`,
      destination: "/financeiro/faturas",
      preparedArgs: {
        ...input.data,
        expected_invoice_updated_at: loaded.invoice.updated_at,
        invoice_snapshot_digest: await financeInvoiceSnapshotDigest(loaded.invoice),
      },
    };
}

export async function sendPreview(
  args: Readonly<Record<string, unknown>>,
  ctx: ToolContext,
): Promise<ConfirmationPreview | null> {
  const input = financeSendInvoiceArgsSchema.safeParse(args);
  if (!input.success) return null;
  const loaded = await loadInvoice(ctx, input.data.invoice_id);
  if (!loaded.ok || !loaded.invoice.updated_at) return null;
  return {
      title: "Enviar documento fiscal",
      summary: `Enviar ${
        loaded.invoice.reference ?? loaded.invoice.id
      } por email para ${input.data.email}, com o PDF fiscal guardado no SENVIA.`,
      destination: "/financeiro/faturas",
      preparedArgs: {
        ...input.data,
        expected_invoice_updated_at: loaded.invoice.updated_at,
        invoice_snapshot_digest: await financeInvoiceSnapshotDigest(loaded.invoice),
      },
    };
}
