import { z } from "https://esm.sh/zod@3.25.76";

import type { ToolContext, ToolResult } from "./types.ts";
import { canAccessRecord } from "./record-scope.ts";
import {
  AUTOMATION_FLOW_STATUSES,
  AUTOMATION_REENTRY_POLICIES,
  NATIVE_AUTOMATION_TRIGGERS,
  isNativeAutomationTrigger,
} from "./generic-automation-schema.ts";
import {
  validateNativeAutomationGraph,
  type AutomationGraphIssue,
  type NativeAutomationGraph,
  type NativeAutomationGraphNode,
} from "./generic-automation-validation.ts";

export const AUTOMATION_SUMMARY_COLUMNS = "id,organization_id,name,description,status,trigger_type,version,reentry_policy,folder_id,created_at,updated_at,last_enrolled_at";
export const AUTOMATION_DETAIL_COLUMNS = "id,organization_id,name,description,status,trigger_type,trigger_config,folder_id,graph,entry_node_id,version,reentry_policy,quiet_hours,max_steps_per_run,created_by,created_at,updated_at,last_enrolled_at";

const uuid = z.string().uuid();
const flowRowSchema = z.object({
  id: uuid,
  organization_id: uuid,
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(AUTOMATION_FLOW_STATUSES),
  trigger_type: z.string(),
  trigger_config: z.record(z.unknown()),
  folder_id: uuid.nullable(),
  graph: z.unknown(),
  entry_node_id: z.string().nullable(),
  version: z.number().int().positive(),
  reentry_policy: z.enum(AUTOMATION_REENTRY_POLICIES),
  quiet_hours: z.object({
    enabled: z.boolean().optional(),
    start: z.string().optional(),
    end: z.string().optional(),
  }).passthrough().nullable(),
  max_steps_per_run: z.number().int().positive().nullable(),
  created_by: uuid.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  last_enrolled_at: z.string().nullable(),
}).passthrough();

export type AutomationFlowRow = z.infer<typeof flowRowSchema>;
export type NativeAutomationFlow = AutomationFlowRow & {
  readonly trigger_type: (typeof NATIVE_AUTOMATION_TRIGGERS)[number];
  readonly graph: NativeAutomationGraph;
  readonly entryNode: NativeAutomationGraphNode;
};
export type NativeFlowState =
  | { readonly native: true; readonly flow: NativeAutomationFlow }
  | { readonly native: false; readonly issues: readonly AutomationGraphIssue[] };
export type FlowLookup =
  | { readonly ok: true; readonly flow: AutomationFlowRow }
  | { readonly ok: false; readonly result: ToolResult };

const ALL_NATIVE_TRIGGERS: ReadonlySet<(typeof NATIVE_AUTOMATION_TRIGGERS)[number]> = new Set(NATIVE_AUTOMATION_TRIGGERS);

export const AUTOMATION_DATABASE_ERROR: ToolResult = {
  error: "Automações indisponíveis",
  reason_code: "database_unavailable",
  _instruction: "Não foi possível consultar ou alterar as automações. Informa o utilizador e NÃO inventes dados.",
};
export const AUTOMATION_NOT_FOUND: ToolResult = {
  error: "Automação não encontrada nesta organização.",
  reason_code: "flow_not_found",
  _instruction: "Confirma o ID do fluxo sem revelar dados de outras organizações.",
};
export const AUTOMATION_CONFLICT: ToolResult = {
  error: "A automação mudou desde a última leitura.",
  reason_code: "automation_version_conflict",
  _instruction: "A operação NÃO foi executada. Volta a consultar o fluxo e pede confirmação com a versão atual.",
};
export const AUTOMATION_PROTECTED: ToolResult = {
  error: "Este fluxo não é um grafo nativo editável pelo Otto.",
  reason_code: "protected_automation",
  _instruction: "Não alteres nem elimines este fluxo. Os fluxos de sistema protegidos são configurados na superfície própria.",
};

export function parseAutomationFlowRow(value: unknown): AutomationFlowRow | null {
  const parsed = flowRowSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function nativeFlowState(flow: AutomationFlowRow): NativeFlowState {
  if (!isNativeAutomationTrigger(flow.trigger_type) || !flow.entry_node_id) {
    return { native: false, issues: [{ code: "unsupported_trigger", nodeId: null, message: "O gatilho não pertence ao construtor nativo." }] };
  }
  const validation = validateNativeAutomationGraph(flow.graph, {
    entryNodeId: flow.entry_node_id,
    allowedEntryTriggers: ALL_NATIVE_TRIGGERS,
    requireComplete: false,
  });
  if (!validation.ok || validation.triggerType !== flow.trigger_type) {
    const issues = validation.ok
      ? [{ code: "trigger_mismatch", nodeId: validation.entryNode.id, message: "O gatilho do grafo não corresponde ao fluxo." }]
      : validation.issues;
    return { native: false, issues };
  }
  return {
    native: true,
    flow: {
      ...flow,
      trigger_type: flow.trigger_type,
      graph: validation.graph,
      entryNode: validation.entryNode,
    },
  };
}

export async function loadAutomationFlow(ctx: ToolContext, flowId: string): Promise<FlowLookup> {
  const { data, error } = await ctx.supabaseAdmin
    .from("automation_flows")
    .select(AUTOMATION_DETAIL_COLUMNS)
    .eq("organization_id", ctx.orgId)
    .eq("id", flowId)
    .maybeSingle();
  if (error) return { ok: false, result: AUTOMATION_DATABASE_ERROR };
  if (data === null) return { ok: false, result: AUTOMATION_NOT_FOUND };
  const flow = parseAutomationFlowRow(data);
  return flow?.organization_id === ctx.orgId && canAccessRecord(ctx, flow)
    ? { ok: true, flow }
    : { ok: false, result: AUTOMATION_DATABASE_ERROR };
}

export function matchesExpectedFlow(
  flow: AutomationFlowRow,
  expected: { readonly version: number; readonly updatedAt: string },
): boolean {
  return flow.version === expected.version && flow.updated_at === expected.updatedAt;
}

export function automationValidationFailure(issues: readonly AutomationGraphIssue[]): ToolResult {
  return {
    error: "O grafo da automação não é válido.",
    reason_code: "automation_graph_invalid",
    issues: issues.slice(0, 20),
    _instruction: "A operação NÃO foi executada. Corrige os problemas indicados no grafo nativo.",
  };
}

export function automationResource(flowId: string): {
  readonly type: "automation_flow";
  readonly id: string;
  readonly route: string;
} {
  return { type: "automation_flow", id: flowId, route: `/automacoes/${flowId}` };
}

export function automationInvalidArguments(): ToolResult {
  return {
    error: "Argumentos de automação inválidos.",
    reason_code: "invalid_arguments",
    _instruction: "A operação NÃO foi executada. Usa apenas o contrato publicado por get_automation_builder_schema.",
  };
}
