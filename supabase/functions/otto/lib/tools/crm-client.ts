import { z } from "https://esm.sh/zod@3.25.76";

import type { Tool, ToolContext } from "../types.ts";
import {
  databaseFailure,
  loadScopedClient,
  parseArgs,
  scopeDenied,
  UUID_SCHEMA,
  validateAssignee,
} from "./crm-shared.ts";

const clientIdSchema = z.object({ client_id: UUID_SCHEMA }).strict();

const updateClientSchema = z.object({
  client_id: UUID_SCHEMA,
  name: z.string().trim().min(1).max(250).optional(),
  email: z.string().trim().email().max(320).nullable().optional(),
  phone: z.string().trim().max(80).nullable().optional(),
  company: z.string().trim().max(250).nullable().optional(),
  nif: z.string().trim().max(50).nullable().optional(),
  company_nif: z.string().trim().max(50).nullable().optional(),
  billing_target: z.enum(["client", "company"]).optional(),
  status: z.enum(["active", "inactive", "vip"]).optional(),
  source: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(10_000).nullable().optional(),
  address_line1: z.string().trim().max(250).nullable().optional(),
  address_line2: z.string().trim().max(250).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  postal_code: z.string().trim().max(30).nullable().optional(),
  country: z.string().trim().max(100).nullable().optional(),
  company_address_same_as_client: z.boolean().optional(),
  company_address_line1: z.string().trim().max(250).nullable().optional(),
  company_address_line2: z.string().trim().max(250).nullable().optional(),
  company_city: z.string().trim().max(120).nullable().optional(),
  company_postal_code: z.string().trim().max(30).nullable().optional(),
  company_country: z.string().trim().max(100).nullable().optional(),
  distrito: z.string().trim().max(120).nullable().optional(),
  conselho: z.string().trim().max(120).nullable().optional(),
  grupo_economico: z.string().trim().max(200).nullable().optional(),
  assigned_to: UUID_SCHEMA.nullable().optional(),
  fiscal_auto_receipts: z.boolean().optional(),
  fiscal_auto_email: z.boolean().optional(),
  fiscal_auto_invoices: z.boolean().optional(),
}).strict();

async function deletePreview(
  args: Readonly<Record<string, unknown>>,
  ctx: ToolContext,
) {
  const parsed = parseArgs(clientIdSchema, args);
  if (!parsed.ok) return null;
  const client = await loadScopedClient(ctx, parsed.value.client_id, "id, name, assigned_to");
  if (!client.ok) return null;
  const name = Reflect.get(client.value, "name");
  return {
    title: "Eliminar cliente",
    summary: `Eliminar permanentemente o cliente “${typeof name === "string" ? name : client.value.id}”. A ação será recusada se existirem propostas, vendas ou CPEs ligados.`,
    destination: "/clients" as const,
  };
}

