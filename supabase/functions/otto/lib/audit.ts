import type { OttoModuleKey } from "./modules.ts";
import type { ToolContext } from "./types.ts";

const REDACTED = "[REDACTED]";
const TRUNCATED = "[TRUNCATED]";
const MAX_DEPTH = 6;
const MAX_ENTRIES = 50;
const MAX_SAFE_STRING_LENGTH = 256;
const SECRET_PART = /^(password|passwd|passphrase|secret|token|authorization|cookie|credential|signature)$/;
const BODY_PART = /^(message|body|content|text|html|subject|note|notes|description|comment|prompt|instruction|template|transcript|question|answer|attachment|file|path|url)$/;
const PII_PART = /^(name|username|email|phone|mobile|address|street|postal|zip|nif|vat|tax|iban|bank|birth)$/;
const SAFE_TEXT_KEY = /^(tool|module|module_key|status|state|stage|type|provider|currency|action|mode|method|operation|source|kind|access_decision|reason_code|.+_code|reference|.+_reference|subarea)$/;

export type AuditModule = OttoModuleKey | "support";
export type ActionLogTerminalStatus = "succeeded" | "failed" | "unknown";

export type ActionAuditContext = {
  readonly mode: ToolContext["mode"];
  readonly is_admin: boolean;
  readonly grant_required: boolean;
  readonly access_decision: "allowed" | "denied";
  readonly permission: {
    readonly module: string;
    readonly subarea: string;
    readonly action: string;
  } | null;
};

export type ActionLogAttempt = {
  readonly id: string;
  readonly organizationId: string;
};

type BeginActionLogInput = {
  readonly tool: string;
  readonly module: AuditModule;
  readonly args: unknown;
  readonly context: ActionAuditContext;
  readonly status: "started" | "denied";
  readonly result?: unknown;
};

type FinishActionLogInput = {
  readonly attempt: ActionLogAttempt;
  readonly status: ActionLogTerminalStatus;
  readonly result: unknown;
};

type AuditFailure = {
  readonly operation: "begin" | "finish";
  readonly kind: "database" | "transport" | "invalid_response";
  readonly code: string | null;
};

type SanitizationState = {
  readonly depth: number;
  readonly seen: WeakSet<object>;
};

export type AuditPersistenceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: AuditFailure };

function normalizeKey(key: string): string {
  return key
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/[^a-z\d]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function isSecretOrBodyKey(key: string): boolean {
  const normalized = normalizeKey(key);
  const parts = normalized.split("_");
  return parts.some((part) => SECRET_PART.test(part) || BODY_PART.test(part))
    || normalized === "key"
    || normalized === "api_key"
    || normalized === "apikey"
    || normalized.endsWith("_api_key")
    || normalized.endsWith("_apikey")
    || normalized.endsWith("_private_key")
    || normalized.endsWith("_privatekey")
    || normalized === "otp"
    || normalized.endsWith("_otp")
    || normalized === "verification_code"
    || normalized === "authorization_code"
    || normalized === "invite_code"
    || normalized === "reset_code"
    || normalized === "mfa_code";
}

function isIdentifierKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return normalized === "id" || normalized.endsWith("_id") || normalized.endsWith("_ids");
}

function isPiiKey(key: string): boolean {
  return normalizeKey(key).split("_").some((part) => PII_PART.test(part));
}

function isSafeTextKey(key: string): boolean {
  if (isIdentifierKey(key)) return true;
  return SAFE_TEXT_KEY.test(normalizeKey(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeValue(value: unknown, key: string, state: SanitizationState): unknown {
  if (isSecretOrBodyKey(key)) return REDACTED;
  if (isPiiKey(key)) return REDACTED;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    if (!isSafeTextKey(key)) return REDACTED;
    return value.length <= MAX_SAFE_STRING_LENGTH ? value : TRUNCATED;
  }
  if (typeof value === "bigint") return isSafeTextKey(key) ? value.toString() : REDACTED;
  if (typeof value !== "object" || value === null || state.depth >= MAX_DEPTH) return REDACTED;
  if (state.seen.has(value)) return REDACTED;

  state.seen.add(value);
  const childState = { depth: state.depth + 1, seen: state.seen };
  let sanitized: unknown;
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ENTRIES).map((item) => sanitizeValue(item, key, childState));
    sanitized = value.length > MAX_ENTRIES ? [...items, TRUNCATED] : items;
  } else if (isRecord(value)) {
    const entries = Object.entries(value).slice(0, MAX_ENTRIES);
    const record: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of entries) {
      record[entryKey] = sanitizeValue(entryValue, entryKey, childState);
    }
    if (Object.keys(value).length > MAX_ENTRIES) record._truncated = true;
    sanitized = record;
  } else {
    sanitized = REDACTED;
  }
  state.seen.delete(value);
  return sanitized;
}

function sanitizeForAudit(value: unknown): unknown {
  return sanitizeValue(value, "", { depth: 0, seen: new WeakSet<object>() });
}

export async function beginActionLog(
  ctx: ToolContext,
  input: BeginActionLogInput,
): Promise<AuditPersistenceResult<ActionLogAttempt>> {
  try {
    const { data, error } = await ctx.supabaseAdmin
      .from("otto_action_log")
      .insert({
        organization_id: ctx.orgId,
        user_id: ctx.userId,
        module_key: input.module,
        tool: input.tool,
        context: sanitizeForAudit(input.context),
        args: sanitizeForAudit(input.args),
        result: input.status === "denied" ? sanitizeForAudit(input.result ?? { reason_code: "authorization_denied" }) : null,
        success: false,
        status: input.status,
      })
      .select("id")
      .single();

    if (error) {
      return { ok: false, failure: { operation: "begin", kind: "database", code: error.code ?? null } };
    }
    const row: unknown = data;
    if (!isRecord(row) || typeof row.id !== "string") {
      return { ok: false, failure: { operation: "begin", kind: "invalid_response", code: null } };
    }
    return { ok: true, value: { id: row.id, organizationId: ctx.orgId } };
  } catch (error) {
    const kind = error instanceof Error ? "transport" : "invalid_response";
    return { ok: false, failure: { operation: "begin", kind, code: null } };
  }
}

export async function finishActionLog(
  ctx: ToolContext,
  input: FinishActionLogInput,
): Promise<AuditPersistenceResult<ActionLogAttempt>> {
  try {
    const { data, error } = await ctx.supabaseAdmin
      .from("otto_action_log")
      .update({
        status: input.status,
        result: sanitizeForAudit(input.result),
        success: input.status === "succeeded",
      })
      .eq("id", input.attempt.id)
      .eq("organization_id", input.attempt.organizationId)
      .eq("status", "started")
      .select("id")
      .maybeSingle();

    if (error) {
      return { ok: false, failure: { operation: "finish", kind: "database", code: error.code ?? null } };
    }
    const row: unknown = data;
    if (!isRecord(row) || row.id !== input.attempt.id) {
      return { ok: false, failure: { operation: "finish", kind: "invalid_response", code: null } };
    }
    return { ok: true, value: input.attempt };
  } catch (error) {
    const kind = error instanceof Error ? "transport" : "invalid_response";
    return { ok: false, failure: { operation: "finish", kind, code: null } };
  }
}
