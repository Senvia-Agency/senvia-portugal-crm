import type { WorkflowRecord } from "../_shared/automation-workflow-contract.ts";
import { CONFIGURED_WORKFLOW_ACTION_TYPES, type ConfiguredWorkflowGraphNode } from "./configured-workflow-runtime.ts";

export type ConfiguredGraphEdge = Readonly<{
  id: string;
  source: string;
  target: string;
  branch?: string | null;
}>;

export type ConfiguredActionReachability =
  | { readonly kind: "reachable_now" }
  | { readonly kind: "reachable_after_wait" }
  | { readonly kind: "unreachable" }
  | { readonly kind: "unknown"; readonly reason: string };

export type ConfiguredGraphReachability = Readonly<{
  actions: Readonly<Record<string, ConfiguredActionReachability>>;
  complete: boolean;
}>;

type PathMode = "now" | "deferred" | "unknown";

function phoneKey(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return digits.length < 9 ? null : digits.slice(-9);
}

export function evaluateNativeCondition(
  field: string,
  operator: string,
  actual: unknown,
  expected: unknown,
): { readonly known: true; readonly value: boolean } | { readonly known: false; readonly reason: string } {
  if (operator === "in_clients" || operator === "in_leads" || operator === "in_crm") {
    return { known: false, reason: "database_condition" };
  }
  const phone = /telefone|phone|whatsapp/i.test(field);
  const same = phone
    ? phoneKey(String(actual ?? "")) !== null && phoneKey(String(actual ?? "")) === phoneKey(String(expected ?? ""))
    : String(actual ?? "").trim().toLowerCase() === String(expected ?? "").trim().toLowerCase();
  switch (operator) {
    case "is_not_empty": case "exists": return { known: true, value: actual !== undefined && actual !== null && actual !== "" };
    case "is_empty": case "not_exists": return { known: true, value: actual === undefined || actual === null || actual === "" };
    case "contains": return { known: true, value: String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase()) };
    case "not_equals": return { known: true, value: !same };
    case "greater_than": return { known: true, value: Number(actual) > Number(expected) };
    case "less_than": return { known: true, value: Number(actual) < Number(expected) };
    case "equals": return { known: true, value: same };
    default: return { known: false, reason: "unsupported_condition" };
  }
}

function mergeReachability(
  current: ConfiguredActionReachability,
  mode: PathMode,
  reason: string,
): ConfiguredActionReachability {
  if (current.kind === "reachable_now" || mode === "now") return { kind: "reachable_now" };
  if (current.kind === "reachable_after_wait" || mode === "deferred") return { kind: "reachable_after_wait" };
  return { kind: "unknown", reason };
}

function vars(record: WorkflowRecord): Readonly<Record<string, unknown>> {
  const name = record.contact?.name?.trim() ?? "";
  return {
    ...record.fields,
    nome: name,
    primeiro_nome: name.split(/\s+/)[0] ?? name,
    email: record.contact?.email ?? "",
    telefone: record.contact?.phone ?? "",
    empresa: record.fields.company_name ?? record.fields.empresa ?? "",
    nif: record.fields.company_nif ?? record.fields.nif ?? "",
    fonte: record.fields.source ?? record.fields.fonte ?? "",
  };
}

function hasCycle(nodes: readonly ConfiguredWorkflowGraphNode[], edges: readonly ConfiguredGraphEdge[]): boolean {
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }
  const queue = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift();
    if (!id) break;
    visited++;
    for (const target of outgoing.get(id) ?? []) {
      const next = (incoming.get(target) ?? 0) - 1;
      incoming.set(target, next);
      if (next === 0) queue.push(target);
    }
  }
  return visited !== nodes.length;
}

export function evaluateConfiguredGraphReachability(input: Readonly<{
  graph: Readonly<{
    nodes: readonly ConfiguredWorkflowGraphNode[];
    edges: readonly ConfiguredGraphEdge[];
  }>;
  entryNodeId: string;
  record: WorkflowRecord;
}>): ConfiguredGraphReachability {
  const nodeById = new Map(input.graph.nodes.map((node) => [node.id, node]));
  const actionTypes = new Set<string>(CONFIGURED_WORKFLOW_ACTION_TYPES);
  const actions: Record<string, ConfiguredActionReachability> = Object.fromEntries(
    input.graph.nodes.filter((node) => actionTypes.has(node.type)).map((node) => [node.id, { kind: "unreachable" }]),
  );
  if (!nodeById.has(input.entryNodeId)
    || input.graph.edges.some((edge) => !nodeById.has(edge.source) || !nodeById.has(edge.target))) {
    return { actions: Object.fromEntries(Object.keys(actions).map((id) => [id, { kind: "unknown", reason: "invalid_graph" }])), complete: false };
  }
  if (hasCycle(input.graph.nodes, input.graph.edges)) {
    return { actions: Object.fromEntries(Object.keys(actions).map((id) => [id, { kind: "unknown", reason: "cycle" }])), complete: false };
  }
  const values = vars(input.record);
  const queue: Array<Readonly<{ id: string; mode: PathMode; reason: string }>> = [
    { id: input.entryNodeId, mode: "now", reason: "" },
  ];
  const visited = new Set<string>();
  let complete = true;
  let iterations = 0;
  while (queue.length && iterations <= input.graph.nodes.length * 3) {
    iterations++;
    const path = queue.shift();
    if (!path) break;
    const visitKey = `${path.id}:${path.mode}:${path.reason}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);
    const node = nodeById.get(path.id);
    if (!node) { complete = false; continue; }
    let mode = path.mode;
    let reason = path.reason;
    if (actionTypes.has(node.type)) {
      actions[node.id] = mergeReachability(actions[node.id] ?? { kind: "unreachable" }, mode, reason || "unknown_path");
    }
    if (node.type === "end") continue;
    let edges = input.graph.edges.filter((edge) => edge.source === node.id);
    if (node.type === "condition") {
      const field = String(node.config.field ?? "");
      const result = evaluateNativeCondition(field, String(node.config.operator ?? "equals"), values[field], node.config.value);
      if (result.known) edges = edges.filter((edge) => edge.branch === (result.value ? "yes" : "no"));
      else { mode = "unknown"; reason = result.reason; complete = false; }
    } else if (node.type === "wait") {
      if (mode === "now") mode = "deferred";
    } else if (!actionTypes.has(node.type) && node.type !== "trigger" && node.type !== "configured_workflow") {
      mode = "unknown";
      reason = `unsupported_node:${node.type}`;
      complete = false;
    }
    for (const edge of edges) queue.push({ id: edge.target, mode, reason });
  }
  if (queue.length) {
    complete = false;
    for (const id of Object.keys(actions)) {
      if (actions[id]?.kind === "unreachable") actions[id] = { kind: "unknown", reason: "cycle_or_path_limit" };
    }
  }
  return { actions, complete };
}