export const crmClientTools: Tool[] = [
  {
    name: "update_client",
    description: "Editar os campos permitidos de um cliente nativo, incluindo moradas, estado, notas, responsável e preferências fiscais.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        client_id: { type: "string", format: "uuid" },
        name: { type: "string", minLength: 1, maxLength: 250 },
        email: { type: ["string", "null"], format: "email" },
        phone: { type: ["string", "null"], maxLength: 80 },
        company: { type: ["string", "null"], maxLength: 250 },
        nif: { type: ["string", "null"], maxLength: 50 },
        company_nif: { type: ["string", "null"], maxLength: 50 },
        billing_target: { type: "string", enum: ["client", "company"] },
        status: { type: "string", enum: ["active", "inactive", "vip"] },
        source: { type: ["string", "null"], maxLength: 120 },
        notes: { type: ["string", "null"], maxLength: 10000 },
        address_line1: { type: ["string", "null"], maxLength: 250 },
        address_line2: { type: ["string", "null"], maxLength: 250 },
        city: { type: ["string", "null"], maxLength: 120 },
        postal_code: { type: ["string", "null"], maxLength: 30 },
        country: { type: ["string", "null"], maxLength: 100 },
        company_address_same_as_client: { type: "boolean" },
        company_address_line1: { type: ["string", "null"], maxLength: 250 },
        company_address_line2: { type: ["string", "null"], maxLength: 250 },
        company_city: { type: ["string", "null"], maxLength: 120 },
        company_postal_code: { type: ["string", "null"], maxLength: 30 },
        company_country: { type: ["string", "null"], maxLength: 100 },
        distrito: { type: ["string", "null"], maxLength: 120 },
        conselho: { type: ["string", "null"], maxLength: 120 },
        grupo_economico: { type: ["string", "null"], maxLength: 200 },
        assigned_to: { type: ["string", "null"], format: "uuid" },
        fiscal_auto_receipts: { type: "boolean" },
        fiscal_auto_email: { type: "boolean" },
        fiscal_auto_invoices: { type: "boolean" },
      },
      required: ["client_id"],
    },
    module: "clients",
    permission: { module: "clients", subarea: "list", action: "edit" },
    isWrite: true,
    confirmation: { kind: "immediate" },
    execute: async (args, ctx) => {
      const parsed = parseArgs(updateClientSchema, args);
      if (!parsed.ok) return parsed.failure;
      const { client_id: clientId, ...updates } = parsed.value;
      if (Object.keys(updates).length === 0) {
        return { error: "Nenhum campo editável foi indicado.", reason_code: "empty_update" };
      }
      const current = await loadScopedClient(ctx, clientId, "id, assigned_to");
      if (!current.ok) return current.failure;
      if ("assigned_to" in updates) {
        if (updates.assigned_to) {
          const invalid = await validateAssignee(ctx, updates.assigned_to);
          if (invalid) return invalid;
        } else if (ctx.dataScope !== "all") {
          return scopeDenied();
        }
      }
      const { data, error } = await ctx.supabaseUser
        .from("crm_clients")
        .update(updates)
        .eq("organization_id", ctx.orgId)
        .eq("id", clientId)
        .select("id, name, status, assigned_to, updated_at")
        .maybeSingle();
      if (error) return databaseFailure("update_client", error);
      if (!data) return scopeDenied();
      return {
        operation: "updated",
        client: data,
        resource: { type: "client", id: data.id, route: "/clients" },
      };
    },
  },
  {
    name: "delete_client_permanently",
    description: "Eliminar permanentemente um único cliente. Exige confirmação e nunca aceita eliminação em massa.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { client_id: { type: "string", format: "uuid" } },
      required: ["client_id"],
    },
    module: "clients",
    permission: { module: "clients", subarea: "list", action: "delete" },
    isWrite: true,
    confirmation: { kind: "confirmation_required", preview: deletePreview },
    execute: async (args, ctx) => {
      const parsed = parseArgs(clientIdSchema, args);
      if (!parsed.ok) return parsed.failure;
      const current = await loadScopedClient(ctx, parsed.value.client_id, "id, name, assigned_to");
      if (!current.ok) return current.failure;
      const [proposals, sales, cpes] = await Promise.all([
        ctx.supabaseAdmin.from("proposals").select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.orgId).eq("client_id", current.value.id),
        ctx.supabaseAdmin.from("sales").select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.orgId).eq("client_id", current.value.id),
        ctx.supabaseAdmin.from("cpes").select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.orgId).eq("client_id", current.value.id),
      ]);
      if (proposals.error) return databaseFailure("check_client_proposals", proposals.error);
      if (sales.error) return databaseFailure("check_client_sales", sales.error);
      if (cpes.error) return databaseFailure("check_client_cpes", cpes.error);
      if ((proposals.count ?? 0) + (sales.count ?? 0) + (cpes.count ?? 0) > 0) {
        return {
          error: "O cliente tem histórico ligado e não pode ser eliminado pelo Otto.",
          reason_code: "client_history_preserved",
        };
      }
      const { data, error } = await ctx.supabaseUser
        .from("crm_clients")
        .delete()
        .eq("organization_id", ctx.orgId)
        .eq("id", current.value.id)
        .select("id, name")
        .maybeSingle();
      if (error) return databaseFailure("delete_client", error);
      if (!data) return scopeDenied();
      return {
        operation: "deleted",
        deleted_client: data,
        resource: { type: "client", id: data.id, route: "/clients" },
      };
    },
  },
];
