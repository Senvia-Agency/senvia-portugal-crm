import type { Tool, ToolResult } from "../types.ts";
import {
  CREATABLE_AUTOMATION_TRIGGERS,
  isCreatableAutomationTrigger,
  type NativeAutomationTrigger,
} from "../generic-automation-schema.ts";
import {
  AUTOMATION_CONFLICT,
  AUTOMATION_DATABASE_ERROR,
  AUTOMATION_DETAIL_COLUMNS,
  AUTOMATION_PROTECTED,
  automationInvalidArguments,
  automationResource,
  automationValidationFailure,
  loadAutomationFlow,
  matchesExpectedFlow,
  nativeFlowState,
  parseAutomationFlowRow,
} from "../generic-automation-store.ts";
import {
  buildInitialAutomationGraph,
  deriveAutomationTriggerConfig,
  validateNativeAutomationGraph,
} from "../generic-automation-validation.ts";
import { validateAutomationReferences } from "../generic-automation-references.ts";
import {
  CONCURRENCY_PARAMETERS,
  GRAPH_PARAMETER,
  automationConcurrencyArgsSchema,
  createAutomationDraftArgsSchema,
  parseAutomationArgs,
  updateAutomationDraftArgsSchema,
} from "../generic-automation-tool-contracts.ts";

const CREATABLE_TRIGGERS: ReadonlySet<NativeAutomationTrigger> = new Set(CREATABLE_AUTOMATION_TRIGGERS);
const FLOW_NOT_DRAFT: ToolResult = {
  error: "Apenas rascunhos podem ser editados por esta ferramenta.",
  reason_code: "flow_not_draft",
  _instruction: "A operação NÃO foi executada. Pausa o fluxo e cria ou edita um rascunho conforme necessário.",
};
const FLOW_NOT_ACTIVE: ToolResult = {
  error: "A automação já não está ativa.",
  reason_code: "flow_not_active",
  _instruction: "A pausa NÃO foi aplicada. Volta a consultar o estado atual.",
};

function mutationResult(operation: string, flow: ReturnType<typeof parseAutomationFlowRow>) {
  if (!flow) return AUTOMATION_DATABASE_ERROR;
  return {
    operation,
    flow,
    resource: automationResource(flow.id),
    invalidateQueryKeys: [["automation-flows"], ["automation-flow", flow.id]],
  };
}

