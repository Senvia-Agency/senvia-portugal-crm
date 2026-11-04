type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

type PayloadParseResult =
  | { readonly ok: true; readonly value: JsonObject }
  | { readonly ok: false };

type ValueParseResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false };

const CREDENTIAL_KEYS = new Set([
  "api_key",
  "apikey",
  "authorization",
  "client_secret",
  "cookie",
  "credential",
  "credentials",
  "password",
  "passphrase",
  "private_key",
  "refresh_token",
  "secret",
  "signing_key",
  "token",
]);

const CREDENTIAL_SUFFIXES = [
  "_password",
  "_secret",
  "_token",
  "_credential",
  "_private_key",
] as const;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCredentialKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function isCredentialKey(key: string): boolean {
  const normalized = normalizeCredentialKey(key);
  return CREDENTIAL_KEYS.has(normalized)
    || CREDENTIAL_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function parseJsonValue(value: unknown, ancestors: WeakSet<object>): ValueParseResult {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return { ok: true, value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return { ok: false };
    ancestors.add(value);
    const output: JsonValue[] = [];
    for (const item of value) {
      const parsed = parseJsonValue(item, ancestors);
      if (!parsed.ok) {
        ancestors.delete(value);
        return parsed;
      }
      output.push(parsed.value);
    }
    ancestors.delete(value);
    return { ok: true, value: output };
  }
  if (!isPlainObject(value) || ancestors.has(value)) return { ok: false };

  ancestors.add(value);
  const output: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    if (isCredentialKey(key)) {
      ancestors.delete(value);
      return { ok: false };
    }
    const parsed = parseJsonValue(value[key], ancestors);
    if (!parsed.ok) {
      ancestors.delete(value);
      return parsed;
    }
    output[key] = parsed.value;
  }
  ancestors.delete(value);
  return { ok: true, value: output };
}

export function parsePendingActionPayload(value: unknown): PayloadParseResult {
  if (!isPlainObject(value)) return { ok: false };
  const parsed = parseJsonValue(value, new WeakSet());
  return parsed.ok && isJsonObject(parsed.value)
    ? { ok: true, value: parsed.value }
    : { ok: false };
}

export async function digestPendingActionPayload(payload: JsonObject): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
