import { z } from "https://esm.sh/zod@3.25.76";

import type { Tool, ToolContext } from "../types.ts";
import {
  databaseFailure,
  DATE_SCHEMA,
  loadScopedProposal,
  parseArgs,
  scopeDenied,
  UUID_SCHEMA,
  validateClientParent,
} from "./sales-shared.ts";

const PROPOSAL_COLUMNS = [
  "id", "code", "client_id", "lead_id", "total_value", "status", "notes",
  "proposal_date", "accepted_at", "created_by", "proposal_type", "negotiation_type",
  "consumo_anual", "margem", "dbl", "anos_contrato", "modelo_servico", "kwp",
  "comissao", "servicos_produtos", "servicos_details", "documents_checked",
  "contract_signed", "created_at", "updated_at",
].join(", ");

const proposalIdSchema = z.object({ proposal_id: UUID_SCHEMA }).strict();
const proposalLineSchema = z.object({
  id: UUID_SCHEMA,
  proposal_id: UUID_SCHEMA,
  product_id: UUID_SCHEMA,
  quantity: z.coerce.number(),
  unit_price: z.coerce.number(),
  total: z.coerce.number(),
  created_at: z.string().nullable(),
});
const productLabelSchema = z.object({
  id: UUID_SCHEMA,
  name: z.string(),
  is_active: z.boolean(),
});

const updateProposalSchema = z.object({
  proposal_id: UUID_SCHEMA,
  client_id: UUID_SCHEMA.nullable().optional(),
  total_value: z.number().finite().nonnegative().optional(),
  status: z.enum(["draft", "sent", "negotiating", "accepted", "rejected", "expired"]).optional(),
  notes: z.string().trim().max(10_000).nullable().optional(),
  proposal_date: DATE_SCHEMA.optional(),
  proposal_type: z.enum(["energia", "servicos"]).nullable().optional(),
  negotiation_type: z.enum(["angariacao", "angariacao_indexado", "renovacao", "sem_volume"]).nullable().optional(),
  consumo_anual: z.number().finite().nonnegative().nullable().optional(),
  margem: z.number().finite().nonnegative().nullable().optional(),
  dbl: z.number().finite().nonnegative().nullable().optional(),
  anos_contrato: z.number().int().positive().nullable().optional(),
  modelo_servico: z.enum(["transacional", "saas"]).nullable().optional(),
  kwp: z.number().finite().nonnegative().nullable().optional(),
  comissao: z.number().finite().nonnegative().nullable().optional(),
  documents_checked: z.boolean().nullable().optional(),
  contract_signed: z.boolean().nullable().optional(),
}).strict();

async function deletePreview(args: Readonly<Record<string, unknown>>, ctx: ToolContext) {
  const parsed = parseArgs(proposalIdSchema, args);
  if (!parsed.ok) return null;
  const proposal = await loadScopedProposal(ctx, parsed.value.proposal_id, "id, code, created_by, lead_id, updated_at");
  if (!proposal.ok) return null;
  const code = Reflect.get(proposal.value, "code");
  return {
    title: "Eliminar proposta",
    summary: `Eliminar permanentemente a proposta ${typeof code === "string" ? code : proposal.value.id}. A ação será recusada se já estiver ligada a uma venda.`,
    destination: "/proposals" as const,
  };
}

