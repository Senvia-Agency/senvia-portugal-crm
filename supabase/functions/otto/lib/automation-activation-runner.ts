import { beginActionLog, finishActionLog } from "./audit.ts";
import { AUTHORIZATION_CHANGED_RESULT, refreshToolAuthorization } from "./authorization.ts";
import type { StoredConfirmation } from "./confirmations.ts";
import { OVERDUE_PAYMENT_ACTIVATION_ACTION } from "./automation-validation.ts";
import {
  activatePreparedAutomation,
  automationTools,
} from "./tools/automations.ts";
import type { ToolContext, ToolResult } from "./types.ts";

const PREPARE_ACTIVATION_TOOL = "prepare_automation_activation";

const AUDIT_UNAVAILABLE_RESULT = {
  error: "Auditoria indisponível",
  reason_code: "audit_unavailable",
  _instruction: "A automação NÃO foi ativada porque não foi possível registar a tentativa de forma durável.",
} as const;

export async function runPreparedAutomationActivation(
  ctx: ToolContext,
  confirmation: StoredConfirmation,
): Promise<ToolResult> {
  const gateTool = automationTools.find(({ name }) => name === PREPARE_ACTIVATION_TOOL);
  if (!gateTool) return AUTHORIZATION_CHANGED_RESULT;

  const authorization = await refreshToolAuthorization(ctx, gateTool);
  if (!authorization.ok) {
    await beginActionLog(ctx, {
      tool: OVERDUE_PAYMENT_ACTIVATION_ACTION,
      module: "automations",
      args: { confirmation_id: confirmation.actionId, args_digest: confirmation.argsDigest },
      context: {
        mode: ctx.mode,
        is_admin: ctx.isAdmin,
        grant_required: true,
        access_decision: "denied",
        permission: null,
      },
      status: "denied",
      result: { reason_code: "authorization_denied" },
    });
    return AUTHORIZATION_CHANGED_RESULT;
  }

  const executionCtx = authorization.ctx;
  const attempt = await beginActionLog(executionCtx, {
    tool: OVERDUE_PAYMENT_ACTIVATION_ACTION,
    module: "automations",
    args: { confirmation_id: confirmation.actionId, args_digest: confirmation.argsDigest },
    context: {
      mode: executionCtx.mode,
      is_admin: executionCtx.isAdmin,
      grant_required: true,
      access_decision: "allowed",
      permission: null,
    },
    status: "started",
  });
  if (!attempt.ok) return AUDIT_UNAVAILABLE_RESULT;

  const result = await activatePreparedAutomation(executionCtx, confirmation);
  const finished = await finishActionLog(executionCtx, {
    attempt: attempt.value,
    status: result.error ? "failed" : "succeeded",
    result,
  });
  if (finished.ok) return result;

  await finishActionLog(executionCtx, {
    attempt: attempt.value,
    status: "unknown",
    result: { reason_code: "audit_finalization_failed" },
  });
  return {
    error: "Resultado da ação não confirmado",
    reason_code: "audit_finalization_failed",
    action_log_id: attempt.value.id,
    outcome: "unknown",
    _instruction: "A automação pode ter sido ativada. NÃO repitas automaticamente; pede a um administrador para verificar o histórico.",
  };
}
