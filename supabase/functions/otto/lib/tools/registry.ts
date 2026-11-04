// Central tool registry. Collects every tool, decides which are exposed to the
// model for a given user (role + profile permissions), and runs a tool by name
// with a defense-in-depth permission re-check plus audit logging for writes.
import type { Tool, ToolContext, ToolResult } from "../types.ts";
import { readTools } from "./read.ts";
import { writeTools } from "./write.ts";
import { onboardingTools } from "./onboarding-tools.ts";
import { supportTools } from "./support.ts";
import { automationTools } from "./automations.ts";
import { financeTools } from "./finance.ts";
import { settingsPortalTools } from "./settings-portal.ts";
import { crmTools } from "./crm.ts";
import { salesTools } from "./sales.ts";
import { calendarInboxTools } from "./calendar-inbox.ts";
import { messagingTools } from "./messaging.ts";
import { marketingTools } from "./marketing.ts";
import { beginActionLog, finishActionLog } from "../audit.ts";
import type { ActionLogAttempt } from "../audit.ts";
import {
  canUseTool,
  refreshToolAuthorization,
} from "../authorization.ts";
import { createActionConfirmation } from "../confirmations.ts";

const PREPARE_AUTOMATION_ACTIVATION = "prepare_automation_activation";

export { canUseTool } from "../authorization.ts";

export const ALL_TOOLS: Tool[] = [
  ...readTools,
  ...writeTools,
  ...onboardingTools,
  ...supportTools,
  ...automationTools,
  ...financeTools,
  ...settingsPortalTools,
  ...crmTools,
  ...salesTools,
  ...calendarInboxTools,
  ...messagingTools,
  ...marketingTools,
];

class DuplicateToolNameError extends Error {
  readonly toolName: string;

  constructor(toolName: string) {
    super(`Duplicate Otto tool name: ${toolName}`);
    this.name = "DuplicateToolNameError";
    this.toolName = toolName;
  }
}

function indexTools(tools: readonly Tool[]): Readonly<Record<string, Tool>> {
  const index: Record<string, Tool> = {};
  for (const tool of tools) {
    if (index[tool.name]) throw new DuplicateToolNameError(tool.name);
    index[tool.name] = tool;
  }
  return index;
}

const TOOL_BY_NAME = indexTools(ALL_TOOLS);

type ModelToolDefinition = {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Tool["parameters"];
  };
};

