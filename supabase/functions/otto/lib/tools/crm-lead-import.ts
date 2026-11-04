import { z } from "https://esm.sh/zod@3.25.76";

import type { Tool, ToolContext } from "../types.ts";
import {
  databaseFailure,
  parseArgs,
  resolveStageKey,
  scopeDenied,
  UUID_SCHEMA,
  validateAssignee,
} from "./crm-shared.ts";

const leadImportRowSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320).nullable().optional(),
  phone: z.string().trim().max(80).nullable().optional(),
  company_name: z.string().trim().max(250).nullable().optional(),
  company_nif: z.string().trim().max(50).nullable().optional(),
  source: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(10_000).nullable().optional(),
  value: z.number().finite().nonnegative().nullable().optional(),
}).strict();

const leadImportSchema = z.object({
  name: z.string().trim().min(1).max(160),
  file_name: z.string().trim().max(255).nullable().optional(),
  stage: z.string().trim().min(1).max(120),
  assignee_ids: z.array(UUID_SCHEMA).min(1).max(50),
  rows: z.array(leadImportRowSchema).min(1).max(200),
}).strict();

async function importPreview(args: Readonly<Record<string, unknown>>, _ctx: ToolContext) {
  const parsed = parseArgs(leadImportSchema, args);
  if (!parsed.ok) return null;
  return {
    title: "Importar leads",
    summary: `Importar ${parsed.value.rows.length} linha(s) no lote “${parsed.value.name}”, na etapa “${parsed.value.stage}”, com distribuição por ${parsed.value.assignee_ids.length} responsável(eis).`,
    destination: "/leads" as const,
  };
}

function dedupeRows(rows: z.infer<typeof leadImportRowSchema>[]) {
  const result: z.infer<typeof leadImportRowSchema>[] = [];
  const emailIndex = new Map<string, number>();
  for (const row of rows) {
    const email = row.email?.trim().toLocaleLowerCase("en-US") ?? "";
    if (email) {
      const existingIndex = emailIndex.get(email);
      if (existingIndex !== undefined) {
        result[existingIndex] = row;
        continue;
      }
      emailIndex.set(email, result.length);
    }
    result.push(row);
  }
  return result;
}

export const crmLeadImportTools: Tool[] = [
  {
    name: "bulk_import_leads",
    description: "Importar até 200 leads estruturadas pelo RPC nativo, com upsert por email, histórico de importação e responsáveis validados. Requer âmbito all para não atualizar duplicados fora do scope.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1, maxLength: 160 },
        file_name: { type: ["string", "null"], maxLength: 255 },
        stage: { type: "string", minLength: 1, maxLength: 120 },
        assignee_ids: { type: "array", minItems: 1, maxItems: 50, items: { type: "string", format: "uuid" } },
        rows: {
          type: "array",
          minItems: 1,
          maxItems: 200,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string", minLength: 1, maxLength: 200 },
              email: { type: ["string", "null"], format: "email" },
              phone: { type: ["string", "null"], maxLength: 80 },
              company_name: { type: ["string", "null"], maxLength: 250 },
              company_nif: { type: ["string", "null"], maxLength: 50 },
              source: { type: ["string", "null"], maxLength: 120 },
              notes: { type: ["string", "null"], maxLength: 10000 },
              value: { type: ["number", "null"], minimum: 0 },
            },
            required: ["name"],
          },
        },
      },
      required: ["name", "stage", "assignee_ids", "rows"],
    },
    module: "leads",
    permission: { module: "leads", subarea: "export", action: "import" },
    isWrite: true,
    confirmation: { kind: "confirmation_required", preview: importPreview },
    execute: async (args, ctx) => {
      const parsed = parseArgs(leadImportSchema, args);
      if (!parsed.ok) return parsed.failure;
      if (ctx.dataScope !== "all") return scopeDenied();
      const assigneeIds = [...new Set(parsed.value.assignee_ids)];
      for (const assigneeId of assigneeIds) {
        const invalid = await validateAssignee(ctx, assigneeId);
        if (invalid) return invalid;
      }
      const stage = await resolveStageKey(ctx, parsed.value.stage);
      if (!stage.ok) return stage.failure;
      const importCode = `IMP-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
      const { data: importRecord, error: importError } = await ctx.supabaseUser
        .from("lead_imports")
        .insert({
          organization_id: ctx.orgId,
          imported_by: ctx.userId,
          import_code: importCode,
          name: parsed.value.name,
          file_name: parsed.value.file_name ?? null,
          stage_key: stage.value,
          assignee_ids: assigneeIds,
        })
        .select("id")
        .single();
      if (importError) return databaseFailure("create_lead_import", importError);
      const rows = dedupeRows(parsed.value.rows);
      const payloads = rows.map((row, index) => ({
        organization_id: ctx.orgId,
        assigned_to: assigneeIds[index % assigneeIds.length],
        status: stage.value,
        name: row.name,
        email: row.email ?? "",
        phone: row.phone ?? "",
        company_name: row.company_name ?? null,
        company_nif: row.company_nif ?? null,
        source: row.source ?? "Importação Otto",
        notes: row.notes ?? null,
        value: row.value ?? null,
        gdpr_consent: true,
        automation_enabled: false,
        import_id: importRecord.id,
      }));
      const { data, error } = await ctx.supabaseUser.rpc("import_leads_bulk", { p_leads: payloads });
      if (error) {
        await ctx.supabaseUser.from("lead_imports").update({
          total_inserted: 0,
          total_failed: payloads.length,
          first_error: "A importação nativa falhou.",
        }).eq("id", importRecord.id).eq("organization_id", ctx.orgId);
        return databaseFailure("bulk_import_leads", error);
      }
      const totals = z.object({ inserted: z.coerce.number(), updated: z.coerce.number() }).safeParse(data);
      if (!totals.success) return databaseFailure("parse_lead_import_result", totals.error);
      const finalized = await ctx.supabaseUser.from("lead_imports").update({
        total_inserted: totals.data.inserted + totals.data.updated,
        total_failed: 0,
        first_error: null,
      }).eq("id", importRecord.id).eq("organization_id", ctx.orgId);
      if (finalized.error) {
        return {
          error: "As leads podem ter sido importadas, mas o histórico não foi finalizado.",
          reason_code: "history_finalize_failed",
          outcome: "unknown",
          resource: { type: "lead_import", id: importRecord.id, route: "/leads" },
        };
      }
      return {
        operation: "imported",
        inserted_count: totals.data.inserted,
        updated_count: totals.data.updated,
        deduplicated_input_count: parsed.value.rows.length - rows.length,
        import_code: importCode,
        resource: { type: "lead_import", id: importRecord.id, route: "/leads" },
      };
    },
  },
];
