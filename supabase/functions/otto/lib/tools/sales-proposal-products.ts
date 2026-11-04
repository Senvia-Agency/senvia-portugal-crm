import { z } from "https://esm.sh/zod@3.25.76";

import type { Tool, ToolContext } from "../types.ts";
import {
  databaseFailure,
  loadScopedProposal,
  missingResource,
  parseArgs,
  TIMESTAMP_SCHEMA,
  UUID_SCHEMA,
} from "./sales-shared.ts";

const MONEY_MAX = 9_999_999_999.99;

const proposalProductSchema = z.object({
  product_id: UUID_SCHEMA,
  quantity: z.number().finite().positive().max(MONEY_MAX),
  unit_price: z.number().finite().nonnegative().max(MONEY_MAX),
  total: z.number().finite().nonnegative().max(MONEY_MAX),
}).strict().superRefine((item, refinement) => {
  const gross = Math.round(item.quantity * item.unit_price * 100) / 100;
  if (item.total > gross) {
    refinement.addIssue({ code: z.ZodIssueCode.custom, message: "total exceeds quantity times unit price", path: ["total"] });
  }
});

const replaceProductsSchema = z.object({
  proposal_id: UUID_SCHEMA,
  expected_updated_at: TIMESTAMP_SCHEMA,
  products: z.array(proposalProductSchema).min(1).max(100),
}).strict().superRefine((value, refinement) => {
  const ids = value.products.map((product) => product.product_id);
  if (new Set(ids).size !== ids.length) {
    refinement.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate product IDs", path: ["products"] });
  }
});

async function replacementPreview(args: Readonly<Record<string, unknown>>, ctx: ToolContext) {
  const parsed = parseArgs(replaceProductsSchema, args);
  if (!parsed.ok) return null;
  const proposal = await loadScopedProposal(ctx, parsed.value.proposal_id, "id, code, created_by, lead_id, updated_at");
  if (!proposal.ok || proposal.value.updated_at !== parsed.value.expected_updated_at) return null;
  const code = Reflect.get(proposal.value, "code");
  const total = parsed.value.products.reduce((sum, product) => sum + product.total, 0);
  return {
    title: "Substituir produtos da proposta",
    summary: `Substituir atomicamente os produtos da proposta ${typeof code === "string" ? code : proposal.value.id} por ${parsed.value.products.length} linha(s), total ${total.toFixed(2)} €.`,
    destination: "/proposals" as const,
  };
}

const replacementResultSchema = z.object({
  proposal_id: UUID_SCHEMA,
  total_value: z.coerce.number().nonnegative(),
  product_count: z.coerce.number().int().nonnegative(),
  updated_at: z.string(),
});

export const salesProposalProductTools: Tool[] = [
  {
    name: "replace_proposal_products",
    description: "Substituir atomicamente todas as linhas de produtos e sincronizar o total da proposta. Usa expected_updated_at devolvido por get_proposal_details para impedir sobrescritas concorrentes.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        proposal_id: { type: "string", format: "uuid" },
        expected_updated_at: { type: "string", format: "date-time" },
        products: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          uniqueItems: true,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              product_id: { type: "string", format: "uuid" },
              quantity: { type: "number", exclusiveMinimum: 0, maximum: MONEY_MAX },
              unit_price: { type: "number", minimum: 0, maximum: MONEY_MAX },
              total: { type: "number", minimum: 0, maximum: MONEY_MAX },
            },
            required: ["product_id", "quantity", "unit_price", "total"],
          },
        },
      },
      required: ["proposal_id", "expected_updated_at", "products"],
    },
    module: "proposals",
    permission: { module: "proposals", subarea: "proposals", action: "edit" },
    isWrite: true,
    confirmation: { kind: "confirmation_required", preview: replacementPreview },
    execute: async (args, ctx) => {
      const parsed = parseArgs(replaceProductsSchema, args);
      if (!parsed.ok) return parsed.failure;
      const proposal = await loadScopedProposal(ctx, parsed.value.proposal_id, "id, created_by, lead_id, updated_at");
      if (!proposal.ok) return proposal.failure;
      if (proposal.value.updated_at !== parsed.value.expected_updated_at) {
        return {
          error: "A proposta foi alterada entretanto.",
          reason_code: "stale_record",
          _instruction: "Consulta novamente get_proposal_details e prepara uma nova confirmação.",
        };
      }
      const productIds = parsed.value.products.map((product) => product.product_id);
      const { data: products, error: productError } = await ctx.supabaseAdmin.from("products")
        .select("id").eq("organization_id", ctx.orgId).eq("is_active", true).in("id", productIds);
      if (productError) return databaseFailure("validate_proposal_products", productError);
      if ((products ?? []).length !== productIds.length) return missingResource("Produto ativo");
      const { data, error } = await ctx.supabaseUser.rpc("replace_proposal_products", {
        p_organization_id: ctx.orgId,
        p_proposal_id: parsed.value.proposal_id,
        p_expected_updated_at: parsed.value.expected_updated_at,
        p_products: parsed.value.products,
      });
      if (error) return databaseFailure("replace_proposal_products", error);
      const result = replacementResultSchema.safeParse(Array.isArray(data) ? data[0] : data);
      if (!result.success) return databaseFailure("parse_replace_proposal_products", result.error);
      return {
        operation: "products_replaced",
        proposal: result.data,
        resource: { type: "proposal", id: result.data.proposal_id, route: "/proposals" },
      };
    },
  },
];
