import { z } from "https://esm.sh/zod@3.25.76";

import { canAccessRecord } from "../record-scope.ts";
import type { Tool, ToolContext } from "../types.ts";
import {
  databaseFailure,
  parseArgs,
  scopeDenied,
  UUID_SCHEMA,
  validateAssignee,
} from "./crm-shared.ts";

const prospectImportRowSchema = z.object({
  company_name: z.string().trim().min(1).max(250),
  contact_name: z.string().trim().max(200).nullable().optional(),
  email: z.string().trim().email().max(320).nullable().optional(),
  phone: z.string().trim().max(80).nullable().optional(),
  nif: z.string().trim().max(50).nullable().optional(),
  cpe: z.string().trim().max(80).nullable().optional(),
  segment: z.string().trim().max(160).nullable().optional(),
  status: z.string().trim().min(1).max(100).optional().default("new"),
  annual_consumption_kwh: z.number().finite().nonnegative().nullable().optional(),
  observations: z.string().trim().max(10_000).nullable().optional(),
}).strict();

const prospectImportSchema = z.object({
  file_name: z.string().trim().min(1).max(255),
  assigned_to_user_id: UUID_SCHEMA.nullable().optional(),
  rows: z.array(prospectImportRowSchema).min(1).max(100),
}).strict();

const existingProspectSchema = z.object({
  id: UUID_SCHEMA,
  nif: z.string().nullable(),
  cpe: z.string().nullable(),
  email: z.string().nullable(),
  assigned_to: UUID_SCHEMA.nullable(),
});
const insertedProspectSchema = z.object({ id: UUID_SCHEMA });

function identifier(value: string | null | undefined): string {
  return value?.replace(/\s+/g, "").toLocaleUpperCase("pt-PT") ?? "";
}

function emailKey(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase("en-US") ?? "";
}

async function importPreview(args: Readonly<Record<string, unknown>>, _ctx: ToolContext) {
  const parsed = parseArgs(prospectImportSchema, args);
  if (!parsed.ok) return null;
  return {
    title: "Importar prospects",
    summary: `Importar ou atualizar ${parsed.value.rows.length} prospect(s) a partir de “${parsed.value.file_name}”, com deduplicação por NIF+CPE ou email.`,
    destination: "/prospects" as const,
  };
}

