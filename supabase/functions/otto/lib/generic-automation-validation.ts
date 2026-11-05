import { z } from "https://esm.sh/zod@3.25.76";

import {
  parseAutomationWorkflowDefinition,
  parseAutomationWorkflowDraft,
  validateWorkflowStageNodeReferences,
} from "../../_shared/automation-workflow-contract.ts";
import { CONFIGURED_WORKFLOW_ACTION_TYPES } from "../../automation-engine/configured-workflow-runtime.ts";

import {
  automationNodeBranches,
  validateAutomationNodeConfig,
} from "./generic-automation-config.ts";
import {
  AUTOMATION_GRAPH_LIMITS,
  NATIVE_AUTOMATION_NODE_TYPES,
  NATIVE_AUTOMATION_TRIGGERS,
  isNativeAutomationTrigger,
  type NativeAutomationTrigger,
} from "./generic-automation-schema.ts";

const identifierSchema = z.string().trim().min(1).max(AUTOMATION_GRAPH_LIMITS.maxIdentifierLength);
const coordinateSchema = z.number().finite().min(-1_000_000).max(1_000_000);
const positionSchema = z.object({ x: coordinateSchema, y: coordinateSchema }).strict();
const ghostOffsetSchema = z.object({ dx: coordinateSchema, dy: coordinateSchema }).strict();
const graphNodeSchema = z.object({
  id: identifierSchema,
  type: z.enum(NATIVE_AUTOMATION_NODE_TYPES),
  config: z.record(z.unknown()),
  position: positionSchema.optional(),
  ghostOffsets: z.record(ghostOffsetSchema).optional(),
}).strict();
const graphEdgeSchema = z.object({
  id: identifierSchema,
  source: identifierSchema,
  target: identifierSchema,
  branch: identifierSchema.nullable().default(null),
}).strict();
const automationGraphSchema = z.object({
  nodes: z.array(graphNodeSchema).max(AUTOMATION_GRAPH_LIMITS.maxNodes),
  edges: z.array(graphEdgeSchema).max(AUTOMATION_GRAPH_LIMITS.maxEdges),
}).strict();

export type NativeAutomationGraph = z.infer<typeof automationGraphSchema>;
export type NativeAutomationGraphNode = z.infer<typeof graphNodeSchema>;
export type AutomationGraphIssue = {
  readonly code: string;
  readonly nodeId: string | null;
  readonly message: string;
};
export type AutomationGraphValidation =
  | {
    readonly ok: true;
    readonly graph: NativeAutomationGraph;
    readonly entryNode: NativeAutomationGraphNode;
    readonly triggerType: NativeAutomationTrigger;
  }
  | { readonly ok: false; readonly issues: readonly AutomationGraphIssue[] };
export type AutomationGraphValidationOptions = {
  readonly entryNodeId: unknown;
  readonly allowedEntryTriggers: ReadonlySet<NativeAutomationTrigger>;
  readonly requireComplete: boolean;
};

const TRIGGER_TYPES: ReadonlySet<string> = new Set(NATIVE_AUTOMATION_TRIGGERS);
const graphIssue = (
  code: string,
  message: string,
  nodeId: string | null = null,
): AutomationGraphIssue => ({ code, nodeId, message });

function hasCycle(graph: NativeAutomationGraph): boolean {
  const indegree = new Map(graph.nodes.map(({ id }) => [id, 0]));
  const outgoing = new Map(graph.nodes.map(({ id }) => [id, [] as string[]]));
  for (const edge of graph.edges) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }
  const queue = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    visited += 1;
    for (const target of outgoing.get(current) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
  }
  return visited !== graph.nodes.length;
}