export const genericAutomationWriteTools = [
  {
    name: "create_automation_draft",
    module: "automations",
    description: "Criar um rascunho de automação nativo e inativo. Aceita apenas gatilhos e passos publicados pelo construtor.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 160 },
        description: { anyOf: [{ type: "string", maxLength: 2_000 }, { type: "null" }] },
        trigger_type: { type: "string", enum: CREATABLE_AUTOMATION_TRIGGERS },
        graph: GRAPH_PARAMETER,
        entry_node_id: { type: "string", maxLength: 128 },
        reentry_policy: { type: "string", enum: ["once", "after_completion", "always"] },
        quiet_hours: { type: ["object", "null"] },
        max_steps_per_run: { type: "integer", minimum: 1, maximum: 1_000 },
        folder_id: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
      },
      required: ["name", "trigger_type"],
      additionalProperties: false,
    },
    permission: { module: "automations", subarea: "flows", action: "create" },
    isWrite: true,
    confirmation: { kind: "immediate" },
    execute: async (args, ctx) => {
      const input = parseAutomationArgs(createAutomationDraftArgsSchema, args);
      if (!input) return automationInvalidArguments();
      const initial = buildInitialAutomationGraph(input.trigger_type);
      const graph = input.graph ?? initial.graph;
      const entryNodeId = input.graph ? input.entry_node_id : initial.entryNodeId;
      const validation = validateNativeAutomationGraph(graph, {
        entryNodeId,
        allowedEntryTriggers: CREATABLE_TRIGGERS,
        requireComplete: false,
      });
      if (!validation.ok || validation.triggerType !== input.trigger_type) {
        return automationValidationFailure(validation.ok
          ? [{ code: "trigger_mismatch", nodeId: validation.entryNode.id, message: "O gatilho do grafo não corresponde ao trigger_type pedido." }]
          : validation.issues);
      }
      const referenceFailure = await validateAutomationReferences(ctx, validation.graph, input.folder_id ?? null);
      if (referenceFailure) return referenceFailure;
      const { data, error } = await ctx.supabaseAdmin.from("automation_flows").insert({
        organization_id: ctx.orgId,
        name: input.name,
        description: input.description ?? null,
        status: "draft",
        trigger_type: validation.triggerType,
        trigger_config: deriveAutomationTriggerConfig(validation.entryNode),
        graph: validation.graph,
        entry_node_id: validation.entryNode.id,
        version: 1,
        reentry_policy: input.reentry_policy ?? "once",
        quiet_hours: input.quiet_hours ?? null,
        max_steps_per_run: input.max_steps_per_run ?? 100,
        folder_id: input.folder_id ?? null,
        created_by: ctx.userId,
      }).select(AUTOMATION_DETAIL_COLUMNS).single();
      if (error) return AUTOMATION_DATABASE_ERROR;
      const flow = parseAutomationFlowRow(data);
      if (!flow || flow.organization_id !== ctx.orgId || flow.status !== "draft") return AUTOMATION_DATABASE_ERROR;
      return mutationResult("created", flow);
    },
  },
  {
    name: "update_automation_draft",
    module: "automations",
    description: "Editar um rascunho nativo com controlo otimista de versão e updated_at. Nunca altera um fluxo ativo ou pausado.",
    parameters: {
      type: "object",
      properties: {
        ...CONCURRENCY_PARAMETERS.properties,
        name: { type: "string", minLength: 1, maxLength: 160 },
        description: { anyOf: [{ type: "string", maxLength: 2_000 }, { type: "null" }] },
        graph: GRAPH_PARAMETER,
        entry_node_id: { type: "string", maxLength: 128 },
        reentry_policy: { type: "string", enum: ["once", "after_completion", "always"] },
        quiet_hours: { type: ["object", "null"] },
        max_steps_per_run: { type: "integer", minimum: 1, maximum: 1_000 },
        folder_id: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
      },
      required: CONCURRENCY_PARAMETERS.required,
      additionalProperties: false,
    },
    permission: { module: "automations", subarea: "flows", action: "edit" },
    isWrite: true,
    confirmation: { kind: "immediate" },
    execute: async (args, ctx) => {
      const input = parseAutomationArgs(updateAutomationDraftArgsSchema, args);
      if (!input) return automationInvalidArguments();
      const loaded = await loadAutomationFlow(ctx, input.flow_id);
      if (!loaded.ok) return loaded.result;
      if (!matchesExpectedFlow(loaded.flow, { version: input.expected_version, updatedAt: input.expected_updated_at })) return AUTOMATION_CONFLICT;
      if (loaded.flow.status !== "draft") return FLOW_NOT_DRAFT;
      const current = nativeFlowState(loaded.flow);
      if (!current.native) return AUTOMATION_PROTECTED;
      const graph = input.graph ?? current.flow.graph;
      const entryNodeId = input.entry_node_id ?? current.flow.entry_node_id;
      const allowed: ReadonlySet<NativeAutomationTrigger> = isCreatableAutomationTrigger(current.flow.trigger_type)
        ? CREATABLE_TRIGGERS
        : new Set<NativeAutomationTrigger>([current.flow.trigger_type]);
      const validation = validateNativeAutomationGraph(graph, {
        entryNodeId,
        allowedEntryTriggers: allowed,
        requireComplete: false,
      });
      if (!validation.ok) return automationValidationFailure(validation.issues);
      const folderId = input.folder_id === undefined ? current.flow.folder_id : input.folder_id;
      const referenceFailure = await validateAutomationReferences(ctx, validation.graph, folderId);
      if (referenceFailure) return referenceFailure;
      const updates: Record<string, unknown> = {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.reentry_policy !== undefined) updates.reentry_policy = input.reentry_policy;
      if (input.quiet_hours !== undefined) updates.quiet_hours = input.quiet_hours;
      if (input.max_steps_per_run !== undefined) updates.max_steps_per_run = input.max_steps_per_run;
      if (input.folder_id !== undefined) updates.folder_id = input.folder_id;
      if (input.graph !== undefined || input.entry_node_id !== undefined) {
        updates.graph = validation.graph;
        updates.entry_node_id = validation.entryNode.id;
        updates.trigger_type = validation.triggerType;
        updates.trigger_config = deriveAutomationTriggerConfig(validation.entryNode);
      }
      const { data, error } = await ctx.supabaseAdmin.from("automation_flows").update(updates)
        .eq("id", current.flow.id).eq("organization_id", ctx.orgId).eq("status", "draft")
        .eq("version", input.expected_version).eq("updated_at", input.expected_updated_at)
        .select(AUTOMATION_DETAIL_COLUMNS).maybeSingle();
      if (error) return AUTOMATION_DATABASE_ERROR;
      if (data === null) return AUTOMATION_CONFLICT;
      return mutationResult("updated", parseAutomationFlowRow(data));
    },
  },
  {
    name: "pause_automation_flow",
    module: "automations",
    description: "Pausar inscrições futuras num fluxo ativo, mantendo as execuções já em curso.",
    parameters: CONCURRENCY_PARAMETERS,
    permission: { module: "automations", subarea: "flows", action: "manage" },
    isWrite: true,
    confirmation: { kind: "immediate" },
    execute: async (args, ctx) => {
      const input = parseAutomationArgs(automationConcurrencyArgsSchema, args);
      if (!input) return automationInvalidArguments();
      const loaded = await loadAutomationFlow(ctx, input.flow_id);
      if (!loaded.ok) return loaded.result;
      if (!matchesExpectedFlow(loaded.flow, { version: input.expected_version, updatedAt: input.expected_updated_at })) return AUTOMATION_CONFLICT;
      if (loaded.flow.status !== "active") return FLOW_NOT_ACTIVE;
      if (!nativeFlowState(loaded.flow).native) return AUTOMATION_PROTECTED;
      const { data, error } = await ctx.supabaseAdmin.from("automation_flows").update({ status: "paused" })
        .eq("id", loaded.flow.id).eq("organization_id", ctx.orgId).eq("status", "active")
        .eq("version", input.expected_version).eq("updated_at", input.expected_updated_at)
        .select(AUTOMATION_DETAIL_COLUMNS).maybeSingle();
      if (error) return AUTOMATION_DATABASE_ERROR;
      if (data === null) return AUTOMATION_CONFLICT;
      return mutationResult("paused", parseAutomationFlowRow(data));
    },
  },
] satisfies readonly Tool[];