export const crmProspectImportTools: Tool[] = [
  {
    name: "import_prospects",
    description: "Importar até 100 prospects estruturados, atualizando duplicados por NIF+CPE ou email como a interface nativa. Não aceita colunas arbitrárias nem metadata livre.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        file_name: { type: "string", minLength: 1, maxLength: 255 },
        assigned_to_user_id: { type: ["string", "null"], format: "uuid" },
        rows: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              company_name: { type: "string", minLength: 1, maxLength: 250 },
              contact_name: { type: ["string", "null"], maxLength: 200 },
              email: { type: ["string", "null"], format: "email" },
              phone: { type: ["string", "null"], maxLength: 80 },
              nif: { type: ["string", "null"], maxLength: 50 },
              cpe: { type: ["string", "null"], maxLength: 80 },
              segment: { type: ["string", "null"], maxLength: 160 },
              status: { type: "string", minLength: 1, maxLength: 100 },
              annual_consumption_kwh: { type: ["number", "null"], minimum: 0 },
              observations: { type: ["string", "null"], maxLength: 10000 },
            },
            required: ["company_name"],
          },
        },
      },
      required: ["file_name", "rows"],
    },
    module: "prospects",
    permission: { module: "prospects", subarea: "prospects", action: "import" },
    isWrite: true,
    confirmation: { kind: "confirmation_required", preview: importPreview },
    execute: async (args, ctx) => {
      const parsed = parseArgs(prospectImportSchema, args);
      if (!parsed.ok) return parsed.failure;
      const requestedAssignee = parsed.value.assigned_to_user_id;
      const newRecordAssignee = requestedAssignee ?? (ctx.dataScope === "all" ? null : ctx.userId);
      if (requestedAssignee) {
        const invalid = await validateAssignee(ctx, requestedAssignee);
        if (invalid) return invalid;
      }
      const { data: existingData, error: existingError } = await ctx.supabaseAdmin
        .from("prospects")
        .select("id, nif, cpe, email, assigned_to")
        .eq("organization_id", ctx.orgId)
        .limit(5000);
      if (existingError) return databaseFailure("load_prospect_duplicates", existingError);
      const existing = (existingData ?? []).flatMap((row: unknown) => {
        const candidate = existingProspectSchema.safeParse(row);
        return candidate.success ? [candidate.data] : [];
      });
      const byPair = new Map<string, (typeof existing)[number]>();
      const byEmail = new Map<string, (typeof existing)[number]>();
      for (const row of existing) {
        const pair = identifier(row.nif) && identifier(row.cpe)
          ? `${identifier(row.nif)}::${identifier(row.cpe)}`
          : "";
        if (pair) byPair.set(pair, row);
        const email = emailKey(row.email);
        if (email) byEmail.set(email, row);
      }
      const seenPairs = new Set<string>();
      const seenEmails = new Set<string>();
      const updates: { readonly id: string; readonly payload: Readonly<Record<string, unknown>> }[] = [];
      const inserts: Readonly<Record<string, unknown>>[] = [];
      let skipped = 0;
      for (const row of parsed.value.rows) {
        const pair = identifier(row.nif) && identifier(row.cpe)
          ? `${identifier(row.nif)}::${identifier(row.cpe)}`
          : "";
        const email = emailKey(row.email);
        if ((pair && seenPairs.has(pair)) || (email && seenEmails.has(email))) {
          skipped += 1;
          continue;
        }
        if (pair) seenPairs.add(pair);
        if (email) seenEmails.add(email);
        const current = (pair ? byPair.get(pair) : undefined) ?? (email ? byEmail.get(email) : undefined);
        if (current && !canAccessRecord(ctx, current)) return scopeDenied();
        const payload = {
          company_name: row.company_name,
          contact_name: row.contact_name ?? null,
          email: email || null,
          phone: row.phone ?? null,
          nif: identifier(row.nif) || null,
          cpe: identifier(row.cpe) || null,
          segment: row.segment ?? null,
          status: row.status,
          annual_consumption_kwh: row.annual_consumption_kwh ?? null,
          observations: row.observations ?? null,
          source: "otto_import",
          source_file_name: parsed.value.file_name,
          imported_by: ctx.userId,
          imported_at: new Date().toISOString(),
        };
        if (current) updates.push({ id: current.id, payload });
        else inserts.push({ ...payload, organization_id: ctx.orgId, assigned_to: newRecordAssignee, metadata: {} });
      }
      const affectedIds: string[] = [];
      let failed = 0;
      let updated = 0;
      for (const update of updates) {
        const result = await ctx.supabaseUser.from("prospects").update(update.payload)
          .eq("organization_id", ctx.orgId).eq("id", update.id).select("id").maybeSingle();
        if (result.error || !result.data) failed += 1;
        else {
          updated += 1;
          affectedIds.push(result.data.id);
        }
      }
      let inserted = 0;
      if (inserts.length > 0) {
        const result = await ctx.supabaseUser.from("prospects").insert(inserts).select("id");
        if (result.error) failed += inserts.length;
        else {
          inserted = result.data?.length ?? 0;
          for (const row of result.data ?? []) {
            const insertedRow = insertedProspectSchema.safeParse(row);
            if (insertedRow.success) affectedIds.push(insertedRow.data.id);
          }
        }
      }
      if (failed > 0) {
        return {
          error: "A importação de prospects ficou parcialmente concluída.",
          reason_code: "partial_import",
          outcome: "partial",
          updated_count: updated,
          inserted_count: inserted,
          failed_count: failed,
          affected_ids: affectedIds,
        };
      }
      return {
        operation: "imported",
        updated_count: updated,
        inserted_count: inserted,
        skipped_count: skipped,
        affected_ids: affectedIds,
        resource: { type: "prospect", id: affectedIds[0], route: "/prospects" },
      };
    },
  },
];
