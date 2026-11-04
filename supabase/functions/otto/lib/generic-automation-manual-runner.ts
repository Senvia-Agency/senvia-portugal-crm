import { beginActionLog, finishActionLog } from "./audit.ts";
import {
  AUTHORIZATION_CHANGED_RESULT,
  refreshToolAuthorization,
} from "./authorization.ts";
import { parsePendingActionPayload } from "./pending-action-payload.ts";
import type { Tool, ToolContext, ToolResult } from "./types.ts";

const MANUAL_RUN_TOOL = "run_configured_manual";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PendingManualRun = {
  readonly flowId: string;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function pendingManualRun(
  ctx: ToolContext,
  confirmationId: string,
): Promise<PendingManualRun | null | "invalid"> {
  if (!UUID_PATTERN.test(confirmationId)) return null;
  const { data, error } = await ctx.supabaseAdmin.from("otto_pending_actions")
    .select("id,user_id,organization_id,module_key,tool,status,expires_at,payload")
    .eq("id", confirmationId)
    .eq("organization_id", ctx.orgId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error || !isRecord(data) || data.tool !== MANUAL_RUN_TOOL) return null;
  if (data.id !== confirmationId
    || data.organization_id !== ctx.orgId
    || data.user_id !== ctx.userId
    || data.module_key !== "automations"
    || data.status !== "pending"
    || typeof data.expires_at !== "string"
    || Date.parse(data.expires_at) <= Date.now()) return "invalid";
  const payload = parsePendingActionPayload(data.payload);
  const flowId = payload.ok ? payload.value.flow_id : null;
  return typeof flowId === "string" && UUID_PATTERN.test(flowId) ? { flowId } : "invalid";
}

function safeExecutionResult(value: unknown, flowId: string): ToolResult | null {
  if (!isRecord(value)
    || typeof value.scanned !== "number"
    || !Number.isInteger(value.scanned)
    || value.scanned < 0
    || typeof value.started !== "number"
    || !Number.isInteger(value.started)
    || value.started < 0
    || typeof value.skipped !== "number"
    || !Number.isInteger(value.skipped)
    || value.skipped < 0
    || !Array.isArray(value.errors)
    || !value.errors.every((error) => typeof error === "string")) return null;
  const errorCodes = [...new Set(value.errors.map((error) => error.split(":", 1)[0]))];
  return {
    operation: "configured_manual_executed",
    flow_id: flowId,
    scanned: value.scanned,
    started: value.started,
    skipped: value.skipped,
    error_codes: errorCodes,
    outcome: errorCodes.length === 0 ? "completed" : "partial_or_unknown",
    resource: { type: "automation_flow", id: flowId, route: `/automacoes/${flowId}` },
    invalidateQueryKeys: [["automation-flows"], ["automation-flow", flowId]],
    ...(errorCodes.length > 0 ? {
      _instruction: "Algumas etapas podem ter sido iniciadas. Não repitas automaticamente; mostra os códigos de erro sem expor identificadores internos.",
    } : {}),
  };
}

export async function runConfiguredManualConfirmation(
  ctx: ToolContext,
  confirmationId: string,
  gateTool: Tool,
): Promise<ToolResult | null> {
  const pending = await pendingManualRun(ctx, confirmationId);
  if (pending === null) return null;
  if (pending === "invalid") {
    return {
      error: "A confirmação manual é inválida, expirou ou já foi utilizada.",
      reason_code: "configured_manual_confirmation_invalid",
      _instruction: "A automação NÃO foi executada. Prepara uma nova confirmação.",
    };
  }
  const authorization = await refreshToolAuthorization(ctx, gateTool);
  if (!authorization.ok) {
    await beginActionLog(ctx, {
      tool: MANUAL_RUN_TOOL,
      module: "automations",
      args: { confirmation_id: confirmationId, flow_id: pending.flowId },
      context: {
        mode: ctx.mode,
        is_admin: ctx.isAdmin,
        grant_required: true,
        access_decision: "denied",
        permission: { module: "automations", subarea: "flows", action: "manage" },
      },
      status: "denied",
      result: { reason_code: "authorization_changed" },
    });
    return AUTHORIZATION_CHANGED_RESULT;
  }
  const executionCtx = authorization.ctx;
  const attempt = await beginActionLog(executionCtx, {
    tool: MANUAL_RUN_TOOL,
    module: "automations",
    args: { confirmation_id: confirmationId, flow_id: pending.flowId },
    context: {
      mode: executionCtx.mode,
      is_admin: executionCtx.isAdmin,
      grant_required: true,
      access_decision: "allowed",
      permission: { module: "automations", subarea: "flows", action: "manage" },
    },
    status: "started",
  });
  if (!attempt.ok) {
    return {
      error: "Auditoria indisponível",
      reason_code: "audit_unavailable",
      _instruction: "A automação NÃO foi executada porque a tentativa não pôde ser registada.",
    };
  }

  const { data, error } = await executionCtx.supabaseUser.functions.invoke("automation-engine", {
    body: {
      action: "run_configured_manual",
      flow_id: pending.flowId,
      confirmation_id: confirmationId,
    },
  });
  const result = error ? null : safeExecutionResult(data, pending.flowId);
  const output: ToolResult = result ?? {
    error: "O resultado da execução manual não foi confirmado.",
    reason_code: "configured_manual_outcome_unknown",
    action_log_id: attempt.value.id,
    outcome: "unknown",
    _instruction: "A automação pode ter iniciado ações. Não repitas automaticamente; verifica o histórico pelo action_log_id.",
  };
  const finished = await finishActionLog(executionCtx, {
    attempt: attempt.value,
    status: result?.outcome === "completed" ? "succeeded" : "unknown",
    result: output,
  });
  if (finished.ok) return output;
  await finishActionLog(executionCtx, {
    attempt: attempt.value,
    status: "unknown",
    result: { reason_code: "audit_finalization_failed" },
  });
  return {
    error: "Resultado da execução não confirmado pela auditoria.",
    reason_code: "audit_finalization_failed",
    action_log_id: attempt.value.id,
    outcome: "unknown",
    _instruction: "Não repitas automaticamente; verifica o histórico pelo action_log_id.",
  };
}
