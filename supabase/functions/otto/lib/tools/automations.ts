import {
  AUTHORIZATION_CHANGED_RESULT,
  refreshToolAuthorization,
} from "../authorization.ts";
import {
  preparePendingAction,
  type StoredConfirmation,
} from "../confirmations.ts";
import type { Tool, ToolContext, ToolResult } from "../types.ts";
import { genericAutomationReadTools } from "./generic-automation-read-tools.ts";
import { genericAutomationWriteTools } from "./generic-automation-write-tools.ts";
import { genericAutomationConfirmedTools } from "./generic-automation-confirmed-tools.ts";
import {
  buildAutomationActivationPayload,
  buildOverduePaymentGraph,
  OVERDUE_PAYMENT_ACTIVATION_ACTION,
  OVERDUE_PAYMENT_ENTRY_NODE_ID,
  OVERDUE_PAYMENT_PREVIEW,
  OVERDUE_PAYMENT_TRIGGER,
  parseAutomationActivationPayload,
  parsePreparedAutomationFlow,
  type PreparedAutomationFlow,
  validateOverduePaymentGraph,
} from "../automation-validation.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUMMARY_COLUMNS = "id, organization_id, name, description, status, trigger_type, version, reentry_policy, created_at, updated_at, last_enrolled_at";
const DETAIL_COLUMNS = "id, organization_id, name, status, trigger_type, graph, entry_node_id, version, reentry_policy, updated_at";
const DRAFT_NAME = "Seguimento de pagamento em atraso (10 dias)";
const DRAFT_DESCRIPTION = "Envia um lembrete por email quando uma cobrança permanece pendente há pelo menos 10 dias.";

const DATABASE_ERROR = {
  error: "Automações indisponíveis",
  reason_code: "database_unavailable",
  _instruction: "Não foi possível consultar ou alterar as automações. Informa o utilizador e NÃO inventes dados.",
} as const;
const FLOW_NOT_FOUND = {
  error: "Automação não encontrada",
  reason_code: "flow_not_found",
  _instruction: "O fluxo não existe nesta organização. Confirma o ID e NÃO inventes dados.",
} as const;
const FLOW_CHANGED = {
  error: "A automação mudou",
  reason_code: "confirmation_stale",
  _instruction: "A confirmação já não corresponde ao rascunho atual. A automação NÃO foi ativada. Pede uma nova pré-visualização e confirmação.",
} as const;

type FlowLookup =
  | { readonly ok: true; readonly flow: PreparedAutomationFlow }
  | { readonly ok: false; readonly result: ToolResult };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOwnedFlow(value: unknown, orgId: string): value is Readonly<Record<string, unknown>> {
  return isRecord(value)
    && value.organization_id === orgId
    && typeof value.id === "string";
}

async function loadFlow(ctx: ToolContext, flowId: string): Promise<FlowLookup> {
  const { data, error } = await ctx.supabaseAdmin
    .from("automation_flows")
    .select(DETAIL_COLUMNS)
    .eq("organization_id", ctx.orgId)
    .eq("id", flowId)
    .maybeSingle();
  if (error) return { ok: false, result: DATABASE_ERROR };
  if (data === null) return { ok: false, result: FLOW_NOT_FOUND };
  const flow = parsePreparedAutomationFlow(data);
  return flow?.organizationId === ctx.orgId
    ? { ok: true, flow }
    : { ok: false, result: DATABASE_ERROR };
}

function isActivatable(flow: PreparedAutomationFlow): boolean {
  return flow.status === "draft"
    && flow.triggerType === OVERDUE_PAYMENT_TRIGGER
    && flow.reentryPolicy === "once"
    && validateOverduePaymentGraph(flow.graph, flow.entryNodeId).ok;
}

const prepareActivationTool: Tool = {
  name: "prepare_automation_activation",
  module: "automations",
  description: "Preparar a ativação de um rascunho do seguimento de pagamentos em atraso. Devolve uma pré-visualização e uma confirmação de cinco minutos; não ativa por si só.",
  parameters: {
    type: "object",
    properties: { flow_id: { type: "string", description: "UUID do rascunho a ativar" } },
    required: ["flow_id"],
    additionalProperties: false,
  },
  permission: { module: "automations", subarea: "flows", action: "manage" },
  adminOnly: true,
  isWrite: true,
  confirmation: { kind: "immediate" },
  execute: async (args, ctx, tool) => {
    const flowId = typeof args.flow_id === "string" ? args.flow_id : "";
    if (!UUID.test(flowId)) return FLOW_NOT_FOUND;
    const authorization = await refreshToolAuthorization(ctx, tool);
    if (!authorization.ok) return AUTHORIZATION_CHANGED_RESULT;
    const lookup = await loadFlow(authorization.ctx, flowId);
    if (!lookup.ok) return lookup.result;
    if (!isActivatable(lookup.flow)) return FLOW_CHANGED;
    const prepared = await preparePendingAction({
      supabaseAdmin: authorization.ctx.supabaseAdmin,
      userId: authorization.ctx.userId,
      organizationId: authorization.ctx.orgId,
      moduleKey: "automations",
      tool: OVERDUE_PAYMENT_ACTIVATION_ACTION,
      payload: buildAutomationActivationPayload(lookup.flow),
    });
    if (!prepared.ok) return {
      error: "Confirmação indisponível",
      reason_code: "confirmation_unavailable",
      _instruction: "A automação NÃO foi ativada. Informa o utilizador e sugere tentar novamente.",
    };
    return {
      confirmation_id: prepared.value.confirmationId,
      expires_at: prepared.value.expiresAt,
      flow: { id: lookup.flow.id, name: lookup.flow.name, version: lookup.flow.version },
      preview: OVERDUE_PAYMENT_PREVIEW,
      _instruction: "Mostra toda a pré-visualização e pede confirmação explícita. A confirmação expira em cinco minutos. A automação continua em rascunho.",
    };
  },
};

