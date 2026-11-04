import { z } from "https://esm.sh/zod@3.25.76";

import { canAccessRecord } from "../record-scope.ts";
import type { ToolContext, ToolResult } from "../types.ts";

export const UUID_SCHEMA = z.string().uuid();
export const DATE_SCHEMA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const TIMESTAMP_SCHEMA = z.string().datetime({ offset: true });

type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ToolResult };

type LookupResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ToolResult };

const saleScopeSchema = z.object({
  id: UUID_SCHEMA,
  seller_id: UUID_SCHEMA.nullable(),
  created_by: UUID_SCHEMA.nullable(),
  lead_id: UUID_SCHEMA.nullable(),
}).passthrough();

const proposalScopeSchema = z.object({
  id: UUID_SCHEMA,
  created_by: UUID_SCHEMA.nullable(),
  lead_id: UUID_SCHEMA.nullable(),
  updated_at: z.string().nullable(),
}).passthrough();

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

export function databaseCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown";
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : "unknown";
}

export function databaseFailure(operation: string, error: unknown): ToolResult {
  const code = databaseCode(error);
  console.error("otto sales database failure", { operation, code });
  if (code === "40001") {
    return {
      error: "O registo foi alterado entretanto.",
      reason_code: "stale_record",
      _instruction: "A ação NÃO foi executada. Consulta novamente o detalhe e prepara uma nova confirmação.",
    };
  }
  return {
    error: "Não foi possível concluir a operação de vendas.",
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

async function leadOwnerIsAccessible(ctx: ToolContext, leadId: string | null): Promise<boolean> {
  if (!leadId) return false;
  const { data, error } = await ctx.supabaseAdmin
    .from("leads")
    .select("assigned_to")
    .eq("organization_id", ctx.orgId)
    .eq("id", leadId)
    .maybeSingle();
  return !error && typeof data?.assigned_to === "string" && ctx.scopeUserIds.has(data.assigned_to);
}

export async function loadScopedSale(
  ctx: ToolContext,
  saleId: string,
  columns: string,
): Promise<LookupResult<z.infer<typeof saleScopeSchema>>> {
  const { data, error } = await ctx.supabaseAdmin.from("sales").select(columns)
    .eq("organization_id", ctx.orgId).eq("id", saleId).maybeSingle();
  if (error) return { ok: false, failure: databaseFailure("load_sale", error) };
  if (!data) return { ok: false, failure: missingResource("Venda") };
  const parsed = saleScopeSchema.safeParse(data);
  if (!parsed.success) return { ok: false, failure: databaseFailure("parse_sale", parsed.error) };
  if (
    ctx.dataScope !== "all"
    && !canAccessRecord(ctx, parsed.data)
    && !await leadOwnerIsAccessible(ctx, parsed.data.lead_id)
  ) return { ok: false, failure: scopeDenied() };
  return { ok: true, value: parsed.data };
}

export async function loadScopedProposal(
  ctx: ToolContext,
  proposalId: string,
  columns: string,
): Promise<LookupResult<z.infer<typeof proposalScopeSchema>>> {
  const { data, error } = await ctx.supabaseAdmin.from("proposals").select(columns)
    .eq("organization_id", ctx.orgId).eq("id", proposalId).maybeSingle();
  if (error) return { ok: false, failure: databaseFailure("load_proposal", error) };
  if (!data) return { ok: false, failure: missingResource("Proposta") };
  const parsed = proposalScopeSchema.safeParse(data);
  if (!parsed.success) return { ok: false, failure: databaseFailure("parse_proposal", parsed.error) };
  if (
    ctx.dataScope !== "all"
    && !canAccessRecord(ctx, parsed.data)
    && !await leadOwnerIsAccessible(ctx, parsed.data.lead_id)
  ) return { ok: false, failure: scopeDenied() };
  return { ok: true, value: parsed.data };
}

export async function validateClientParent(
  ctx: ToolContext,
  clientId: string,
): Promise<ToolResult | null> {
  const { data, error } = await ctx.supabaseAdmin.from("crm_clients")
    .select("id, assigned_to").eq("organization_id", ctx.orgId).eq("id", clientId).maybeSingle();
  if (error) return databaseFailure("validate_client", error);
  if (!data) return missingResource("Cliente");
  return canAccessRecord(ctx, data) ? null : scopeDenied();
}

export async function validateBankAccount(
  ctx: ToolContext,
  bankAccountId: string,
): Promise<ToolResult | null> {
  const { data, error } = await ctx.supabaseAdmin.from("bank_accounts")
    .select("id").eq("organization_id", ctx.orgId).eq("id", bankAccountId).maybeSingle();
  if (error) return databaseFailure("validate_bank_account", error);
  return data ? null : missingResource("Conta bancária");
}
