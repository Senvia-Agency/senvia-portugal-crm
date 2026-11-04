import { z } from "https://esm.sh/zod@3.25.76";

import type { Tool } from "../types.ts";
import {
  databaseFailure,
  loadScopedLead,
  parseArgs,
  scopeDenied,
  UUID_SCHEMA,
  validateAssignee,
} from "./crm-shared.ts";

const LEAD_COLUMNS = [
  "id", "name", "email", "phone", "status", "temperature", "source",
  "value", "notes", "gdpr_consent", "automation_enabled", "assigned_to",
  "tipologia", "consumo_anual", "company_nif", "company_name", "custom_data",
  "archived_at", "created_at", "updated_at",
].join(", ");

const detailSchema = z.object({ lead_id: UUID_SCHEMA }).strict();

const updateSchema = z.object({
  lead_id: UUID_SCHEMA,
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().max(320).optional(),
  phone: z.string().trim().min(1).max(80).optional(),
  source: z.string().trim().max(120).nullable().optional(),
  temperature: z.enum(["cold", "warm", "hot"]).nullable().optional(),
  value: z.number().finite().nonnegative().nullable().optional(),
  notes: z.string().trim().max(10_000).nullable().optional(),
  gdpr_consent: z.boolean().optional(),
  automation_enabled: z.boolean().optional(),
  tipologia: z.enum(["ee", "gas", "servicos", "ee_servicos"]).nullable().optional(),
  consumo_anual: z.number().finite().nonnegative().nullable().optional(),
  company_nif: z.string().trim().max(50).nullable().optional(),
  company_name: z.string().trim().max(250).nullable().optional(),
}).strict();

const assignSchema = z.object({
  lead_id: UUID_SCHEMA,
  assigned_to_user_id: UUID_SCHEMA.nullable(),
}).strict();

export const crmLeadTools: Tool[] = [
  {
    name: "get_lead_details",
    description: "Consultar os campos editáveis de uma lead pelo UUID, respeitando organização e âmbito own/team/all.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { lead_id: { type: "string", format: "uuid" } },
      required: ["lead_id"],
    },
    module: "leads",
    permission: { module: "leads", subarea: "kanban", action: "view" },
    execute: async (args, ctx) => {
      const parsed = parseArgs(detailSchema, args);
      if (!parsed.ok) return parsed.failure;
      const lead = await loadScopedLead(ctx, parsed.value.lead_id, LEAD_COLUMNS);
      return lead.ok
        ? { lead: lead.value, resource: { type: "lead", id: lead.value.id, route: "/leads" } }
        : lead.failure;
    },
  },
  {
    name: "update_lead",
    description: "Editar apenas campos CRM permitidos de uma lead existente. Para etapa ou responsável usa as ferramentas específicas.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        lead_id: { type: "string", format: "uuid" },
        name: { type: "string", minLength: 1, maxLength: 200 },
        email: { type: "string", format: "email" },
        phone: { type: "string", minLength: 1, maxLength: 80 },
        source: { type: ["string", "null"], maxLength: 120 },
        temperature: { type: ["string", "null"], enum: ["cold", "warm", "hot", null] },
        value: { type: ["number", "null"], minimum: 0 },
        notes: { type: ["string", "null"], maxLength: 10000 },
        gdpr_consent: { type: "boolean" },
        automation_enabled: { type: "boolean" },
        tipologia: { type: ["string", "null"], enum: ["ee", "gas", "servicos", "ee_servicos", null] },
        consumo_anual: { type: ["number", "null"], minimum: 0 },
        company_nif: { type: ["string", "null"], maxLength: 50 },
        company_name: { type: ["string", "null"], maxLength: 250 },
      },
      required: ["lead_id"],
    },
    module: "leads",
    permission: { module: "leads", subarea: "kanban", action: "edit" },
    isWrite: true,
    confirmation: { kind: "immediate" },
    execute: async (args, ctx) => {
      const parsed = parseArgs(updateSchema, args);
      if (!parsed.ok) return parsed.failure;
      const { lead_id: leadId, ...updates } = parsed.value;
      if (Object.keys(updates).length === 0) {
        return { error: "Nenhum campo editável foi indicado.", reason_code: "empty_update" };
      }
      const current = await loadScopedLead(ctx, leadId, "id, assigned_to");
      if (!current.ok) return current.failure;
      const { data, error } = await ctx.supabaseUser
        .from("leads")
        .update(updates)
        .eq("organization_id", ctx.orgId)
        .eq("id", leadId)
        .select("id, name, updated_at")
        .maybeSingle();
      if (error) return databaseFailure("update_lead", error);
      if (!data) return scopeDenied();
      return {
        operation: "updated",
        lead: data,
        resource: { type: "lead", id: data.id, route: "/leads" },
      };
    },
  },
  {
    name: "assign_lead",
    description: "Atribuir uma lead a um membro ativo permitido pelo âmbito do utilizador, ou remover a atribuição quando tem âmbito all.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        lead_id: { type: "string", format: "uuid" },
        assigned_to_user_id: { type: ["string", "null"], format: "uuid" },
      },
      required: ["lead_id", "assigned_to_user_id"],
    },
    module: "leads",
    permission: { module: "leads", subarea: "kanban", action: "assign" },
    isWrite: true,
    confirmation: { kind: "immediate" },
    execute: async (args, ctx) => {
      const parsed = parseArgs(assignSchema, args);
      if (!parsed.ok) return parsed.failure;
      const current = await loadScopedLead(ctx, parsed.value.lead_id, "id, assigned_to");
      if (!current.ok) return current.failure;
      const assigneeId = parsed.value.assigned_to_user_id;
      if (assigneeId) {
        const invalid = await validateAssignee(ctx, assigneeId);
        if (invalid) return invalid;
      } else if (ctx.dataScope !== "all") {
        return scopeDenied();
      }
      const { data, error } = await ctx.supabaseUser
        .from("leads")
        .update({ assigned_to: assigneeId })
        .eq("organization_id", ctx.orgId)
        .eq("id", parsed.value.lead_id)
        .select("id, name, assigned_to")
        .maybeSingle();
      if (error) return databaseFailure("assign_lead", error);
      if (!data) return scopeDenied();
      return {
        operation: "assigned",
        lead: data,
        resource: { type: "lead", id: data.id, route: "/leads" },
      };
    },
  },
];
