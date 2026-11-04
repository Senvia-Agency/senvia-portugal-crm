import { CONFIRMATION_COPY } from "./confirmation-copy.ts";
import { isOttoModuleKey, type OttoModuleKey } from "./modules.ts";
import type { JsonObject } from "./pending-action-payload.ts";
import {
  cancelPendingAction,
  consumePendingAction,
  preparePendingAction,
} from "./pending-actions.ts";
import type { ConfirmationPreview, Tool, ToolContext } from "./types.ts";

export {
  cancelPendingAction,
  consumePendingAction,
  preparePendingAction,
} from "./pending-actions.ts";
export type { PendingActionResult } from "./pending-actions.ts";

type PendingActionStatus = "pending" | "consumed" | "expired" | "cancelled";

type PendingActionBinding = {
  readonly moduleKey: OttoModuleKey;
  readonly tool: string;
  readonly status: PendingActionStatus;
};

export type ActionPreviewPayload = {
  readonly confirmationId: string;
  readonly expiresAt: string;
  readonly title: string;
  readonly summary: string;
  readonly destination: string;
};

export type StoredConfirmation = {
  readonly actionId: string;
  readonly argsDigest: string;
  readonly moduleKey: OttoModuleKey;
  readonly tool: string;
  readonly args: JsonObject;
  readonly summary: string;
};

export type ConfirmationConsumeResult =
  | { readonly status: "ready"; readonly confirmation: StoredConfirmation }
  | { readonly status: "expired" | "denied"; readonly summary: string };

export type ConfirmationCancelResult = {
  readonly status: "cancelled" | "expired" | "denied";
  readonly summary: string;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPendingActionStatus(value: unknown): value is PendingActionStatus {
  return value === "pending"
    || value === "consumed"
    || value === "expired"
    || value === "cancelled";
}

async function readPendingActionBinding(
  ctx: ToolContext,
  confirmationId: string,
): Promise<PendingActionBinding | null> {
  try {
    const { data, error } = await ctx.supabaseAdmin
      .from("otto_pending_actions")
      .select("id, module_key, tool, status")
      .eq("id", confirmationId)
      .eq("organization_id", ctx.orgId)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (
      error
      || !isRecord(data)
      || data.id !== confirmationId
      || !isOttoModuleKey(data.module_key)
      || typeof data.tool !== "string"
      || !isPendingActionStatus(data.status)
    ) return null;
    return {
      moduleKey: data.module_key,
      tool: data.tool,
      status: data.status,
    };
  } catch {
    return null;
  }
}

export async function createActionConfirmation(
  ctx: ToolContext,
  tool: Tool,
  args: Readonly<Record<string, unknown>>,
): Promise<ActionPreviewPayload | null> {
  if (!tool.isWrite || tool.confirmation?.kind === "immediate") return null;

  let copy: ConfirmationPreview | null = CONFIRMATION_COPY[tool.name] ?? null;
  if (tool.confirmation?.kind === "confirmation_required") {
    try {
      copy = await tool.confirmation.preview(args, ctx);
    } catch (error) {
      console.error("otto confirmation preview failed", {
        tool: tool.name,
        error_type: error instanceof Error ? error.name : "unknown",
      });
      return null;
    }
  }
  if (!copy) return null;

  const prepared = await preparePendingAction({
    supabaseAdmin: ctx.supabaseAdmin,
    userId: ctx.userId,
    organizationId: ctx.orgId,
    moduleKey: tool.module,
    tool: tool.name,
    payload: copy.preparedArgs ?? args,
  });
  if (!prepared.ok) {
    console.error("otto confirmation preparation failed", { kind: prepared.failure.kind });
    return null;
  }
  return {
    confirmationId: prepared.value.confirmationId,
    expiresAt: prepared.value.expiresAt,
    title: copy.title,
    summary: copy.summary,
    destination: copy.destination,
  };
}

export function actionPreviewFromResult(value: unknown): ActionPreviewPayload | null {
  if (!isRecord(value) || !isRecord(value._action_preview)) return null;
  const preview = value._action_preview;
  return typeof preview.confirmationId === "string"
      && typeof preview.expiresAt === "string"
      && typeof preview.title === "string"
      && typeof preview.summary === "string"
      && typeof preview.destination === "string"
    ? {
      confirmationId: preview.confirmationId,
      expiresAt: preview.expiresAt,
      title: preview.title,
      summary: preview.summary,
      destination: preview.destination,
    }
    : null;
}

export async function cancelActionConfirmation(
  ctx: ToolContext,
  confirmationId: string,
): Promise<ConfirmationCancelResult> {
  const binding = await readPendingActionBinding(ctx, confirmationId);
  if (!binding) {
    return { status: "denied", summary: "A confirmação não existe ou não pertence a este utilizador." };
  }
  if (binding.status !== "pending") {
    if (binding.status === "expired") {
      return { status: "expired", summary: "A confirmação expirou e já não pode ser cancelada." };
    }
    if (binding.status === "cancelled") {
      return { status: "cancelled", summary: "A ação já estava cancelada." };
    }
    return { status: "denied", summary: "A ação já foi executada e não pode ser cancelada." };
  }

  const cancelled = await cancelPendingAction({
    supabaseAdmin: ctx.supabaseAdmin,
    confirmationId,
    userId: ctx.userId,
    organizationId: ctx.orgId,
    moduleKey: binding.moduleKey,
    tool: binding.tool,
  });
  if (cancelled.ok) {
    return { status: "cancelled", summary: "A ação foi cancelada e não será executada." };
  }

  const current = await readPendingActionBinding(ctx, confirmationId);
  if (current?.status === "expired") {
    return { status: "expired", summary: "A confirmação expirou e já não pode ser cancelada." };
  }
  if (current?.status === "cancelled") {
    return { status: "cancelled", summary: "A ação já estava cancelada." };
  }
  return { status: "denied", summary: "A confirmação não pôde ser cancelada com segurança." };
}

export async function consumeActionConfirmation(
  ctx: ToolContext,
  confirmationId: string,
): Promise<ConfirmationConsumeResult> {
  const binding = await readPendingActionBinding(ctx, confirmationId);
  if (!binding) {
    return { status: "denied", summary: "A confirmação não existe ou não pertence a este utilizador." };
  }
  if (binding.status !== "pending") {
    return binding.status === "expired"
      ? { status: "expired", summary: "A confirmação expirou. Pede ao Otto uma nova prévia." }
      : { status: "denied", summary: "A confirmação já foi utilizada ou cancelada." };
  }

  const consumed = await consumePendingAction({
    supabaseAdmin: ctx.supabaseAdmin,
    confirmationId,
    userId: ctx.userId,
    organizationId: ctx.orgId,
    moduleKey: binding.moduleKey,
    tool: binding.tool,
  });
  if (!consumed.ok) {
    const current = consumed.failure.kind === "unavailable"
      ? await readPendingActionBinding(ctx, confirmationId)
      : null;
    return current?.status === "expired"
      ? { status: "expired", summary: "A confirmação expirou. Pede ao Otto uma nova prévia." }
      : { status: "denied", summary: "A confirmação não pôde ser validada com segurança." };
  }

  const copy = CONFIRMATION_COPY[binding.tool];
  return {
    status: "ready",
    confirmation: {
      actionId: consumed.value.actionId,
      argsDigest: consumed.value.argsDigest,
      moduleKey: binding.moduleKey,
      tool: binding.tool,
      args: consumed.value.payload,
      summary: copy?.summary ?? "A ação confirmada foi validada.",
    },
  };
}