export const automationTools: Tool[] = [
  ...genericAutomationReadTools,
  ...genericAutomationWriteTools,
  ...genericAutomationConfirmedTools,
  {
    name: "create_overdue_payment_followup_draft",
    module: "automations",
    description: "Criar um rascunho fixo de seguimento por email para cobranças pendentes há pelo menos 10 dias. Nunca ativa nem envia mensagens.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    permission: { module: "automations", subarea: "flows", action: "create" },
    adminOnly: true,
    isWrite: true,
    confirmation: {
      kind: "confirmation_required",
      preview: async () => ({
        title: "Criar rascunho de automação",
        summary: "Criar um rascunho inativo para o seguimento de cobranças pendentes há pelo menos 10 dias.",
        destination: "/automacoes",
      }),
    },
    execute: async (_args, ctx, tool) => {
      const graph = buildOverduePaymentGraph();
      if (!validateOverduePaymentGraph(graph, OVERDUE_PAYMENT_ENTRY_NODE_ID).ok) return DATABASE_ERROR;
      const authorization = await refreshToolAuthorization(ctx, tool);
      if (!authorization.ok) return AUTHORIZATION_CHANGED_RESULT;
      const mutationCtx = authorization.ctx;
      const { data, error } = await mutationCtx.supabaseAdmin.from("automation_flows").insert({
        organization_id: mutationCtx.orgId,
        name: DRAFT_NAME,
        description: DRAFT_DESCRIPTION,
        status: "draft",
        trigger_type: OVERDUE_PAYMENT_TRIGGER,
        trigger_config: {},
        graph,
        entry_node_id: OVERDUE_PAYMENT_ENTRY_NODE_ID,
        version: 1,
        reentry_policy: "once",
        max_steps_per_run: 3,
        created_by: mutationCtx.userId,
      }).select(SUMMARY_COLUMNS).single();
      if (error) return DATABASE_ERROR;
      if (!isOwnedFlow(data, mutationCtx.orgId) || data.status !== "draft") return DATABASE_ERROR;
      return {
        operation: "created",
        flow: data,
        preview: OVERDUE_PAYMENT_PREVIEW,
        resource: { type: "automation_flow", id: data.id, route: `/automacoes/${data.id}` },
        invalidateQueryKeys: [["automation-flows"], ["automation-flow", data.id]],
        _instruction: "Rascunho criado e inativo. Nenhuma mensagem foi enviada. Mostra a pré-visualização e [link:Abrir Automações|/automacoes].",
      };
    },
  },
  prepareActivationTool,
];

export async function activatePreparedAutomation(
  ctx: ToolContext,
  confirmation: StoredConfirmation,
): Promise<ToolResult> {
  if (confirmation.moduleKey !== "automations"
    || confirmation.tool !== OVERDUE_PAYMENT_ACTIVATION_ACTION) return FLOW_CHANGED;
  const authorization = await refreshToolAuthorization(ctx, prepareActivationTool);
  if (!authorization.ok) return AUTHORIZATION_CHANGED_RESULT;
  const activationCtx = authorization.ctx;
  const payload = parseAutomationActivationPayload(confirmation.args);
  if (!payload || payload.organizationId !== activationCtx.orgId) return FLOW_CHANGED;
  const lookup = await loadFlow(activationCtx, payload.flowId);
  if (!lookup.ok) return FLOW_CHANGED;
  const flow = lookup.flow;
  if (!isActivatable(flow)
    || flow.version !== payload.flowVersion
    || flow.updatedAt !== payload.flowUpdatedAt
    || flow.triggerType !== payload.triggerType
    || flow.reentryPolicy !== payload.reentryPolicy) return FLOW_CHANGED;
  const finalAuthorization = await refreshToolAuthorization(activationCtx, prepareActivationTool);
  if (!finalAuthorization.ok
    || finalAuthorization.ctx.orgId !== payload.organizationId
    || finalAuthorization.ctx.userId !== activationCtx.userId) return AUTHORIZATION_CHANGED_RESULT;
  const finalCtx = finalAuthorization.ctx;
  const { data, error } = await finalCtx.supabaseAdmin.from("automation_flows")
    .update({ status: "active", version: flow.version + 1 })
    .eq("id", flow.id).eq("organization_id", finalCtx.orgId)
    .eq("status", "draft").eq("trigger_type", payload.triggerType)
    .eq("reentry_policy", payload.reentryPolicy).eq("version", payload.flowVersion)
    .eq("updated_at", payload.flowUpdatedAt).select(SUMMARY_COLUMNS).maybeSingle();
  if (error || data === null) return FLOW_CHANGED;
  if (!isOwnedFlow(data, finalCtx.orgId)
    || data.status !== "active"
    || data.version !== flow.version + 1) {
    return FLOW_CHANGED;
  }
  return {
    operation: "activated",
    flow: data,
    resource: { type: "automation_flow", id: flow.id, route: `/automacoes/${flow.id}` },
    invalidateQueryKeys: [["automation-flows"], ["automation-flow", flow.id]],
    _instruction: "Automação ativada. Nenhuma mensagem foi enviada por esta confirmação; apenas eventos futuros elegíveis entram no motor de automações.",
  };
}