type RunToolOptions = {
  readonly confirmed?: boolean;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function preparedAutomationPreview(result: ToolResult) {
  if (
    typeof result.confirmation_id !== "string"
    || typeof result.expires_at !== "string"
    || !isRecord(result.flow)
    || typeof result.flow.name !== "string"
  ) return null;
  return {
    confirmationId: result.confirmation_id,
    expiresAt: result.expires_at,
    title: "Ativar automação",
    summary: [
      `Ativar “${result.flow.name}”.`,
      "Gatilho: cobrança pendente há pelo menos 10 dias após o vencimento.",
      "Canal: email do cliente associado à cobrança elegível.",
      "Assunto: Lembrete de pagamento pendente.",
      "Mensagem: pedido de regularização ou contacto caso o pagamento já tenha sido efetuado.",
      "A confirmação ativa o fluxo para eventos futuros e não envia uma mensagem agora.",
    ].join("\n"),
    destination: "/automacoes",
  };
}

// OpenAI-format tool definitions for the tools this user may call.
export function getToolsForModel(ctx: ToolContext): ModelToolDefinition[] {
  return ALL_TOOLS.filter((t) => canUseTool(t, ctx)).map((t): ModelToolDefinition => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

// Execute a tool call. Returns a JSON string (what the model expects as the tool
// message content).
export async function runTool(
  name: string,
  args: Record<string, any>,
  ctx: ToolContext,
  options: RunToolOptions = {},
): Promise<string> {
  const tool = TOOL_BY_NAME[name];
  if (!tool) return JSON.stringify({ error: `Ferramenta desconhecida: ${name}` });

  const authorization = await refreshToolAuthorization(ctx, tool);
  const authorized = authorization.ok;
  const module = tool.module;
  const grantRequired = tool.isWrite === true;
  const permission = tool.permission
    ? {
      module: tool.permission.module,
      subarea: tool.permission.subarea,
      action: tool.permission.action,
    }
    : null;

  if (!authorized) {
    if (tool.isWrite) {
      const denied = await beginActionLog(ctx, {
        tool: name,
        module,
        args,
        context: {
          mode: ctx.mode,
          is_admin: ctx.isAdmin,
          grant_required: grantRequired,
          access_decision: "denied",
          permission,
        },
        status: "denied",
        result: { reason_code: "authorization_denied" },
      });
      if (!denied.ok) {
        console.error("otto audit persistence failed", denied.failure);
      }
    }
    return JSON.stringify({
      error: "Sem permissão",
      _instruction: "O utilizador não tem permissão para esta ação. Informa-o educadamente e sugere contactar o administrador.",
    });
  }

  const executionCtx = authorization.ok ? authorization.ctx : ctx;
  if (
    tool.isWrite
    && tool.confirmation?.kind !== "immediate"
    && name !== PREPARE_AUTOMATION_ACTIVATION
    && options.confirmed !== true
  ) {
    const preview = await createActionConfirmation(executionCtx, tool, args);
    return preview
      ? JSON.stringify({ _action_preview: preview })
      : JSON.stringify({
        error: "Confirmação indisponível",
        _instruction: "A ação NÃO foi executada porque não foi possível criar uma confirmação segura. Informa o utilizador e sugere tentar mais tarde.",
      });
  }

  let auditAttempt: ActionLogAttempt | null = null;
  if (tool.isWrite) {
    const started = await beginActionLog(executionCtx, {
      tool: name,
      module,
      args,
      context: {
          mode: executionCtx.mode,
          is_admin: executionCtx.isAdmin,
          grant_required: grantRequired,
          access_decision: "allowed",
          permission,
      },
      status: "started",
    });
    if (!started.ok) {
      console.error("otto audit persistence failed", started.failure);
      return JSON.stringify({
        error: "Auditoria indisponível",
        _instruction: "A ação NÃO foi executada porque não foi possível registar a tentativa de forma durável. Informa o utilizador e sugere tentar mais tarde.",
      });
    }
    auditAttempt = started.value;
  }

  let result: ToolResult;
  try {
    result = await tool.execute(args, executionCtx, tool);
  } catch (error) {
    console.error("otto tool execution failed", {
      tool: name,
      error_type: error instanceof Error ? error.name : "unknown",
    });
    result = { error: `Erro ao executar ${name}`, _instruction: "ERRO INTERNO na ferramenta. Informa o utilizador que houve um erro técnico. NÃO INVENTES DADOS." };
  }

  if (auditAttempt) {
    const finished = await finishActionLog(executionCtx, {
      attempt: auditAttempt,
      status: result.error ? "failed" : "succeeded",
      result,
    });
    if (!finished.ok) {
      console.error("otto audit persistence failed", finished.failure);
      const markedUnknown = await finishActionLog(executionCtx, {
        attempt: auditAttempt,
        status: "unknown",
        result: { reason_code: "audit_finalization_failed" },
      });
      if (!markedUnknown.ok) {
        console.error("otto audit unknown-state persistence failed", markedUnknown.failure);
      }
      return JSON.stringify({
        error: "Resultado da ação não confirmado",
        action_log_id: auditAttempt.id,
        outcome: "unknown",
        _instruction: "A ação pode ter sido aplicada, mas o estado final da auditoria não foi confirmado. NÃO repitas automaticamente. Informa o utilizador e pede a um administrador para verificar o histórico pelo action_log_id.",
      });
    }
  }
  const dedicatedPreview = name === PREPARE_AUTOMATION_ACTIVATION
    ? preparedAutomationPreview(result)
    : null;
  return JSON.stringify(dedicatedPreview
    ? { ...result, _action_preview: dedicatedPreview }
    : result);
}