function duplicateValues(values: readonly string[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates;
}

function validateEdges(
  graph: NativeAutomationGraph,
  nodeById: ReadonlyMap<string, NativeAutomationGraphNode>,
): readonly AutomationGraphIssue[] {
  const issues: AutomationGraphIssue[] = [];
  const usedBranch = new Set<string>();
  const usedPair = new Set<string>();
  for (const edge of graph.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) {
      issues.push(graphIssue("edge_endpoint_missing", "A ligação aponta para um passo inexistente."));
      continue;
    }
    if (source.id === target.id) issues.push(graphIssue("self_edge", "Um passo não se pode ligar a si próprio.", source.id));
    if (TRIGGER_TYPES.has(target.type)) issues.push(graphIssue("trigger_incoming", "Um gatilho não pode receber ligações.", target.id));
    if (source.type === "end") issues.push(graphIssue("end_outgoing", "O passo final não pode ter saída.", source.id));
    const pair = `${source.id}\u0000${target.id}`;
    if (usedPair.has(pair)) issues.push(graphIssue("duplicate_connection", "Dois passos só podem ter uma ligação entre si.", source.id));
    usedPair.add(pair);
    const branches = automationNodeBranches(source);
    if (branches.length === 0 && edge.branch !== null) {
      issues.push(graphIssue("unexpected_branch", "Este passo não tem ramos.", source.id));
      continue;
    }
    if (branches.length > 0 && (edge.branch === null || !branches.includes(edge.branch))) {
      issues.push(graphIssue("invalid_branch", "A ligação não identifica um ramo válido deste passo.", source.id));
      continue;
    }
    if (edge.branch !== null) {
      const branchKey = `${source.id}\u0000${edge.branch}`;
      if (usedBranch.has(branchKey)) issues.push(graphIssue("branch_already_connected", "Cada ramo só pode ter uma saída.", source.id));
      usedBranch.add(branchKey);
    }
  }
  return issues;
}

