import { z } from "https://esm.sh/zod@3.25.76";

import type { Tool, ToolContext } from "../types.ts";
import {
  databaseFailure,
  loadScopedLead,
  parseArgs,
  scopeDenied,
  UUID_SCHEMA,
} from "./crm-shared.ts";

const leadIdSchema = z.object({ lead_id: UUID_SCHEMA }).strict();

async function deletePreview(
  args: Readonly<Record<string, unknown>>,
  ctx: ToolContext,
) {
  const parsed = parseArgs(leadIdSchema, args);
  if (!parsed.ok) return null;
  const lead = await loadScopedLead(ctx, parsed.value.lead_id, "id, name, assigned_to");
  if (!lead.ok) return null;
  const name = Reflect.get(lead.value, "name");
  return {
    title: "Eliminar lead permanentemente",
    summary: `Eliminar permanentemente a lead “${typeof name === "string" ? name : lead.value.id}”. A ação será recusada se existirem cliente, propostas ou vendas ligadas.`,
    destination: "/leads" as const,
  };
}

async function setArchived(
  args: Readonly<Record<string, unknown>>,
  ctx: ToolContext,
  archived: boolean,
) {
  const parsed = parseArgs(leadIdSchema, args);
  if (!parsed.ok) return parsed.failure;
  const current = await loadScopedLead(ctx, parsed.value.lead_id, "id, name, assigned_to, archived_at");
  if (!current.ok) return current.failure;
  const isArchived = typeof Reflect.get(current.value, "archived_at") === "string";
  if (isArchived === archived) {
    return {
      operation: archived ? "already_archived" : "already_active",
      resource: { type: "lead", id: current.value.id, route: "/leads" },
    };
  }
  const { data, error } = await ctx.supabaseUser
    .from("leads")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("organization_id", ctx.orgId)
    .eq("id", current.value.id)
    .select("id, name, archived_at")
    .maybeSingle();
  if (error) return databaseFailure(archived ? "archive_lead" : "restore_lead", error);
  if (!data) return scopeDenied();
  return {
    operation: archived ? "archived" : "restored",
    lead: data,
    resource: { type: "lead", id: data.id, route: "/leads" },
  };
}

export const crmLeadLifecycleTools: Tool[] = [
  {
    name: "archive_lead",
    description: "Arquivar uma única lead de forma reversível. Não executa operações em massa.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { lead_id: { type: "string", format: "uuid" } },
      required: ["lead_id"],
    },
    module: "leads",
    permission: { module: "leads", subarea: "kanban", action: "edit" },
    isWrite: true,
    confirmation: { kind: "immediate" },
    execute: (args, ctx) => setArchived(args, ctx, true),
  },
  {
    name: "restore_lead",
    description: "Restaurar uma única lead arquivada para a lista ativa.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { lead_id: { type: "string", format: "uuid" } },
      required: ["lead_id"],
    },
    module: "leads",
    permission: { module: "leads", subarea: "kanban", action: "edit" },
    isWrite: true,
    confirmation: { kind: "immediate" },
    execute: (args, ctx) => setArchived(args, ctx, false),
  },
  {
    name: "delete_lead_permanently",
    description: "Eliminar permanentemente uma única lead por motivo RGPD. Exige confirmação explícita e nunca aceita uma lista de IDs.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { lead_id: { type: "string", format: "uuid" } },
      required: ["lead_id"],
    },
    module: "leads",
    permission: { module: "leads", subarea: "kanban", action: "delete" },
    isWrite: true,
    confirmation: { kind: "confirmation_required", preview: deletePreview },
    execute: async (args, ctx) => {
      const parsed = parseArgs(leadIdSchema, args);
      if (!parsed.ok) return parsed.failure;
      const current = await loadScopedLead(ctx, parsed.value.lead_id, "id, name, assigned_to");
      if (!current.ok) return current.failure;
      const [clients, proposals, sales] = await Promise.all([
        ctx.supabaseAdmin.from("crm_clients").select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.orgId).eq("lead_id", current.value.id),
        ctx.supabaseAdmin.from("proposals").select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.orgId).eq("lead_id", current.value.id),
        ctx.supabaseAdmin.from("sales").select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.orgId).eq("lead_id", current.value.id),
      ]);
      if (clients.error) return databaseFailure("check_lead_clients", clients.error);
      if (proposals.error) return databaseFailure("check_lead_proposals", proposals.error);
      if (sales.error) return databaseFailure("check_lead_sales", sales.error);
      if ((clients.count ?? 0) + (proposals.count ?? 0) + (sales.count ?? 0) > 0) {
        return {
          error: "A lead tem histórico ligado e não pode ser eliminada pelo Otto.",
          reason_code: "lead_history_preserved",
          _instruction: "Sugere arquivar a lead ou tratar o pedido RGPD pela interface com revisão do histórico.",
        };
      }
      const { data, error } = await ctx.supabaseUser
        .from("leads")
        .delete()
        .eq("organization_id", ctx.orgId)
        .eq("id", current.value.id)
        .select("id, name")
        .maybeSingle();
      if (error) return databaseFailure("delete_lead", error);
      if (!data) return scopeDenied();
      return {
        operation: "deleted",
        deleted_lead: data,
        resource: { type: "lead", id: data.id, route: "/leads" },
      };
    },
  },
];
