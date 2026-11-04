import { z } from "https://esm.sh/zod@3.25.76";

import { canAccessRecord, canAssignUser } from "../record-scope.ts";
import type { ToolContext, ToolResult } from "../types.ts";

export const UUID_SCHEMA = z.string().uuid();
export const DATE_SCHEMA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ToolResult };

type LookupResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ToolResult };

const leadScopeSchema = z.object({
  id: UUID_SCHEMA,
  assigned_to: UUID_SCHEMA.nullable(),
}).passthrough();

const clientScopeSchema = z.object({
  id: UUID_SCHEMA,
  assigned_to: UUID_SCHEMA.nullable(),
}).passthrough();

const prospectScopeSchema = z.object({
  id: UUID_SCHEMA,
  assigned_to: UUID_SCHEMA.nullable(),
}).passthrough();

const stageSchema = z.object({ key: z.string(), name: z.string().nullable() });

export function parseArgs<T extends z.ZodTypeAny>(
  schema: T,
  args: Readonly<Record<string, unknown>>,
): ParseResult<z.infer<T>> {
  const parsed = schema.safeParse(args);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
      ok: false,
      failure: {
        error: "Argumentos inválidos",
        reason_code: "invalid_arguments",
        _instruction: "A ação NÃO foi executada. Pede apenas os campos válidos indicados pela ferramenta.",
      },
    };
}

function databaseCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown";
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : "unknown";
}

export function databaseFailure(operation: string, error: unknown): ToolResult {
  console.error("otto crm database failure", { operation, code: databaseCode(error) });
  return {
    error: "Não foi possível concluir a operação no CRM.",
    reason_code: "database_error",
    _instruction: "A ação NÃO foi confirmada. Informa o utilizador sem inventar um resultado.",
  };
}

export function missingResource(label: string): ToolResult {
  return {
    error: `${label} não encontrado nesta organização.`,
    reason_code: "resource_not_found",
    _instruction: "A ação NÃO foi executada. Confirma a referência dentro da organização atual.",
  };
}

export function scopeDenied(): ToolResult {
  return {
    error: "O registo está fora do âmbito de dados atual.",
    reason_code: "data_scope_denied",
    _instruction: "A ação NÃO foi executada. Não reveles dados do registo.",
  };
}

async function loadScopedRecord<T extends object>(
  ctx: ToolContext,
  table: "leads" | "crm_clients" | "prospects",
  id: string,
  columns: string,
  schema: z.ZodType<T>,
  label: string,
): Promise<LookupResult<T>> {
  const { data, error } = await ctx.supabaseAdmin
    .from(table)
    .select(columns)
    .eq("organization_id", ctx.orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, failure: databaseFailure(`load_${table}`, error) };
  if (!data) return { ok: false, failure: missingResource(label) };
  const parsed = schema.safeParse(data);
  if (!parsed.success) return { ok: false, failure: databaseFailure(`parse_${table}`, parsed.error) };
  if (!canAccessRecord(ctx, parsed.data)) return { ok: false, failure: scopeDenied() };
  return { ok: true, value: parsed.data };
}

export function loadScopedLead(
  ctx: ToolContext,
  id: string,
  columns: string,
): Promise<LookupResult<z.infer<typeof leadScopeSchema>>> {
  return loadScopedRecord(ctx, "leads", id, columns, leadScopeSchema, "Lead");
}

export function loadScopedClient(
  ctx: ToolContext,
  id: string,
  columns: string,
): Promise<LookupResult<z.infer<typeof clientScopeSchema>>> {
  return loadScopedRecord(ctx, "crm_clients", id, columns, clientScopeSchema, "Cliente");
}

export function loadScopedProspect(
  ctx: ToolContext,
  id: string,
  columns: string,
): Promise<LookupResult<z.infer<typeof prospectScopeSchema>>> {
  return loadScopedRecord(ctx, "prospects", id, columns, prospectScopeSchema, "Prospect");
}

export async function validateAssignee(
  ctx: ToolContext,
  userId: string,
): Promise<ToolResult | null> {
  if (!canAssignUser(ctx, userId)) return scopeDenied();
  const { data, error } = await ctx.supabaseAdmin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", ctx.orgId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) return databaseFailure("validate_assignee", error);
  return data ? null : missingResource("Membro ativo");
}

export async function resolveStageKey(
  ctx: ToolContext,
  stage: string,
): Promise<LookupResult<string>> {
  const { data, error } = await ctx.supabaseAdmin
    .from("pipeline_stages")
    .select("key, name")
    .eq("organization_id", ctx.orgId)
    .order("position");
  if (error) return { ok: false, failure: databaseFailure("resolve_stage", error) };
  const normalized = stage.trim().toLocaleLowerCase("pt-PT");
  for (const row of data ?? []) {
    const candidate = stageSchema.safeParse(row);
    if (!candidate.success) continue;
    if (
      candidate.data.key === stage
      || candidate.data.name?.trim().toLocaleLowerCase("pt-PT") === normalized
    ) return { ok: true, value: candidate.data.key };
  }
  return { ok: false, failure: missingResource("Etapa do pipeline") };
}