export function validateNativeAutomationGraph(
  value: unknown,
  options: AutomationGraphValidationOptions,
): AutomationGraphValidation {
  const parsedEntryId = identifierSchema.safeParse(options.entryNodeId);
  const parsedGraph = automationGraphSchema.safeParse(value);
  if (!parsedEntryId.success || !parsedGraph.success) {
    return { ok: false, issues: [graphIssue("invalid_graph_format", "O grafo não cumpre o formato nativo do editor.")] };
  }
  const graph = parsedGraph.data;
  const issues: AutomationGraphIssue[] = [];
  const duplicateNodeIds = duplicateValues(graph.nodes.map(({ id }) => id));
  const duplicateEdgeIds = duplicateValues(graph.edges.map(({ id }) => id));
  for (const id of duplicateNodeIds) issues.push(graphIssue("duplicate_node_id", "Os identificadores dos passos têm de ser únicos.", id));
  if (duplicateEdgeIds.size > 0) issues.push(graphIssue("duplicate_edge_id", "Os identificadores das ligações têm de ser únicos."));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const entryNode = nodeById.get(parsedEntryId.data);
  const triggerNodes = graph.nodes.filter(({ type }) => TRIGGER_TYPES.has(type));
  if (!entryNode || !TRIGGER_TYPES.has(entryNode.type)) {
    issues.push(graphIssue("entry_node_invalid", "O entry_node_id tem de identificar o gatilho do fluxo."));
  }
  if (triggerNodes.length !== 1) issues.push(graphIssue("trigger_count_invalid", "O grafo tem de conter exatamente um gatilho."));
  if (entryNode && isNativeAutomationTrigger(entryNode.type) && !options.allowedEntryTriggers.has(entryNode.type)) {
    issues.push(graphIssue("trigger_not_allowed", "Este gatilho não pode ser criado ou escolhido por esta operação.", entryNode.id));
  }
  if (options.requireComplete && graph.nodes.length < 2) {
    issues.push(graphIssue("action_required", "Adicione pelo menos uma ação depois do gatilho."));
  }
  for (const node of graph.nodes) {
    const configIssues = validateAutomationNodeConfig(node, options.requireComplete);
    for (const config of configIssues) issues.push(graphIssue(config.code, config.message, node.id));
    const branches = automationNodeBranches(node);
    if (duplicateValues(branches).size > 0) issues.push(graphIssue("duplicate_rule_id", "As opções de resposta têm de usar identificadores únicos.", node.id));
  }
  if (entryNode?.type === "configured_workflow") {
    const parsedWorkflow = options.requireComplete
      ? parseAutomationWorkflowDefinition(entryNode.config.workflow)
      : parseAutomationWorkflowDraft(entryNode.config.workflow);
    if (parsedWorkflow.ok) {
      const selectedFields = new Set(parsedWorkflow.value.query.select);
      for (const node of graph.nodes.filter(({ type }) => type === "condition")) {
        const field = typeof node.config.field === "string" ? node.config.field : null;
        if (field && !selectedFields.has(field)) {
          issues.push(graphIssue(
            "workflow_condition_field_unselected",
            "O campo usado por uma condição do canvas deve estar selecionado na consulta do workflow.",
            node.id,
          ));
        }
      }
      const actionNodeIds = new Set(graph.nodes
        .filter(({ type }) => !TRIGGER_TYPES.has(type))
        .map(({ id }) => id));
      for (const workflowIssue of validateWorkflowStageNodeReferences(parsedWorkflow.value, actionNodeIds)) {
        issues.push(graphIssue(
          "workflow_stage_node_missing",
          workflowIssue.message,
          entryNode.id,
        ));
      }
      if (options.requireComplete) {
        const stageNodeIds = new Set(parsedWorkflow.value.stages.map(({ nodeId }) => nodeId));
        const configuredActions = new Set<string>(CONFIGURED_WORKFLOW_ACTION_TYPES);
        for (const stage of parsedWorkflow.value.stages) {
          const node = nodeById.get(stage.nodeId);
          if (!node || !configuredActions.has(node.type)) {
            issues.push(graphIssue(
              "workflow_stage_action_invalid",
              "Cada etapa configurável deve referenciar uma ação suportada pelo motor.",
              stage.nodeId,
            ));
          }
        }
        for (const node of graph.nodes.filter(({ id }) => id !== entryNode.id)) {
          if (configuredActions.has(node.type) && !stageNodeIds.has(node.id)) {
            issues.push(graphIssue(
              "workflow_action_unreferenced",
              "Cada ação externa do grafo configurável deve corresponder a uma etapa do workflow.",
              node.id,
            ));
          }
          const rules = node.config.rules;
          if (node.type === "wait_reply"
            || (node.type === "send_whatsapp"
              && (node.config.wait_reply === true || Array.isArray(rules) && rules.length > 0))) {
            issues.push(graphIssue(
              "workflow_interactive_wait_unsupported",
              "Fluxos configuráveis não suportam espera por resposta; usa uma espera temporal ou outro fluxo iniciado pelo evento de resposta.",
              node.id,
            ));
          }
        }
      }
    }
  }
  issues.push(...validateEdges(graph, nodeById));
  if (graph.edges.every(({ source, target }) => nodeById.has(source) && nodeById.has(target)) && hasCycle(graph)) {
    issues.push(graphIssue("cycle_detected", "O grafo não pode conter ciclos."));
  }
  if (issues.length > 0 || !entryNode || !isNativeAutomationTrigger(entryNode.type)) return { ok: false, issues };
  return { ok: true, graph, entryNode, triggerType: entryNode.type };
}

export function buildInitialAutomationGraph(triggerType: NativeAutomationTrigger): {
  readonly graph: NativeAutomationGraph;
  readonly entryNodeId: string;
} {
  const entryNodeId = `trigger_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  return {
    graph: { nodes: [{ id: entryNodeId, type: triggerType, config: {}, position: { x: 0, y: 0 } }], edges: [] },
    entryNodeId,
  };
}

export function deriveAutomationTriggerConfig(entry: NativeAutomationGraphNode): Readonly<Record<string, unknown>> {
  if (entry.type === "configured_workflow") return { workflow: entry.config.workflow };
  if (entry.type === "whatsapp_keyword") return { keywords: entry.config.keywords ?? [] };
  if (entry.type === "message_received") {
    return {
      channel_id: entry.config.channel_id ?? null,
      buffer_seconds: entry.config.buffer_seconds ?? 15,
    };
  }
  return {};
}
