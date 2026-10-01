import type {
  AutomationGraph, AutomationRun, AutomationRunStep, AutomationRunStepStatus,
} from '@/types/automations';

/**
 * One execution drawn on the canvas, the way n8n shows an execution: which
 * steps ran and how each ended, which branch each branching step took, and
 * which lines the run actually travelled. A step missing from `nodes` did not
 * run in this execution.
 */
export interface ExecutionView {
  runId: string;
  nodes: Record<string, AutomationRunStepStatus>;
  /** Branch key a branching step went down ("yes"/"no", a reply rule, "timeout"…). */
  branches: Record<string, string>;
  edges: Set<string>;
}

const PARKED: AutomationRun['status'][] = ['running', 'waiting', 'awaiting_reply'];

/** The branch a step's detail says it took, if it is a branching step. */
function branchOf(step: AutomationRunStep): string | null {
  const detail = step.detail ?? {};
  // Reply waits record it as `ramo` when they settle.
  if (typeof detail.ramo === 'string' && detail.ramo) return detail.ramo;
  // A condition records its verdict; its branches are "yes" and "no".
  if (step.node_type === 'condition' && typeof detail.resultado === 'boolean') {
    return detail.resultado ? 'yes' : 'no';
  }
  return null;
}

export function buildExecutionView(
  graph: AutomationGraph,
  run: AutomationRun,
  steps: AutomationRunStep[],
): ExecutionView {
  const nodes: Record<string, AutomationRunStepStatus> = {};
  const branches: Record<string, string> = {};
  // Steps come oldest first; a step retried later ends with its newest result.
  for (const step of steps) {
    if (!step.node_id) continue;
    nodes[step.node_id] = step.status;
    const branch = branchOf(step);
    if (branch) branches[step.node_id] = branch;
  }

  // A run parked on a step may have no row for it yet: it is still there.
  if (PARKED.includes(run.status)) {
    const cursors = (run.context?.__cursors ?? []) as Array<{ node?: string }>;
    const parked = [run.current_node_id, ...cursors.map((c) => c.node)];
    for (const nodeId of parked) {
      if (nodeId && !nodes[nodeId]) nodes[nodeId] = 'waiting';
    }
  }

  // A line was travelled when the step it leaves from went on (did not fail)
  // and, for a branching step, it is the branch taken — lit even when nothing
  // runs after it, so the condition's verdict reads on the canvas. A plain
  // line needs the step it leads to to have been reached.
  const edges = new Set<string>();
  for (const edge of graph.edges) {
    const from = nodes[edge.source];
    if (!from || from === 'failed') continue;
    const taken = branches[edge.source];
    if (edge.branch && taken) {
      if (edge.branch === taken) edges.add(edge.id);
    } else if (nodes[edge.target]) {
      edges.add(edge.id);
    }
  }

  return { runId: run.id, nodes, branches, edges };
}

/** Whether the "+" hanging off this step's branch is the way the run went. */
export function ghostTaken(view: ExecutionView | null | undefined, sourceId: string, branch: string | null) {
  if (!view || !branch) return false;
  const from = view.nodes[sourceId];
  return !!from && from !== 'failed' && view.branches[sourceId] === branch;
}
