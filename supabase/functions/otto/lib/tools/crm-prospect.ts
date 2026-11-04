import { z } from "https://esm.sh/zod@3.25.76";

import { filterAccessibleRecords } from "../record-scope.ts";
import type { Tool, ToolContext } from "../types.ts";
import {
  databaseFailure,
  loadScopedProspect,
  missingResource,
  parseArgs,
  scopeDenied,
  UUID_SCHEMA,
  validateAssignee,
} from "./crm-shared.ts";

const PROSPECT_COLUMNS = [
  "id", "company_name", "contact_name", "email", "phone", "nif", "cpe",
  "segment", "status", "annual_consumption_kwh", "observations", "source",
  "source_file_name", "imported_at", "imported_by", "assigned_to", "assigned_at",
  "converted_to_lead", "converted_lead_id", "converted_at", "metadata", "created_at", "updated_at",
].join(", ");

const prospectSchema = z.object({
  id: UUID_SCHEMA,
  company_name: z.string(),
  assigned_to: UUID_SCHEMA.nullable(),
  status: z.string(),
}).passthrough();

const distributionProspectSchema = z.object({
  id: UUID_SCHEMA,
  assigned_to: UUID_SCHEMA.nullable(),
  converted_to_lead: z.boolean(),
});

const searchSchema = z.object({
  query: z.string().trim().max(250).optional().default(""),
  status: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(25).optional().default(10),
}).strict();

const detailSchema = z.object({ prospect_id: UUID_SCHEMA }).strict();

const distributeSchema = z.object({
  prospect_ids: z.array(UUID_SCHEMA).min(1).max(100),
  quantity: z.number().int().min(1).max(100),
  salesperson_ids: z.array(UUID_SCHEMA).min(1).max(50).optional(),
}).strict();

function normalize(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-PT")
    : "";
}

async function distributionPreview(args: Readonly<Record<string, unknown>>, _ctx: ToolContext) {
  const parsed = parseArgs(distributeSchema, args);
  if (!parsed.ok || parsed.value.quantity > parsed.value.prospect_ids.length) return null;
  const recipients = parsed.value.salesperson_ids?.length ?? 0;
  return {
    title: "Distribuir prospects",
    summary: `Distribuir ${parsed.value.quantity} prospect(s) selecionado(s)${recipients ? ` por ${recipients} comercial(is)` : " pelos comerciais elegíveis"} e criar as leads correspondentes.`,
    destination: "/prospects" as const,
  };
}

