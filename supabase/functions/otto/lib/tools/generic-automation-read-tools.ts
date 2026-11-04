import type { Tool } from "../types.ts";
import {
  AUTOMATION_CONFIG_CONTRACT,
  AUTOMATION_FLOW_STATUSES,
  AUTOMATION_GRAPH_LIMITS,
  AUTOMATION_NODE_LABELS,
  AUTOMATION_REENTRY_POLICIES,
  CREATABLE_AUTOMATION_ACTIONS,
  CREATABLE_AUTOMATION_TRIGGERS,
  COMPATIBLE_AUTOMATION_ACTIONS,
  LEGACY_AUTOMATION_TRIGGERS,
  NATIVE_AUTOMATION_TRIGGERS,
  PROTECTED_AUTOMATION_SURFACES,
  isNativeAutomationTrigger,
} from "../generic-automation-schema.ts";
import {
  AUTOMATION_DATABASE_ERROR,
  AUTOMATION_DETAIL_COLUMNS,
  AUTOMATION_NOT_FOUND,
  loadAutomationFlow,
  nativeFlowState,
  parseAutomationFlowRow,
} from "../generic-automation-store.ts";
import {
  automationFlowIdArgsSchema,
  automationListArgsSchema,
  FLOW_ID_PARAMETERS,
  parseAutomationArgs,
} from "../generic-automation-tool-contracts.ts";
import { validateAutomationReferences } from "../generic-automation-references.ts";
import { validateNativeAutomationGraph } from "../generic-automation-validation.ts";
import { filterAccessibleRecords } from "../record-scope.ts";

const ALL_NATIVE_TRIGGERS: ReadonlySet<(typeof NATIVE_AUTOMATION_TRIGGERS)[number]> = new Set(NATIVE_AUTOMATION_TRIGGERS);

function safeSummary(flow: ReturnType<typeof parseAutomationFlowRow>) {
  if (!flow) return null;
  return {
    id: flow.id,
    name: flow.name,
    description: flow.description,
    status: flow.status,
    trigger_type: flow.trigger_type,
    version: flow.version,
    reentry_policy: flow.reentry_policy,
    folder_id: flow.folder_id,
    created_at: flow.created_at,
    updated_at: flow.updated_at,
    last_enrolled_at: flow.last_enrolled_at,
  };
}

export const genericAutomationReadTools = [
  {
    name: "get_automation_builder_schema",
    module: "automations",
    description: "Descobrir os gatilhos, passos, configurações e regras de grafo que o construtor nativo de automações suporta.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    permission: { module: "automations", subarea: "flows", action: "view" },
    execute: async () => ({
      schema_version: 1,
      flow_statuses: AUTOMATION_FLOW_STATUSES,
      reentry_policies: AUTOMATION_REENTRY_POLICIES,
      creatable_triggers: CREATABLE_AUTOMATION_TRIGGERS.map((type) => ({ type, label: AUTOMATION_NODE_LABELS[type] })),
      legacy_editable_triggers: LEGACY_AUTOMATION_TRIGGERS.map((type) => ({ type, label: AUTOMATION_NODE_LABELS[type], creatable: false })),
      creatable_actions: CREATABLE_AUTOMATION_ACTIONS.map((type) => ({ type, label: AUTOMATION_NODE_LABELS[type] })),
      compatible_existing_actions: COMPATIBLE_AUTOMATION_ACTIONS.map((type) => ({ type, label: AUTOMATION_NODE_LABELS[type], creatable: false })),
      config_contract: AUTOMATION_CONFIG_CONTRACT,
      graph_contract: {
        node: { required: ["id", "type", "config"], optional: ["position", "ghostOffsets"] },
        edge: { required: ["id", "source", "target", "branch"] },
        entry: "Exatamente um gatilho; entry_node_id identifica-o; nenhum gatilho recebe ligações.",
        branches: "condition usa yes/no; esperas de resposta usam cada rule.id e timeout; cada ramo tem no máximo uma saída.",
        topology: "Sem ciclos, auto-ligações, ligações duplicadas ou saídas de end. Passos lineares podem abrir caminhos paralelos.",
        limits: AUTOMATION_GRAPH_LIMITS,
      },
      protected_system_flows: PROTECTED_AUTOMATION_SURFACES,
    }),
  },
  {
    name: "list_automation_flows",
    module: "automations",
    description: "Listar fluxos da organização atual e indicar quais são grafos nativos editáveis pelo Otto.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: AUTOMATION_FLOW_STATUSES },
        max_results: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: [],
      additionalProperties: false,
    },
    permission: { module: "automations", subarea: "flows", action: "view" },
    execute: async (args, ctx) => {
      const input = parseAutomationArgs(automationListArgsSchema, args);
      if (!input) return { error: "Argumentos inválidos", reason_code: "invalid_arguments" };
      let query = ctx.supabaseAdmin.from("automation_flows")
        .select(AUTOMATION_DETAIL_COLUMNS)
        .eq("organization_id", ctx.orgId)
        .order("updated_at", { ascending: false })
        .limit(input.max_results ?? 50);
      if (input.status) query = query.eq("status", input.status);
      const { data, error } = await query;
      const rows: unknown = data;
      if (error || !Array.isArray(rows)) return AUTOMATION_DATABASE_ERROR;
      const flows = [];
      for (const row of filterAccessibleRecords(ctx, rows.filter((item): item is object => (
        typeof item === "object" && item !== null && !Array.isArray(item)
      )))) {
        const flow = parseAutomationFlowRow(row);
        if (!flow || flow.organization_id !== ctx.orgId) return AUTOMATION_DATABASE_ERROR;
        const native = nativeFlowState(flow);
        flows.push({ ...safeSummary(flow), native_graph: native.native, editable_by_otto: native.native });
      }
      return { flows, count: flows.length, protected_system_flows: PROTECTED_AUTOMATION_SURFACES };
    },
  },
  {
    name: "get_automation_flow",
    module: "automations",
    description: "Obter um fluxo da organização, incluindo o grafo nativo e a validação necessária para o editar ou ativar.",
    parameters: FLOW_ID_PARAMETERS,
    permission: { module: "automations", subarea: "flows", action: "view" },
    execute: async (args, ctx) => {
      const input = parseAutomationArgs(automationFlowIdArgsSchema, args);
      if (!input) return AUTOMATION_NOT_FOUND;
      const loaded = await loadAutomationFlow(ctx, input.flow_id);
      if (!loaded.ok) return loaded.result;
      const state = nativeFlowState(loaded.flow);
      if (!state.native) {
        return {
          flow: safeSummary(loaded.flow),
          native_graph: false,
          editable_by_otto: false,
          protection: { reason_code: "protected_automation", issues: state.issues },
        };
      }
      const activation = validateNativeAutomationGraph(state.flow.graph, {
        entryNodeId: state.flow.entry_node_id,
        allowedEntryTriggers: ALL_NATIVE_TRIGGERS,
        requireComplete: true,
      });
      const referenceFailure = await validateAutomationReferences(ctx, state.flow.graph, state.flow.folder_id);
      return {
        flow: state.flow,
        native_graph: true,
        editable_by_otto: true,
        activation_validation: {
          ready: activation.ok && referenceFailure === null,
          issues: activation.ok ? [] : activation.issues,
          reference_error: referenceFailure,
        },
      };
    },
  },
] satisfies readonly Tool[];
