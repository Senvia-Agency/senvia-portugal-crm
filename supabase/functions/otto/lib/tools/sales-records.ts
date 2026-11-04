import { z } from "https://esm.sh/zod@3.25.76";

import type { Tool, ToolContext } from "../types.ts";
import {
  databaseFailure,
  DATE_SCHEMA,
  loadScopedSale,
  parseArgs,
  scopeDenied,
  UUID_SCHEMA,
  validateClientParent,
} from "./sales-shared.ts";

const telecomStatusMap = {
  pendente: "in_progress",
  em_instalacao: "in_progress",
  ativo: "fulfilled",
  instalado: "delivered",
  anulado: "cancelled",
  cancelado: "cancelled",
} as const;

const installTimestampSchema = z.string().max(64).refine((value) => Number.isFinite(Date.parse(value)));

const updateSaleSchema = z.object({
  sale_id: UUID_SCHEMA,
  status: z.enum(["in_progress", "fulfilled", "delivered", "cancelled"]).optional(),
  total_value: z.number().finite().nonnegative().optional(),
  gross_value: z.number().finite().nonnegative().nullable().optional(),
  subtotal: z.number().finite().nonnegative().optional(),
  discount: z.number().finite().nonnegative().optional(),
  payment_method: z.enum(["mbway", "transfer", "cash", "card", "credit_card", "debit_card", "check", "other"]).nullable().optional(),
  due_date: DATE_SCHEMA.nullable().optional(),
  invoice_reference: z.string().trim().max(160).nullable().optional(),
  sale_date: DATE_SCHEMA.optional(),
  notes: z.string().trim().max(10_000).nullable().optional(),
  client_id: UUID_SCHEMA.nullable().optional(),
  billing_target: z.enum(["client", "company"]).nullable().optional(),
  fiscal_auto_receipts: z.boolean().nullable().optional(),
  fiscal_auto_email: z.boolean().nullable().optional(),
  fiscal_email_recipient: z.string().trim().email().max(320).nullable().optional(),
  fiscal_auto_invoices: z.boolean().nullable().optional(),
  proposal_type: z.enum(["energia", "servicos"]).nullable().optional(),
  negotiation_type: z.enum(["angariacao", "angariacao_indexado", "renovacao", "sem_volume"]).nullable().optional(),
  consumo_anual: z.number().finite().nonnegative().nullable().optional(),
  margem: z.number().finite().nonnegative().nullable().optional(),
  dbl: z.number().finite().nonnegative().nullable().optional(),
  anos_contrato: z.number().int().positive().nullable().optional(),
  modelo_servico: z.enum(["transacional", "saas"]).nullable().optional(),
  kwp: z.number().finite().nonnegative().nullable().optional(),
  comissao: z.number().finite().nonnegative().nullable().optional(),
  edp_proposal_number: z.string().trim().max(120).nullable().optional(),
  telecom_status: z.enum(["pendente", "em_instalacao", "ativo", "instalado", "anulado", "cancelado"]).nullable().optional(),
  scheduled_install_date: installTimestampSchema.nullable().optional(),
  scheduled_install_end: installTimestampSchema.nullable().optional(),
  fidelizacao_end: DATE_SCHEMA.nullable().optional(),
  documents_checked: z.boolean().nullable().optional(),
  contract_signed: z.boolean().nullable().optional(),
}).strict().superRefine((value, refinement) => {
  const financialCount = [value.total_value, value.subtotal, value.discount]
    .filter((item) => item !== undefined).length;
  if (financialCount > 0 && financialCount < 3) {
    refinement.addIssue({
      code: z.ZodIssueCode.custom,
      message: "total_value, subtotal and discount must be supplied together",
    });
  }
  if (
    financialCount === 3
    && value.total_value !== undefined
    && value.subtotal !== undefined
    && value.discount !== undefined
    && Math.round((value.subtotal - value.discount) * 100) / 100 !== value.total_value
  ) {
    refinement.addIssue({ code: z.ZodIssueCode.custom, message: "sale totals are inconsistent" });
  }
  if (
    value.scheduled_install_date
    && value.scheduled_install_end
    && Date.parse(value.scheduled_install_end) < Date.parse(value.scheduled_install_date)
  ) {
    refinement.addIssue({ code: z.ZodIssueCode.custom, message: "installation end precedes start" });
  }
});

const saleIdSchema = z.object({ sale_id: UUID_SCHEMA }).strict();