export const crmProspectTools: Tool[] = [
  {
    name: "search_prospects",
    description: "Pesquisar prospects por empresa, contacto, email, telefone, NIF ou CPE, com filtros de organização e data_scope.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", maxLength: 250 },
        status: { type: "string", maxLength: 100 },
        limit: { type: "integer", minimum: 1, maximum: 25, default: 10 },
      },
      required: [],
    },
    module: "prospects",
    permission: { module: "prospects", subarea: "prospects", action: "view" },
    execute: async (args, ctx) => {
      const parsed = parseArgs(searchSchema, args);
      if (!parsed.ok) return parsed.failure;
      const { data, error } = await ctx.supabaseAdmin
        .from("prospects")
        .select(PROSPECT_COLUMNS)
        .eq("organization_id", ctx.orgId)
        .order("imported_at", { ascending: false })
        .limit(5000);
      if (error) return databaseFailure("search_prospects", error);
      const rows = (data ?? []).flatMap((row: unknown) => {
        const candidate = prospectSchema.safeParse(row);
        return candidate.success ? [candidate.data] : [];
      });
      const scoped = filterAccessibleRecords(ctx, rows);
      const query = normalize(parsed.value.query);
      const filtered = scoped.filter((row) => {
        if (parsed.value.status && row.status !== parsed.value.status) return false;
        if (!query) return true;
        return ["company_name", "contact_name", "email", "phone", "nif", "cpe"]
          .some((key) => normalize(Reflect.get(row, key)).includes(query));
      }).slice(0, parsed.value.limit);
      return { results: filtered, count: filtered.length, route: "/prospects" };
    },
  },
  {
    name: "get_prospect_details",
    description: "Consultar um prospect nativo pelo UUID, incluindo estado de distribuição e ligação à lead criada.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { prospect_id: { type: "string", format: "uuid" } },
      required: ["prospect_id"],
    },
    module: "prospects",
    permission: { module: "prospects", subarea: "prospects", action: "view" },
    execute: async (args, ctx) => {
      const parsed = parseArgs(detailSchema, args);
      if (!parsed.ok) return parsed.failure;
      const prospect = await loadScopedProspect(ctx, parsed.value.prospect_id, PROSPECT_COLUMNS);
      return prospect.ok
        ? { prospect: prospect.value, resource: { type: "prospect", id: prospect.value.id, route: "/prospects" } }
        : prospect.failure;
    },
  },
  {
    name: "distribute_prospects",
    description: "Distribuir até 100 prospects selecionados pelo RPC nativo round-robin e criar leads de forma transacional. Opera apenas sobre prospects ainda não atribuídos/convertidos.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        prospect_ids: { type: "array", minItems: 1, maxItems: 100, uniqueItems: true, items: { type: "string", format: "uuid" } },
        quantity: { type: "integer", minimum: 1, maximum: 100 },
        salesperson_ids: { type: "array", minItems: 1, maxItems: 50, uniqueItems: true, items: { type: "string", format: "uuid" } },
      },
      required: ["prospect_ids", "quantity"],
    },
    module: "prospects",
    permission: { module: "prospects", subarea: "prospects", action: "assign" },
    isWrite: true,
    confirmation: { kind: "confirmation_required", preview: distributionPreview },
    execute: async (args, ctx) => {
      const parsed = parseArgs(distributeSchema, args);
      if (!parsed.ok) return parsed.failure;
      const prospectIds = [...new Set(parsed.value.prospect_ids)];
      if (parsed.value.quantity > prospectIds.length) {
        return { error: "A quantidade excede os prospects selecionados.", reason_code: "invalid_quantity" };
      }
      if (ctx.dataScope !== "all") return scopeDenied();
      const { data: prospects, error: prospectError } = await ctx.supabaseAdmin
        .from("prospects")
        .select("id, assigned_to, converted_to_lead")
        .eq("organization_id", ctx.orgId)
        .in("id", prospectIds);
      if (prospectError) return databaseFailure("validate_prospect_distribution", prospectError);
      const selectedProspects = (prospects ?? []).flatMap((row: unknown) => {
        const candidate = distributionProspectSchema.safeParse(row);
        return candidate.success ? [candidate.data] : [];
      });
      if (selectedProspects.length !== prospectIds.length) return missingResource("Prospect");
      if (selectedProspects.some((row) => row.assigned_to || row.converted_to_lead)) {
        return { error: "Um ou mais prospects já foram distribuídos.", reason_code: "prospect_not_available" };
      }
      const salespersonIds = parsed.value.salesperson_ids
        ? [...new Set(parsed.value.salesperson_ids)]
        : undefined;
      for (const salespersonId of salespersonIds ?? []) {
        const invalid = await validateAssignee(ctx, salespersonId);
        if (invalid) return invalid;
      }
      const { data, error } = await ctx.supabaseUser.rpc("distribute_prospects_round_robin", {
        p_organization_id: ctx.orgId,
        p_prospect_ids: prospectIds,
        p_quantity: parsed.value.quantity,
        p_salesperson_ids: salespersonIds ?? null,
      });
      if (error) return databaseFailure("distribute_prospects", error);
      const result = z.object({
        distributed_count: z.coerce.number().int().nonnegative(),
        created_leads_count: z.coerce.number().int().nonnegative(),
      }).safeParse(Array.isArray(data) ? data[0] : data);
      if (!result.success) return databaseFailure("parse_prospect_distribution", result.error);
      return {
        operation: "distributed",
        ...result.data,
        affected_prospect_ids: prospectIds.slice(0, parsed.value.quantity),
        resource: { type: "prospect", id: prospectIds[0], route: "/prospects" },
      };
    },
  },
];
