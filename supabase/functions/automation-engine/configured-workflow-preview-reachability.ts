import type { WorkflowRecord } from "../_shared/automation-workflow-contract.ts";
import type { ConfiguredWorkflowGraphNode } from "./configured-workflow-runtime.ts";
import {
  evaluateConfiguredGraphReachability,
  evaluateNativeCondition,
  type ConfiguredGraphEdge,
} from "./configured-workflow-reachability.ts";

export type ConfiguredPreviewReachability = Readonly<{
  complete: boolean;
  immediate: ReadonlySet<string>;
  deferred: ReadonlySet<string>;
}>;

type Input = Readonly<{
  nodes: readonly ConfiguredWorkflowGraphNode[];
  edges: readonly ConfiguredGraphEdge[];
  entryNodeId: string;
  record: WorkflowRecord;
}>;

function downstream(edges: readonly ConfiguredGraphEdge[], start: string): ReadonlySet<string> {
  const reached = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const id = queue.shift();
    if (!id || reached.has(id)) continue;
    reached.add(id);
    for (const edge of edges) if (edge.source === id) queue.push(edge.target);
  }
  return reached;
}

function conditionsAreLocallySupported(
  nodes: readonly ConfiguredWorkflowGraphNode[],
  ids: ReadonlySet<string>,
): boolean {
  return nodes.filter((node) => ids.has(node.id) && node.type === "condition").every((node) => (
    evaluateNativeCondition(
      String(node.config.field ?? ""),
      String(node.config.operator ?? "equals"),
      undefined,
      node.config.value,
    ).known
  ));
}

export function evaluateConfiguredPreviewReachability(input: Input): ConfiguredPreviewReachability {
  const graph = { nodes: input.nodes, edges: input.edges };
  const current = evaluateConfiguredGraphReachability({
    graph,
    entryNodeId: input.entryNodeId,
    record: input.record,
  });
  if (!current.complete) return { complete: false, immediate: new Set(), deferred: new Set() };

  const immediate = new Set(Object.entries(current.actions)
    .filter(([, state]) => state.kind === "reachable_now")
    .map(([id]) => id));
  const deferred = new Set<string>();
  for (const wait of input.nodes.filter((node) => node.type === "wait")) {
    const probeNodes = input.nodes.map((node) => node.id === wait.id
      ? { ...node, type: "create_task" }
      : node);
    const probe = evaluateConfiguredGraphReachability({
      graph: { nodes: probeNodes, edges: input.edges },
      entryNodeId: input.entryNodeId,
      record: input.record,
    });
    if (!probe.complete) return { complete: false, immediate, deferred };
    const waitState = probe.actions[wait.id];
    if (waitState?.kind !== "reachable_now" && waitState?.kind !== "reachable_after_wait") continue;

    const ids = downstream(input.edges, wait.id);
    if (!conditionsAreLocallySupported(input.nodes, ids)) {
      return { complete: false, immediate, deferred };
    }
    const futureNodes = input.nodes.map((node) => ids.has(node.id) && node.type === "condition"
      ? { ...node, type: "configured_workflow" }
      : node);
    const future = evaluateConfiguredGraphReachability({
      graph: { nodes: futureNodes, edges: input.edges },
      entryNodeId: wait.id,
      record: input.record,
    });
    if (!future.complete) return { complete: false, immediate, deferred };
    for (const [id, state] of Object.entries(future.actions)) {
      if (state.kind === "reachable_after_wait" && !immediate.has(id)) deferred.add(id);
    }
  }
  return { complete: true, immediate, deferred };
}
