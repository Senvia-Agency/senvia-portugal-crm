import type { Tool, ToolContext, ToolResult } from "../types.ts";
import {
  financeCreditNoteIdArgsSchema,
  financeCreditNoteSchema,
  financeInvoiceIdArgsSchema,
  financeInvoiceSchema,
} from "./finance-contracts.ts";
import {
  financeCanReadLinkedRecord,
  financeError,
  financeInvalidArguments,
} from "./finance-shared.ts";

async function getInvoiceDetails(
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const input = financeInvoiceIdArgsSchema.safeParse(args);
  if (!input.success) return financeInvalidArguments();
  const { data, error } = await ctx.supabaseAdmin
    .from("invoices")
    .select(
      "id,provider,invoicexpress_id,reference,document_type,status,client_name,total,date,due_date,sale_id,payment_id,pdf_path,email_status,email_sent_at,created_at,updated_at",
    )
    .eq("organization_id", ctx.orgId)
    .eq("id", input.data.invoice_id)
    .maybeSingle();
  if (error) {
    return financeError(
      "Não foi possível consultar a fatura.",
      "invoice_lookup_failed",
    );
  }
  const invoice = financeInvoiceSchema.safeParse(data);
  if (!invoice.success) {
    return financeError("Fatura não encontrada.", "invoice_not_found");
  }

  const access = await financeCanReadLinkedRecord(
    ctx,
    invoice.data.sale_id,
    invoice.data.payment_id,
  );
  if (!access.ok) return access.result;
  return {
    invoice: {
      id: invoice.data.id,
      provider: invoice.data.provider ?? null,
      provider_document_id: invoice.data.invoicexpress_id,
      reference: invoice.data.reference,
      document_type: invoice.data.document_type,
      status: invoice.data.status,
      client_name: invoice.data.client_name,
      total: invoice.data.total,
      date: invoice.data.date,
      due_date: invoice.data.due_date,
      sale_id: invoice.data.sale_id,
      payment_id: invoice.data.payment_id,
      has_pdf: Boolean(invoice.data.pdf_path),
      email_status: invoice.data.email_status ?? null,
      email_sent_at: invoice.data.email_sent_at ?? null,
      created_at: invoice.data.created_at,
      updated_at: invoice.data.updated_at,
    },
    sale: access.value
      ? {
        id: access.value.id,
        code: access.value.code,
        status: access.value.status,
      }
      : null,
    resource: {
      type: "invoice",
      id: invoice.data.id,
      route: "/financeiro/faturas",
    },
  };
}

async function getCreditNoteDetails(
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const input = financeCreditNoteIdArgsSchema.safeParse(args);
  if (!input.success) return financeInvalidArguments();
  const { data, error } = await ctx.supabaseAdmin
    .from("credit_notes")
    .select(
      "id,invoicexpress_id,reference,status,client_name,total,date,sale_id,payment_id,related_invoice_id,pdf_path,created_at,updated_at",
    )
    .eq("organization_id", ctx.orgId)
    .eq("id", input.data.credit_note_id)
    .maybeSingle();
  if (error) {
    return financeError(
      "Não foi possível consultar a nota de crédito.",
      "credit_note_lookup_failed",
    );
  }
  const creditNote = financeCreditNoteSchema.safeParse(data);
  if (!creditNote.success) {
    return financeError(
      "Nota de crédito não encontrada.",
      "credit_note_not_found",
    );
  }

  const access = await financeCanReadLinkedRecord(
    ctx,
    creditNote.data.sale_id,
    creditNote.data.payment_id,
  );
  if (!access.ok) return access.result;
  return {
    credit_note: {
      id: creditNote.data.id,
      provider_document_id: creditNote.data.invoicexpress_id,
      reference: creditNote.data.reference,
      status: creditNote.data.status,
      client_name: creditNote.data.client_name,
      total: creditNote.data.total,
      date: creditNote.data.date,
      sale_id: creditNote.data.sale_id,
      payment_id: creditNote.data.payment_id,
      related_invoice_id: creditNote.data.related_invoice_id,
      has_pdf: Boolean(creditNote.data.pdf_path),
      created_at: creditNote.data.created_at,
      updated_at: creditNote.data.updated_at,
    },
    sale: access.value
      ? {
        id: access.value.id,
        code: access.value.code,
        status: access.value.status,
      }
      : null,
    resource: {
      type: "credit_note",
      id: creditNote.data.id,
      route: "/financeiro/faturas",
    },
  };
}

export const financeFiscalReadTools = [
  {
    name: "get_invoice_details",
    module: "finance",
    description:
      "Consultar os detalhes seguros de uma fatura pelo identificador interno. Não devolve credenciais nem dados brutos do fornecedor.",
    parameters: {
      type: "object",
      properties: {
        invoice_id: {
          type: "string",
          format: "uuid",
          description: "ID interno da fatura",
        },
      },
      required: ["invoice_id"],
      additionalProperties: false,
    },
    permission: { module: "finance", subarea: "invoices", action: "view" },
    execute: getInvoiceDetails,
  },
  {
    name: "get_credit_note_details",
    module: "finance",
    description:
      "Consultar os detalhes seguros de uma nota de crédito pelo identificador interno.",
    parameters: {
      type: "object",
      properties: {
        credit_note_id: {
          type: "string",
          format: "uuid",
          description: "ID interno da nota de crédito",
        },
      },
      required: ["credit_note_id"],
      additionalProperties: false,
    },
    permission: { module: "finance", subarea: "invoices", action: "view" },
    execute: getCreditNoteDetails,
  },
] satisfies readonly Tool[];