export const salesProposalTools: Tool[] = [
  {
    name: "get_proposal_details",
    description: "Consultar uma proposta nativa e os seus produtos. Devolve updated_at para edições atómicas posteriores.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { proposal_id: { type: "string", format: "uuid" } },
      required: ["proposal_id"],
    },
    module: "proposals",
    permission: { module: "proposals", subarea: "proposals", action: "view" },
    execute: async (args, ctx) => {
      const parsed = parseArgs(proposalIdSchema, args);
      if (!parsed.ok) return parsed.failure;
      const proposal = await loadScopedProposal(ctx, parsed.value.proposal_id, PROPOSAL_COLUMNS);
      if (!proposal.ok) return proposal.failure;
      const { data: lines, error: lineError } = await ctx.supabaseAdmin
        .from("proposal_products")
        .select("id, proposal_id, product_id, quantity, unit_price, total, created_at")
        .eq("proposal_id", proposal.value.id);
      if (lineError) return databaseFailure("load_proposal_products", lineError);
      const parsedLines = (lines ?? []).flatMap((line: unknown) => {
        const candidate = proposalLineSchema.safeParse(line);
        return candidate.success ? [candidate.data] : [];
      });
      const productIds = [...new Set(parsedLines.map((line) => line.product_id))];
      const productResult = productIds.length > 0
        ? await ctx.supabaseAdmin.from("products").select("id, name, is_active")
          .eq("organization_id", ctx.orgId).in("id", productIds)
        : { data: [], error: null };
      if (productResult.error) return databaseFailure("load_proposal_product_names", productResult.error);
      const productLabels = (productResult.data ?? []).flatMap((product: unknown) => {
        const candidate = productLabelSchema.safeParse(product);
        return candidate.success ? [candidate.data] : [];
      });
      const names = new Map(productLabels.map((product) => [product.id, product]));
      return {
        proposal: proposal.value,
        products: parsedLines.map((line) => ({ ...line, product: names.get(line.product_id) ?? null })),
        resource: { type: "proposal", id: proposal.value.id, route: "/proposals" },
      };
    },
  },
  {
    name: "update_proposal",
    description: "Editar campos tipados de uma proposta. Produtos são substituídos separadamente pelo contrato atómico.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        proposal_id: { type: "string", format: "uuid" },
        client_id: { type: ["string", "null"], format: "uuid" },
        total_value: { type: "number", minimum: 0 },
        status: { type: "string", enum: ["draft", "sent", "negotiating", "accepted", "rejected", "expired"] },
        notes: { type: ["string", "null"], maxLength: 10000 },
        proposal_date: { type: "string", format: "date" },
        proposal_type: { type: ["string", "null"], enum: ["energia", "servicos", null] },
        negotiation_type: { type: ["string", "null"], enum: ["angariacao", "angariacao_indexado", "renovacao", "sem_volume", null] },
        consumo_anual: { type: ["number", "null"], minimum: 0 },
        margem: { type: ["number", "null"], minimum: 0 },
        dbl: { type: ["number", "null"], minimum: 0 },
        anos_contrato: { type: ["integer", "null"], minimum: 1 },
        modelo_servico: { type: ["string", "null"], enum: ["transacional", "saas", null] },
        kwp: { type: ["number", "null"], minimum: 0 },
        comissao: { type: ["number", "null"], minimum: 0 },
        documents_checked: { type: ["boolean", "null"] },
        contract_signed: { type: ["boolean", "null"] },
      },
      required: ["proposal_id"],
    },
    module: "proposals",
    permission: { module: "proposals", subarea: "proposals", action: "edit" },
    isWrite: true,
    confirmation: { kind: "immediate" },
    execute: async (args, ctx) => {
      const parsed = parseArgs(updateProposalSchema, args);
      if (!parsed.ok) return parsed.failure;
      const { proposal_id: proposalId, ...requestedUpdates } = parsed.value;
      if (Object.keys(requestedUpdates).length === 0) return { error: "Nenhum campo editável foi indicado.", reason_code: "empty_update" };
      const current = await loadScopedProposal(ctx, proposalId, "id, code, created_by, lead_id, updated_at");
      if (!current.ok) return current.failure;
      if (requestedUpdates.client_id) {
        const invalid = await validateClientParent(ctx, requestedUpdates.client_id);
        if (invalid) return invalid;
      }
      if (requestedUpdates.total_value !== undefined) {
        const lines = await ctx.supabaseAdmin.from("proposal_products")
          .select("id", { count: "exact", head: true }).eq("proposal_id", proposalId);
        if (lines.error) return databaseFailure("check_proposal_product_total", lines.error);
        if ((lines.count ?? 0) > 0) {
          return {
            error: "O total desta proposta é calculado pelos produtos.",
            reason_code: "proposal_total_derived",
            _instruction: "Usa replace_proposal_products com o updated_at atual para alterar linhas e total atomicamente.",
          };
        }
      }
      const updates = requestedUpdates.status === "accepted"
        ? { ...requestedUpdates, accepted_at: new Date().toISOString() }
        : requestedUpdates;
      const { data, error } = await ctx.supabaseUser.from("proposals").update(updates)
        .eq("organization_id", ctx.orgId).eq("id", proposalId)
        .select("id, code, status, total_value, updated_at").maybeSingle();
      if (error) return databaseFailure("update_proposal", error);
      if (!data) return scopeDenied();
      return { operation: "updated", proposal: data, resource: { type: "proposal", id: data.id, route: "/proposals" } };
    },
  },
  {
    name: "delete_proposal",
    description: "Eliminar uma proposta sem venda ligada. Exige confirmação explícita e preserva o histórico de vendas.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { proposal_id: { type: "string", format: "uuid" } },
      required: ["proposal_id"],
    },
    module: "proposals",
    permission: { module: "proposals", subarea: "proposals", action: "delete" },
    isWrite: true,
    confirmation: { kind: "confirmation_required", preview: deletePreview },
    execute: async (args, ctx) => {
      const parsed = parseArgs(proposalIdSchema, args);
      if (!parsed.ok) return parsed.failure;
      const current = await loadScopedProposal(ctx, parsed.value.proposal_id, "id, code, created_by, lead_id, updated_at");
      if (!current.ok) return current.failure;
      const linked = await ctx.supabaseAdmin.from("sales").select("id", { count: "exact", head: true })
        .eq("organization_id", ctx.orgId).eq("proposal_id", current.value.id);
      if (linked.error) return databaseFailure("check_proposal_sales", linked.error);
      if ((linked.count ?? 0) > 0) {
        return { error: "A proposta está ligada a uma venda e o histórico será preservado.", reason_code: "proposal_has_sale" };
      }
      const { data, error } = await ctx.supabaseUser.from("proposals").delete()
        .eq("organization_id", ctx.orgId).eq("id", current.value.id).select("id, code").maybeSingle();
      if (error) return databaseFailure("delete_proposal", error);
      if (!data) return scopeDenied();
      return { operation: "deleted", deleted_proposal: data, resource: { type: "proposal", id: data.id, route: "/proposals" } };
    },
  },
];
