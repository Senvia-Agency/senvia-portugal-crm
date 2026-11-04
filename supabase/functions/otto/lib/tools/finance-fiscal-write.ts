import type { ToolContext, ToolResult } from "../types.ts";
import {
  financePreparedCancelInvoiceArgsSchema,
  financePreparedIssueInvoiceArgsSchema,
  financePreparedSendInvoiceArgsSchema,
  financeCancelResultSchema,
  financeIssueResultSchema,
  financeSendResultSchema,
} from "./finance-contracts.ts";
import {
  financeInvoiceSnapshotDigest,
  loadInvoice,
} from "./finance-fiscal-write-shared.ts";
import {
  financeError,
  financeFunctionInvokeFailure,
  financeFunctionResultFailure,
  financeInvalidArguments,
  financeVisibleSale,
} from "./finance-shared.ts";

const closedInvoiceStates = new Set(["cancelled", "canceled", "void", "draft"]);
const cancelDocumentTypes = new Set(["invoice", "invoice_receipt", "receipt"]);

export async function issueInvoice(
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const input = financePreparedIssueInvoiceArgsSchema.safeParse(args);
  if (!input.success) return financeInvalidArguments();
  const sale = await financeVisibleSale(ctx, input.data.sale_id);
  if (!sale.ok) return sale.result;
  const currentAmount = sale.value.gross_value ?? sale.value.total_value;
  if (
    sale.value.updated_at !== input.data.expected_sale_updated_at
    || currentAmount !== input.data.expected_sale_amount
  ) {
    return financeError(
      "A venda mudou desde a pré-visualização. Pede uma nova confirmação antes de emitir.",
      "sale_changed",
    );
  }
  if (["cancelled", "canceled"].includes(sale.value.status.toLowerCase())) {
    return financeError(
      "Não é possível emitir uma fatura para uma venda cancelada.",
      "sale_cancelled",
    );
  }
  if (sale.value.invoicexpress_id || sale.value.invoice_reference) {
    return financeError(
      "A venda já tem um documento fiscal associado.",
      "invoice_already_linked",
    );
  }

  const response = await ctx.supabaseUser.functions.invoke("issue-invoice", {
    body: {
      sale_id: sale.value.id,
      organization_id: ctx.orgId,
      ...(input.data.observations
        ? { observations: input.data.observations }
        : {}),
    },
  });
  if (response.error) {
    return await financeFunctionInvokeFailure(
      response.error,
      "issue_invoice_failed",
    );
  }
  const result = financeIssueResultSchema.safeParse(response.data);
  if (!result.success) {
    return financeFunctionResultFailure(
      response.data,
      "issue_invoice_unverified",
    );
  }
  return {
    operation: result.data.already_issued ? "already_issued" : "issued",
    status: "confirmed",
    invoice_reference: result.data.invoice_reference,
    provider_document_id: result.data.invoicexpress_id,
    resource: { type: "sale", id: sale.value.id, route: "/sales" },
  };
}

export async function cancelInvoice(
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const input = financePreparedCancelInvoiceArgsSchema.safeParse(args);
  if (!input.success) return financeInvalidArguments();
  const loaded = await loadInvoice(ctx, input.data.invoice_id);
  if (!loaded.ok) return loaded.result;
  if (
    loaded.invoice.updated_at !== input.data.expected_invoice_updated_at
    || await financeInvoiceSnapshotDigest(loaded.invoice) !== input.data.invoice_snapshot_digest
  ) {
    return financeError(
      "O documento mudou desde a pré-visualização. Pede uma nova confirmação antes de anular.",
      "invoice_changed",
    );
  }
  const status = loaded.invoice.status?.toLowerCase() ?? "";
  if (closedInvoiceStates.has(status)) {
    return financeError(
      "O documento não está num estado anulável.",
      "invoice_not_cancellable",
    );
  }
  if (loaded.invoice.provider === "vendus") {
    return financeError(
      "A anulação de documentos Vendus ainda não é suportada.",
      "vendus_operation_unsupported",
    );
  }
  if (
    !loaded.invoice.document_type ||
    !cancelDocumentTypes.has(loaded.invoice.document_type) ||
    !loaded.invoice.invoicexpress_id
  ) {
    return financeError(
      "O documento não tem uma identidade fiscal anulável.",
      "invalid_fiscal_identity",
    );
  }

  const response = await ctx.supabaseUser.functions.invoke("cancel-invoice", {
    body: {
      invoice_id: loaded.invoice.id,
      payment_id: loaded.invoice.payment_id,
      sale_id: loaded.invoice.sale_id,
      organization_id: ctx.orgId,
      reason: input.data.reason,
      invoicexpress_id: loaded.invoice.invoicexpress_id,
      document_type: loaded.invoice.document_type,
    },
  });
  if (response.error) {
    return await financeFunctionInvokeFailure(
      response.error,
      "cancel_invoice_failed",
    );
  }
  const result = financeCancelResultSchema.safeParse(response.data);
  if (!result.success) {
    return financeFunctionResultFailure(
      response.data,
      "cancel_invoice_unverified",
    );
  }
  return {
    operation: result.data.operation,
    status: "cancelled",
    resource: {
      type: "invoice",
      id: loaded.invoice.id,
      route: "/financeiro/faturas",
    },
  };
}

export async function sendInvoiceEmail(
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const input = financePreparedSendInvoiceArgsSchema.safeParse(args);
  if (!input.success) return financeInvalidArguments();
  const loaded = await loadInvoice(ctx, input.data.invoice_id);
  if (!loaded.ok) return loaded.result;
  if (
    loaded.invoice.updated_at !== input.data.expected_invoice_updated_at
    || await financeInvoiceSnapshotDigest(loaded.invoice) !== input.data.invoice_snapshot_digest
  ) {
    return financeError(
      "O documento mudou desde a pré-visualização. Pede uma nova confirmação antes de enviar.",
      "invoice_changed",
    );
  }
  const status = loaded.invoice.status?.toLowerCase() ?? "";
  if (closedInvoiceStates.has(status)) {
    return financeError(
      "Só é possível enviar documentos fiscais finalizados.",
      "invoice_not_sendable",
    );
  }
  if (!loaded.invoice.pdf_path) {
    return financeError(
      "O PDF deste documento ainda não está disponível.",
      "invoice_pdf_unavailable",
    );
  }

  const response = await ctx.supabaseUser.functions.invoke(
    "send-invoice-email",
    {
      body: {
        invoice_id: loaded.invoice.id,
        document_id: loaded.invoice.invoicexpress_id,
        document_type: loaded.invoice.document_type,
        organization_id: ctx.orgId,
        email: input.data.email,
      },
    },
  );
  if (response.error) {
    return await financeFunctionInvokeFailure(
      response.error,
      "send_invoice_email_failed",
    );
  }
  const result = financeSendResultSchema.safeParse(response.data);
  if (!result.success) {
    return financeFunctionResultFailure(
      response.data,
      "send_invoice_email_unverified",
    );
  }
  return {
    operation: "sent",
    status: "accepted",
    provider: result.data.provider,
    recipient: input.data.email,
    resource: {
      type: "invoice",
      id: loaded.invoice.id,
      route: "/financeiro/faturas",
    },
  };
}