async function updatePreview(args: Readonly<Record<string, unknown>>, ctx: ToolContext) {
  const parsed = parseArgs(updateSaleSchema, args);
  if (!parsed.ok) return null;
  const sale = await loadScopedSale(ctx, parsed.value.sale_id, "id, code, seller_id, created_by, lead_id");
  if (!sale.ok) return null;
  const code = Reflect.get(sale.value, "code");
  const fields = Object.keys(parsed.value).filter((key) => key !== "sale_id");
  if (fields.length === 0) return null;
  return {
    title: "Editar venda",
    summary: `Alterar ${fields.length} campo(s) da venda ${typeof code === "string" ? code : sale.value.id}: ${fields.join(", ")}.`,
    destination: "/sales" as const,
  };
}

async function deletePreview(args: Readonly<Record<string, unknown>>, ctx: ToolContext) {
  const parsed = parseArgs(saleIdSchema, args);
  if (!parsed.ok) return null;
  const sale = await loadScopedSale(ctx, parsed.value.sale_id, "id, code, seller_id, created_by, lead_id");
  if (!sale.ok) return null;
  const code = Reflect.get(sale.value, "code");
  return {
    title: "Eliminar venda",
    summary: `Eliminar permanentemente a venda ${typeof code === "string" ? code : sale.value.id}. A operação será recusada se existirem pagamentos, documentos fiscais ou recorrência.`,
    destination: "/sales" as const,
  };
}

