import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { isOttoModuleKey, type OttoModuleKey } from "./modules.ts";
import {
  digestPendingActionPayload,
  parsePendingActionPayload,
  type JsonObject,
} from "./pending-action-payload.ts";

type PendingActionFailureKind =
  | "invalid_request"
  | "invalid_payload"
  | "unavailable"
  | "database"
  | "transport"
  | "invalid_response"
  | "integrity_failure";

type PendingActionFailure = { readonly kind: PendingActionFailureKind };

export type PendingActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: PendingActionFailure };

type PendingActionIdentity = {
  readonly supabaseAdmin: SupabaseClient;
  readonly confirmationId: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly moduleKey: OttoModuleKey;
  readonly tool: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

function failed<T>(kind: PendingActionFailureKind): PendingActionResult<T> {
  return { ok: false, failure: { kind } };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validIdentity(input: PendingActionIdentity): boolean {
  return UUID_PATTERN.test(input.confirmationId)
    && UUID_PATTERN.test(input.userId)
    && UUID_PATTERN.test(input.organizationId)
    && isOttoModuleKey(input.moduleKey)
    && input.tool.length > 0
    && input.tool.length <= 128
    && input.tool.trim() === input.tool;
}

export async function preparePendingAction(input: {
  readonly supabaseAdmin: SupabaseClient;
  readonly userId: string;
  readonly organizationId: string;
  readonly moduleKey: OttoModuleKey;
  readonly tool: string;
  readonly payload: unknown;
}): Promise<PendingActionResult<{
  readonly confirmationId: string;
  readonly argsDigest: string;
  readonly expiresAt: string;
}>> {
  if (
    !UUID_PATTERN.test(input.userId)
    || !UUID_PATTERN.test(input.organizationId)
    || !isOttoModuleKey(input.moduleKey)
    || input.tool.length === 0
    || input.tool.length > 128
    || input.tool.trim() !== input.tool
  ) return failed("invalid_request");

  const parsed = parsePendingActionPayload(input.payload);
  if (!parsed.ok) return failed("invalid_payload");

  try {
    const argsDigest = await digestPendingActionPayload(parsed.value);
    const { data, error } = await input.supabaseAdmin.rpc("prepare_otto_pending_action", {
      p_user_id: input.userId,
      p_organization_id: input.organizationId,
      p_module_key: input.moduleKey,
      p_tool: input.tool,
      p_args_digest: argsDigest,
      p_payload: parsed.value,
    }).single();
    if (error) return failed("database");
    if (
      !isRecord(data)
      || typeof data.confirmation_id !== "string"
      || !UUID_PATTERN.test(data.confirmation_id)
      || data.args_digest !== argsDigest
      || typeof data.expires_at !== "string"
      || !Number.isFinite(Date.parse(data.expires_at))
    ) return failed("invalid_response");
    return {
      ok: true,
      value: {
        confirmationId: data.confirmation_id,
        argsDigest,
        expiresAt: data.expires_at,
      },
    };
  } catch {
    return failed("transport");
  }
}

export async function consumePendingAction(
  input: PendingActionIdentity,
): Promise<PendingActionResult<{
  readonly actionId: string;
  readonly argsDigest: string;
  readonly payload: JsonObject;
}>> {
  if (!validIdentity(input)) return failed("invalid_request");

  try {
    const { data, error } = await input.supabaseAdmin.rpc("consume_otto_pending_action", {
      p_action_id: input.confirmationId,
      p_user_id: input.userId,
      p_organization_id: input.organizationId,
      p_module_key: input.moduleKey,
      p_tool: input.tool,
    }).maybeSingle();
    if (error) return failed("database");
    if (data === null) return failed("unavailable");
    if (
      !isRecord(data)
      || data.action_id !== input.confirmationId
      || typeof data.args_digest !== "string"
      || !DIGEST_PATTERN.test(data.args_digest)
    ) return failed("invalid_response");

    const parsed = parsePendingActionPayload(data.payload);
    if (!parsed.ok) return failed("integrity_failure");
    const recomputedDigest = await digestPendingActionPayload(parsed.value);
    if (recomputedDigest !== data.args_digest) return failed("integrity_failure");

    return {
      ok: true,
      value: {
        actionId: data.action_id,
        argsDigest: data.args_digest,
        payload: parsed.value,
      },
    };
  } catch {
    return failed("transport");
  }
}

export async function cancelPendingAction(
  input: PendingActionIdentity,
): Promise<PendingActionResult<{ readonly actionId: string }>> {
  if (!validIdentity(input)) return failed("invalid_request");

  try {
    const { data, error } = await input.supabaseAdmin.rpc("cancel_otto_pending_action", {
      p_action_id: input.confirmationId,
      p_user_id: input.userId,
      p_organization_id: input.organizationId,
      p_module_key: input.moduleKey,
      p_tool: input.tool,
    });
    if (error) return failed("database");
    return data === true
      ? { ok: true, value: { actionId: input.confirmationId } }
      : failed("unavailable");
  } catch {
    return failed("transport");
  }
}