export const salesRecordTools: Tool[] = [
  {
    name: "update_sale",
    description: "Editar campos tipados de uma venda existente. Não altera vendedor, pagamentos, itens, recorrência, Stripe nem IDs fiscais.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sale_id: { type: "string", format: "uuid" },
        status: { type: "string", enum: ["in_progress", "fulfilled", "delivered", "cancelled"] },
        total_value: { type: "number", minimum: 0 },
        gross_value: { type: ["number", "null"], minimum: 0 },
        subtotal: { type: "number", minimum: 0 },
        discount: { type: "number", minimum: 0 },
        payment_method: { type: ["string", "null"], enum: ["mbway", "transfer", "cash", "card", "credit_card", "debit_card", "check", "other", null] },
        due_date: { type: ["string", "null"], format: "date" },
        invoice_reference: { type: ["string", "null"], maxLength: 160 },
        sale_date: { type: "string", format: "date" },
        notes: { type: ["string", "null"], maxLength: 10000 },
        client_id: { type: ["string", "null"], format: "uuid" },
        billing_target: { type: ["string", "null"], enum: ["client", "company", null] },
        fiscal_auto_receipts: { type: ["boolean", "null"] },
        fiscal_auto_email: { type: ["boolean", "null"] },
        fiscal_email_recipient: { type: ["string", "null"], format: "email" },
        fiscal_auto_invoices: { type: ["boolean", "null"] },
        proposal_type: { type: ["string", "null"], enum: ["energia", "servicos", null] },
        negotiation_type: { type: ["string", "null"], enum: ["angariacao", "angariacao_indexado", "renovacao", "sem_volume", null] },
        consumo_anual: { type: ["number", "null"], minimum: 0 },
        margem: { type: ["number", "null"], minimum: 0 },
        dbl: { type: ["number", "null"], minimum: 0 },
        anos_contrato: { type: ["integer", "null"], minimum: 1 },
        modelo_servico: { type: ["string", "null"], enum: ["transacional", "saas", null] },
        kwp: { type: ["number", "null"], minimum: 0 },
        comissao: { type: ["number", "null"], minimum: 0 },
        edp_proposal_number: { type: ["string", "null"], maxLength: 120 },
        telecom_status: { type: ["string", "null"], enum: ["pendente", "em_instalacao", "ativo", "instalado", "anulado", "cancelado", null] },
        scheduled_install_date: { type: ["string", "null"], format: "date-time" },
        scheduled_install_end: { type: ["string", "null"], format: "date-time" },
        fidelizacao_end: { type: ["string", "null"], format: "date" },
        documents_checked: { type: ["boolean", "null"] },
        contract_signed: { type: ["boolean", "null"] },
      },
      required: ["sale_id"],
    },
    module: "sales",
    permission: { module: "sales", subarea: "sales", action: "edit" },
    isWrite: true,
    confirmation: { kind: "confirmation_required", preview: updatePreview },
    execute: async (args, ctx) => {
      const parsed = parseArgs(updateSaleSchema, args);
      if (!parsed.ok) return parsed.failure;
      const { sale_id: saleId, ...requestedUpdates } = parsed.value;
      if (Object.keys(requestedUpdates).length === 0) return { error: "Nenhum campo editável foi indicado.", reason_code: "empty_update" };
      const current = await loadScopedSale(
        ctx,
        saleId,
        "id, code, seller_id, created_by, lead_id, client_id, activation_date, invoice_reference, invoicexpress_id, scheduled_install_date, scheduled_install_end",
      );
      if (!current.ok) return current.failure;
      if (requestedUpdates.client_id) {
        const invalid = await validateClientParent(ctx, requestedUpdates.client_id);
        if (invalid) return invalid;
      }
      if (
        "billing_target" in requestedUpdates
        && (Reflect.get(current.value, "invoice_reference") || Reflect.get(current.value, "invoicexpress_id"))
      ) {
        return { error: "O destinatário fiscal não pode mudar depois de existir documento fiscal.", reason_code: "fiscal_identity_locked" };
      }
      if (
        (requestedUpdates.telecom_status === "ativo" || requestedUpdates.telecom_status === "instalado")
        && !Reflect.get(current.value, "activation_date")
      ) {
        return { error: "Define a data de ativação na interface antes de avançar para este estado telecom.", reason_code: "activation_date_required" };
      }
      const nextInstallStart = requestedUpdates.scheduled_install_date
        ?? Reflect.get(current.value, "scheduled_install_date");
      const nextInstallEnd = requestedUpdates.scheduled_install_end
        ?? Reflect.get(current.value, "scheduled_install_end");
      if (
        typeof nextInstallStart === "string"
        && typeof nextInstallEnd === "string"
        && Date.parse(nextInstallEnd) < Date.parse(nextInstallStart)
      ) return { error: "O fim da instalação não pode ser anterior ao início.", reason_code: "invalid_install_window" };
      const updates = requestedUpdates.telecom_status
        ? { ...requestedUpdates, status: telecomStatusMap[requestedUpdates.telecom_status] }
        : requestedUpdates;
      const { data, error } = await ctx.supabaseUser.from("sales").update(updates)
        .eq("organization_id", ctx.orgId).eq("id", saleId)
        .select("id, code, status, telecom_status, total_value, updated_at").maybeSingle();
      if (error) return databaseFailure("update_sale", error);
      if (!data) return scopeDenied();
      return { operation: "updated", sale: data, resource: { type: "sale", id: data.id, route: "/sales" } };
    },
  },
  {
    name: "delete_sale",
    description: "Eliminar uma venda sem pagamentos, documentos fiscais ou recorrência. Nunca elimina pagamentos, faturas ou dados Stripe em cascata.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { sale_id: { type: "string", format: "uuid" } },
      required: ["sale_id"],
    },
    module: "sales",
    permission: { module: "sales", subarea: "sales", action: "delete" },
    isWrite: true,
    confirmation: { kind: "confirmation_required", preview: deletePreview },
    execute: async (args, ctx) => {
      const parsed = parseArgs(saleIdSchema, args);
      if (!parsed.ok) return parsed.failure;
      const current = await loadScopedSale(
        ctx,
        parsed.value.sale_id,
        "id, code, seller_id, created_by, lead_id, invoicexpress_id, credit_note_id, invoice_reference",
      );
      if (!current.ok) return current.failure;
      const [payments, recurrences] = await Promise.all([
        ctx.supabaseAdmin.from("sale_payments").select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.orgId).eq("sale_id", current.value.id),
        ctx.supabaseAdmin.from("sale_recurrences").select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.orgId).eq("sale_id", current.value.id),
      ]);
      if (payments.error) return databaseFailure("check_sale_payments", payments.error);
      if (recurrences.error) return databaseFailure("check_sale_recurrences", recurrences.error);
      const hasFiscalDocument = Boolean(
        Reflect.get(current.value, "invoicexpress_id")
        || Reflect.get(current.value, "credit_note_id")
        || Reflect.get(current.value, "invoice_reference"),
      );
      if ((payments.count ?? 0) > 0 || (recurrences.count ?? 0) > 0 || hasFiscalDocument) {
        return {
          error: "A venda tem histórico financeiro, fiscal ou recorrente e não pode ser eliminada pelo Otto.",
          reason_code: "sale_history_preserved",
        };
      }
      const { data, error } = await ctx.supabaseUser.from("sales").delete()
        .eq("organization_id", ctx.orgId).eq("id", current.value.id).select("id, code").maybeSingle();
      if (error) return databaseFailure("delete_sale", error);
      if (!data) return scopeDenied();
      return { operation: "deleted", deleted_sale: data, resource: { type: "sale", id: data.id, route: "/sales" } };
    },
  },
];
