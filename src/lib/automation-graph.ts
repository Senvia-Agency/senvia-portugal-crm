// Graph helpers for the automation canvas.
//
// Layout has two modes. While no node has been placed by hand, positions are
// recomputed with dagre in a left-to-right rank layout. Once the user drags a
// node, every node's position is persisted into the graph and used as-is —
// "Auto-organizar" runs dagre again and writes the tidy positions back. All
// mutations here are pure — they take a graph and return a new one — so the
// editor can keep the whole document in state and mark it dirty.

import dagre from 'dagre';
import type {
  AutomationGraph, AutomationGraphEdge, AutomationGraphNode, AutomationNodeType,
  AutomationTriggerType,
} from '@/types/automations';
import { getNodeBranches, getNodeDefinition } from '@/lib/automation-nodes';

/** Layout box reserved per node: the 66px circle plus its label block. */
export const NODE_BOX_WIDTH = 190;
export const NODE_BOX_HEIGHT = 118;
/**
 * Ghost "add here" affordances are small, so they get a tighter box. Must match
 * the rendered button (h-11 w-11) exactly or dagre centres them off-axis.
 */
export const GHOST_BOX_WIDTH = 44;
export const GHOST_BOX_HEIGHT = 44;
/** Vertical centre of the node circle inside its box (see AutomationFlowNode). */
const NODE_CIRCLE_CENTER_Y = 33;
/** Manual-layout ghost placement relative to its anchor node. */
const MANUAL_GHOST_GAP_X = 96;
/** Horizontal gap used when appending a node in manual-layout mode. */
const MANUAL_APPEND_GAP_X = 110;
/**
 * Manual layout gives each branch its own lane: the first on the step's own
 * row, the next one a whole step lower, and so on. A step added on a branch
 * and the "+" of a branch still free use the same lane, so they never share a
 * spot — "Sim" and "Não" used to land on the same row, one over the other.
 */
const BRANCH_LANE_Y = NODE_BOX_HEIGHT + 22;

/** Lane of `branch` among the step's branches (0 for a step that does not branch). */
function branchLane(source: AutomationGraphNode | undefined, branch: string | null): number {
  if (!source || !branch) return 0;
  const index = getNodeBranches(source).findIndex((item) => item.key === branch);
  return index < 0 ? 0 : index;
}

interface Box { x: number; y: number; w: number; h: number }
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Moves `box` a lane at a time — down, or up for `direction` -1 — until it
 * covers none of `taken`.
 */
function clearOf(box: Box, taken: Box[], direction: 1 | -1 = 1): { x: number; y: number } {
  let y = box.y;
  for (let tries = 0; tries < 30 && taken.some((other) => overlaps({ ...box, y }, other)); tries++) {
    y += direction * BRANCH_LANE_Y;
  }
  return { x: box.x, y };
}

/** Key a branch's "+" offset is stored under ("" for a step without branches). */
const ghostKey = (branch: string | null) => branch ?? '';

/** Remembers where the "+" of `branch` was dragged to, relative to its step. */
export function setGhostOffset(
  graph: AutomationGraph,
  sourceId: string,
  branch: string | null,
  offset: { dx: number; dy: number },
): AutomationGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === sourceId
      ? { ...node, ghostOffsets: { ...(node.ghostOffsets ?? {}), [ghostKey(branch)]: offset } }
      : node)),
  };
}

const nodeBox = (position: { x: number; y: number }): Box =>
  ({ x: position.x, y: position.y, w: NODE_BOX_WIDTH, h: NODE_BOX_HEIGHT });

export function createId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${random}`;
}

export function createNode(type: AutomationNodeType): AutomationGraphNode {
  const definition = getNodeDefinition(type);
  return {
    id: createId('n'),
    type,
    // Deep-ish clone so two nodes never share a config object (rules arrays!).
    config: JSON.parse(JSON.stringify(definition?.defaultConfig ?? {})),
    position: { x: 0, y: 0 },
  };
}

/**
 * Swaps the entry (trigger) node's type. Keeps its `id` (so any outgoing edge
 * survives) and its `position`, but resets `config` to the new trigger's
 * default — the old trigger's fields (e.g. a stage filter) have no meaning for
 * a different trigger and would otherwise linger as dead data.
 */
export function changeTriggerType(
  graph: AutomationGraph, entryNodeId: string, newType: AutomationTriggerType,
): AutomationGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id !== entryNodeId ? node : {
      ...node,
      type: newType,
      config: JSON.parse(JSON.stringify(getNodeDefinition(newType)?.defaultConfig ?? {})),
    })),
  };
}

/** A brand new flow is just its trigger node. */
export function createInitialGraph(triggerType: AutomationNodeType): {
  graph: AutomationGraph;
  entryNodeId: string;
} {
  const trigger = createNode(triggerType);
  return {
    graph: { nodes: [trigger], edges: [] },
    entryNodeId: trigger.id,
  };
}

/** Tolerates a null/malformed `graph` column. */
export function normalizeGraph(raw: unknown): AutomationGraph {
  const graph = (raw ?? {}) as Partial<AutomationGraph>;
  return {
    nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
    edges: Array.isArray(graph.edges) ? graph.edges : [],
  };
}

export function findNode(graph: AutomationGraph, id: string | null): AutomationGraphNode | undefined {
  if (!id) return undefined;
  return graph.nodes.find((node) => node.id === id);
}

/** The trigger node — the flow's entry point. */
export function getEntryNode(
  graph: AutomationGraph,
  entryNodeId: string | null,
): AutomationGraphNode | undefined {
  return findNode(graph, entryNodeId) ?? graph.nodes.find((n) => getNodeDefinition(n.type)?.isTrigger);
}

/**
 * True once the steps have been placed by hand (a drag, a dropped "+", or
 * "Auto-organizar") and the canvas must respect that instead of re-running
 * dagre. A graph where nothing has moved yet still lays itself out.
 */
export function hasManualLayout(graph: AutomationGraph): boolean {
  if (!graph.nodes.length) return false;
  if (!graph.nodes.every((node) => !!node.position)) return false;
  // A graph straight out of a recipe has every node at the origin — that is
  // the "never arranged" signal. One step legitimately dropped on 0,0 is not,
  // so the test is whether ANY step has moved, not every one. Demanding every
  // one sent the whole layout back to dagre the moment a node landed there.
  return graph.nodes.some((node) => (node.position?.x ?? 0) !== 0 || (node.position?.y ?? 0) !== 0);
}

// ── Mutations ───────────────────────────────────────────────────────────────

export function updateNodeConfig(
  graph: AutomationGraph,
  nodeId: string,
  config: AutomationGraphNode['config'],
): AutomationGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === nodeId ? { ...node, config } : node)),
  };
}

/**
 * Appends a node after `sourceId` on `branch` (which must currently be free).
 * In manual-layout mode the new node lands to the right of its source, so one
 * append does not throw the whole hand-made layout back to dagre.
 */
export function appendNode(
  graph: AutomationGraph,
  sourceId: string,
  branch: string | null,
  type: AutomationNodeType,
): { graph: AutomationGraph; node: AutomationGraphNode } {
  const node = createNode(type);

  let nodes = graph.nodes;
  const source = findNode(graph, sourceId);
  const dragged = source?.ghostOffsets?.[ghostKey(branch)];
  if (hasManualLayout(graph) && source?.position && dragged) {
    // The "+" was dragged somewhere: the step is born right there (its circle
    // where the "+" was), and the branch no longer needs a remembered spot.
    node.position = {
      x: source.position.x + dragged.dx + GHOST_BOX_WIDTH / 2 - NODE_BOX_WIDTH / 2,
      y: source.position.y + dragged.dy + GHOST_BOX_HEIGHT / 2 - NODE_CIRCLE_CENTER_Y,
    };
    const rest = { ...(source.ghostOffsets ?? {}) };
    delete rest[ghostKey(branch)];
    nodes = graph.nodes.map((item) => (item.id === sourceId ? { ...item, ghostOffsets: rest } : item));
  } else if (hasManualLayout(graph)) {
    if (source?.position) {
      // A branching step: that branch's lane. A plain step fanning out: one
      // lane below the paths it already has.
      const lane = getNodeBranches(source).length
        ? branchLane(source, branch)
        : graph.edges.filter((edge) => edge.source === sourceId).length;
      const taken = graph.nodes.filter((other) => other.position).map((other) => nodeBox(other.position!));
      node.position = clearOf({
        x: source.position.x + NODE_BOX_WIDTH + MANUAL_APPEND_GAP_X,
        y: source.position.y + lane * BRANCH_LANE_Y,
        w: NODE_BOX_WIDTH,
        h: NODE_BOX_HEIGHT,
      }, taken);
    }
  }

  const edge: AutomationGraphEdge = {
    id: createId('e'),
    source: sourceId,
    target: node.id,
    branch,
  };
  return {
    graph: { nodes: [...nodes, node], edges: [...graph.edges, edge] },
    node,
  };
}

/**
 * Splices a node into an existing edge: A→B becomes A→N→B. The original
 * edge's branch stays on the upstream half, so branch semantics are preserved.
 * In manual-layout mode the new node takes B's place and everything from B on
 * moves one step to the right, as n8n does. Dropped midway, it sat on top of
 * both neighbours.
 */
export function insertNodeOnEdge(
  graph: AutomationGraph,
  edgeId: string,
  type: AutomationNodeType,
): { graph: AutomationGraph; node: AutomationGraphNode } {
  const target = graph.edges.find((edge) => edge.id === edgeId);
  if (!target) return { graph, node: null as unknown as AutomationGraphNode };

  const node = createNode(type);
  let nodes = graph.nodes;

  if (hasManualLayout(graph)) {
    const to = findNode(graph, target.target)?.position;
    if (to) {
      node.position = { ...to };
      // B and every step after it, never the step the line comes from (a loop
      // back to it would otherwise drag it along too).
      const shift = NODE_BOX_WIDTH + MANUAL_APPEND_GAP_X;
      const moved = new Set<string>();
      const queue = [target.target];
      while (queue.length) {
        const id = queue.shift() as string;
        if (moved.has(id) || id === target.source) continue;
        moved.add(id);
        for (const edge of graph.edges) if (edge.source === id) queue.push(edge.target);
      }
      nodes = graph.nodes.map((item) => (moved.has(item.id) && item.position
        ? { ...item, position: { x: item.position.x + shift, y: item.position.y } }
        : item));
    }
  }

  const upstream: AutomationGraphEdge = {
    id: createId('e'),
    source: target.source,
    target: node.id,
    branch: target.branch,
  };
  // A step that branches (a condition, a reply wait) has no plain exit: the
  // engine only follows the branch it took, so a plain line out of it never
  // runs. Inserting a condition used to leave exactly that — a line to the old
  // next step that "Sim" did not follow. It goes on the first branch instead.
  const downstream: AutomationGraphEdge = {
    id: createId('e'),
    source: node.id,
    target: target.target,
    branch: getNodeBranches(node)[0]?.key ?? null,
  };

  return {
    graph: {
      nodes: [...nodes, node],
      edges: [...graph.edges.filter((edge) => edge.id !== edgeId), upstream, downstream],
    },
    node,
  };
}

/**
 * Writes canvas positions into the graph (drag-stop or "Auto-organizar").
 * Ghost ids may be present in `positions`; only real nodes are touched.
 */
export function updateNodePositions(
  graph: AutomationGraph,
  positions: Record<string, { x: number; y: number }>,
): AutomationGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      positions[node.id] ? { ...node, position: { ...positions[node.id] } } : node,
    ),
  };
}

/**
 * Removes a node and heals the graph: every incoming edge is re-pointed at the
 * node's unbranched successors, so a chain stays connected — and a step that
 * fanned out keeps all of its paths. Branches hanging off the removed node are
 * dropped along with their subtree links, and those nodes survive as
 * unreachable roots the user can see and rewire.
 */
export function removeNode(graph: AutomationGraph, nodeId: string): AutomationGraph {
  const incoming = graph.edges.filter((edge) => edge.target === nodeId);
  const outgoing = graph.edges.filter((edge) => edge.source === nodeId);
  // Prefer the plain successors; fall back to the first branch target.
  const plain = outgoing.filter((edge) => !edge.branch);
  const successors = plain.length ? plain : outgoing.slice(0, 1);

  const healed: AutomationGraphEdge[] = [];
  for (const edge of incoming) {
    // A branch is one path by definition, so it inherits a single successor.
    // An unbranched edge inherits them all and the fan-out survives.
    const targets = edge.branch ? successors.slice(0, 1) : successors;
    for (const successor of targets) {
      healed.push({
        id: createId('e'),
        source: edge.source,
        target: successor.target,
        branch: edge.branch,
      });
    }
  }

  // Healing can join two steps that were already joined (A→X→B next to A→B).
  return tidyEdges({
    nodes: graph.nodes.filter((node) => node.id !== nodeId),
    edges: [
      ...graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      ...healed,
    ],
  });
}

/**
 * Drops edges whose branch key no longer exists on the source node. Called
 * after every config edit, so deleting a reply rule unhooks its branch — and
 * turning "Aguardar resposta" off on a `send_whatsapp` (or emptying its rules)
 * unhooks all of them, since `getNodeBranches` then reports none. The nodes
 * downstream survive as unreachable roots the user can see and reconnect.
 */
export function pruneOrphanBranches(graph: AutomationGraph): AutomationGraph {
  return tidyEdges({
    ...graph,
    edges: graph.edges.filter((edge) => {
      if (!edge.branch) return true;
      const source = findNode(graph, edge.source);
      if (!source) return false;
      const branches = getNodeBranches(source);
      // Sources that aren't branching right now shouldn't carry branch keys.
      if (!branches.length) return false;
      return branches.some((branch) => branch.key === edge.branch);
    }),
  });
}

/**
 * The two rules every graph keeps:
 *
 *  1. One line between any two steps. Two branches into the same step say the
 *     same thing twice, and on the canvas the second line lay on top of the
 *     first with its buttons doubled.
 *  2. No plain line out of a step that branches — the engine never follows
 *     it. One left there (turning "Aguardar resposta" on with the next step
 *     already wired) moves to the first free branch, or goes if none is free.
 *
 * Branch lines are judged first so a plain one is what yields. The surviving
 * lines keep their original order.
 */
export function tidyEdges(graph: AutomationGraph): AutomationGraph {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const usedBranches = new Map<string, Set<string>>();
  const joined = new Set<string>();
  const decided = new Map<string, AutomationGraphEdge | null>();

  const ordered = [
    ...graph.edges.filter((edge) => edge.branch),
    ...graph.edges.filter((edge) => !edge.branch),
  ];
  for (const edge of ordered) {
    const pair = `${edge.source}→${edge.target}`;
    if (joined.has(pair)) { decided.set(edge.id, null); continue; }

    const used = usedBranches.get(edge.source) ?? new Set<string>();
    let branch = edge.branch;
    const branches = getNodeBranches(byId.get(edge.source));
    if (branches.length && !branch) {
      branch = branches.find((item) => !used.has(item.key))?.key ?? null;
      if (!branch) { decided.set(edge.id, null); continue; }
    }
    if (branch) {
      if (used.has(branch)) { decided.set(edge.id, null); continue; }
      used.add(branch);
      usedBranches.set(edge.source, used);
    }
    joined.add(pair);
    decided.set(edge.id, branch === edge.branch ? edge : { ...edge, branch });
  }

  const edges = graph.edges
    .map((edge) => decided.get(edge.id))
    .filter((edge): edge is AutomationGraphEdge => !!edge);
  const unchanged = edges.length === graph.edges.length
    && edges.every((edge, index) => edge === graph.edges[index]);
  return unchanged ? graph : { ...graph, edges };
}

// ── Canvas projection ───────────────────────────────────────────────────────

export interface GhostSlot {
  id: string;
  sourceId: string;
  branch: string | null;
  branchLabel: string | null;
}

/**
 * Every free outgoing slot in the graph — a branch with no edge, or a terminal
 * node with no successor. Each becomes a "+" ghost node on the canvas.
 */
export function getGhostSlots(graph: AutomationGraph): GhostSlot[] {
  const slots: GhostSlot[] = [];

  for (const node of graph.nodes) {
    // `end` is terminal by definition.
    if (node.type === 'end') continue;

    const branches = getNodeBranches(node);
    const outgoing = graph.edges.filter((edge) => edge.source === node.id);

    if (branches.length) {
      for (const branch of branches) {
        const taken = outgoing.some((edge) => edge.branch === branch.key);
        if (!taken) {
          slots.push({
            id: `ghost_${node.id}_${branch.key}`,
            sourceId: node.id,
            branch: branch.key,
            branchLabel: branch.label,
          });
        }
      }
    } else if (!outgoing.length) {
      // Only the genuinely open end gets a standing "+". A step that already
      // has a successor can still fan out, but showing a permanent second "+"
      // on every step in the chain would bury the flow in placeholders — that
      // path is drawn from the step's own connection point instead.
      slots.push({
        id: `ghost_${node.id}`,
        sourceId: node.id,
        branch: null,
        branchLabel: null,
      });
    }
  }

  return slots;
}

export interface LayoutResult {
  positions: Record<string, { x: number; y: number }>;
}

/**
 * Runs dagre over the real nodes plus the ghost slots. Positions returned are
 * top-left corners (React Flow's origin), converted from dagre's centres.
 */
export function layoutGraph(graph: AutomationGraph, ghosts: GhostSlot[]): LayoutResult {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'LR',
    ranksep: 110,
    nodesep: 46,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) {
    g.setNode(node.id, { width: NODE_BOX_WIDTH, height: NODE_BOX_HEIGHT });
  }
  for (const ghost of ghosts) {
    g.setNode(ghost.id, { width: GHOST_BOX_WIDTH, height: GHOST_BOX_HEIGHT });
  }

  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  for (const edge of graph.edges) {
    // Guard against edges left dangling by a bad save.
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }
  for (const ghost of ghosts) {
    if (nodeIds.has(ghost.sourceId)) g.setEdge(ghost.sourceId, ghost.id);
  }

  dagre.layout(g);

  const positions: Record<string, { x: number; y: number }> = {};
  for (const id of g.nodes()) {
    const laid = g.node(id);
    if (!laid) continue;
    positions[id] = {
      x: laid.x - laid.width / 2,
      y: laid.y - laid.height / 2,
    };
  }

  return { positions };
}

/**
 * Positions for everything the canvas draws. Stored positions win when the
 * whole graph has them (manual mode); dagre otherwise. Ghost "+" slots always
 * hang off their anchor node, whichever mode is active.
 */
export function computeCanvasLayout(graph: AutomationGraph, ghosts: GhostSlot[]): LayoutResult {
  if (!hasManualLayout(graph)) return layoutGraph(graph, ghosts);

  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of graph.nodes) {
    positions[node.id] = { x: node.position?.x ?? 0, y: node.position?.y ?? 0 };
  }

  // A ghost sits to the right of its anchor, in its branch's lane — the lane a
  // step added there would take — and steps down past anything already there.
  const taken: Box[] = graph.nodes.map((node) => nodeBox(positions[node.id]));
  for (const ghost of ghosts) {
    const anchor = positions[ghost.sourceId];
    if (!anchor) continue;
    const source = findNode(graph, ghost.sourceId);
    // Dragged by hand: exactly there, whatever is around.
    const dragged = source?.ghostOffsets?.[ghostKey(ghost.branch)];
    if (dragged) {
      positions[ghost.id] = { x: anchor.x + dragged.dx, y: anchor.y + dragged.dy };
      taken.push({ ...positions[ghost.id], w: GHOST_BOX_WIDTH, h: GHOST_BOX_HEIGHT });
      continue;
    }
    const lane = branchLane(source, ghost.branch);
    // The first branch of a step that has several is its top output: when its
    // spot is taken it moves up, so it stays above the others.
    const upward = lane === 0 && getNodeBranches(source).length > 1;
    const spot = clearOf({
      x: anchor.x + NODE_BOX_WIDTH + MANUAL_GHOST_GAP_X,
      y: anchor.y + NODE_CIRCLE_CENTER_Y - GHOST_BOX_HEIGHT / 2 + lane * BRANCH_LANE_Y,
      w: GHOST_BOX_WIDTH,
      h: GHOST_BOX_HEIGHT,
    }, taken, upward ? -1 : 1);
    positions[ghost.id] = spot;
    taken.push({ ...spot, w: GHOST_BOX_WIDTH, h: GHOST_BOX_HEIGHT });
  }

  return { positions };
}

/**
 * Re-runs dagre over the current graph and writes the tidy positions into the
 * nodes — the "Auto-organizar" action. The result is a manual layout (every
 * node positioned), so it survives refreshes once saved.
 */
export function applyAutoLayout(graph: AutomationGraph): AutomationGraph {
  const { positions } = layoutGraph(graph, getGhostSlots(graph));
  // A tidy layout puts every "+" back where it belongs too.
  const tidy = {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (!node.ghostOffsets) return node;
      const { ghostOffsets: _dropped, ...rest } = node;
      return rest;
    }),
  };
  return updateNodePositions(tidy, positions);
}

/** Step numbers shown in the badge — BFS from the entry node. */
export function computeStepNumbers(graph: AutomationGraph, entryNodeId: string | null): Record<string, number> {
  const entry = getEntryNode(graph, entryNodeId);
  const numbers: Record<string, number> = {};
  if (!entry) return numbers;

  const queue: string[] = [entry.id];
  const seen = new Set<string>([entry.id]);
  let counter = 1;

  while (queue.length) {
    const current = queue.shift() as string;
    numbers[current] = counter++;
    const next = graph.edges
      .filter((edge) => edge.source === current)
      .map((edge) => edge.target);
    for (const id of next) {
      if (!seen.has(id)) {
        seen.add(id);
        queue.push(id);
      }
    }
  }

  // Unreachable nodes still need a badge so they don't look broken.
  for (const node of graph.nodes) {
    if (numbers[node.id] === undefined) numbers[node.id] = counter++;
  }

  return numbers;
}

// ── Validation ──────────────────────────────────────────────────────────────

export interface GraphIssue {
  nodeId: string | null;
  message: string;
}

const VARIABLE_PATTERN = /\{\{[^{}]*\}\}/g;
/**
 * Stand-in for a `{{variable}}` in the fallback parse. A bare number is the one
 * literal that is valid both inside a string ("olá 0") and as a whole value
 * ("total": 0), so one substitution covers both ways of templating.
 */
const VARIABLE_STUB = '0';

/**
 * True when a free-text JSON field (webhook headers/body) is usable. Empty text
 * passes — both fields are optional. The text is parsed as-is first; if that
 * fails, `{{variables}}` are stubbed out and it is parsed again, so a body like
 * `{"total": {{valor}}}` — which the engine fills in before sending — is not
 * flagged as broken.
 */
export function isJsonConfigValid(text: string | undefined | null): boolean {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return true;

  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    // Fall through — it may still be valid once variables are substituted.
  }

  try {
    JSON.parse(trimmed.replace(VARIABLE_PATTERN, VARIABLE_STUB));
    return true;
  } catch {
    return false;
  }
}

/**
 * Webhook URLs must be absolute http(s). A URL built from `{{variables}}` is
 * only resolved at run time, so it is accepted as-is.
 */
export function isWebhookUrlValid(url: string | undefined | null): boolean {
  const trimmed = (url ?? '').trim();
  if (!trimmed) return false;
  if (trimmed.includes('{{')) return true;

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Blocking problems that should stop a flow from being activated. */
export function validateGraph(graph: AutomationGraph, entryNodeId: string | null): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const entry = getEntryNode(graph, entryNodeId);

  if (!entry) {
    issues.push({ nodeId: null, message: 'O fluxo não tem gatilho de entrada.' });
  }
  if (graph.nodes.length < 2) {
    issues.push({ nodeId: null, message: 'Adicione pelo menos uma ação depois do gatilho.' });
  }

  for (const node of graph.nodes) {
    switch (node.type) {
      case 'send_whatsapp':
        // The engine sends media-only messages happily; only an empty node fails.
        if (!node.config?.message?.trim() && !node.config?.media?.url && !node.config?.media_url) {
          issues.push({ nodeId: node.id, message: 'Mensagem de WhatsApp por preencher.' });
        }
        // Waiting with no rules never branches — the engine would send the
        // message and walk straight on, silently ignoring the wait.
        if (node.config?.wait_reply && !node.config?.rules?.length) {
          issues.push({ nodeId: node.id, message: 'Defina pelo menos uma opção de resposta.' });
        }
        break;
      case 'send_email':
        if (!node.config?.template_id && !node.config?.subject?.trim()) {
          issues.push({ nodeId: node.id, message: 'Email sem template nem assunto.' });
        }
        break;
      case 'webhook': {
        const url = node.config?.url?.trim();
        if (!url) {
          issues.push({ nodeId: node.id, message: 'Webhook sem URL.' });
        } else if (!isWebhookUrlValid(url)) {
          issues.push({
            nodeId: node.id,
            message: 'URL do webhook inválido — indique um endereço https:// completo.',
          });
        }
        // A malformed body would be sent verbatim and rejected by the endpoint.
        if (!isJsonConfigValid(node.config?.headers)) {
          issues.push({ nodeId: node.id, message: 'Cabeçalhos do webhook não são JSON válido.' });
        }
        if (!isJsonConfigValid(node.config?.body)) {
          issues.push({ nodeId: node.id, message: 'Corpo do webhook não é JSON válido.' });
        }
        break;
      }
      case 'wait_reply':
        if (!node.config?.rules?.length) {
          issues.push({ nodeId: node.id, message: 'Esperar resposta sem regras de palavras-chave.' });
        }
        break;
      default:
        break;
    }
  }

  return issues;
}

// ── Manual wiring ───────────────────────────────────────────────────────────
// The canvas used to be read-only about shape: steps could be moved, never
// rewired. These helpers back the one gesture that fixes that — pulling a line
// out of a step, or out of the "+" standing in for its next step. Released on
// another step it links the two; released on empty canvas it puts a new step
// exactly there.

/**
 * Where a node box goes so its circle sits centred on `point`. A node's stored
 * position is the top-left of its whole box, label included, so dropping one
 * without this offset puts the circle down and to the right of the pointer.
 */
export function centreNodeOn(point: { x: number; y: number }): { x: number; y: number } {
  return { x: point.x - NODE_BOX_WIDTH / 2, y: point.y - NODE_CIRCLE_CENTER_Y };
}

/** True when `toId` is reachable from `fromId` by following edges. */
export function isReachable(graph: AutomationGraph, fromId: string, toId: string): boolean {
  const seen = new Set<string>([fromId]);
  const queue = [fromId];
  while (queue.length) {
    const current = queue.shift() as string;
    for (const edge of graph.edges) {
      if (edge.source !== current || seen.has(edge.target)) continue;
      if (edge.target === toId) return true;
      seen.add(edge.target);
      queue.push(edge.target);
    }
  }
  return false;
}

/**
 * Why this connection cannot be made, in Portuguese, or null when it can.
 * Every rule here is one the engine would otherwise trip over at run time: a
 * cycle burns through `max_steps_per_run`, a second edge on one branch makes the
 * taken path arbitrary, and a trigger with an inbound edge is meaningless.
 */
export function describeConnectionRefusal(
  graph: AutomationGraph,
  sourceId: string,
  targetId: string,
  branch: string | null,
): string | null {
  if (sourceId === targetId) return "Um passo não se pode ligar a si próprio.";

  const source = findNode(graph, sourceId);
  const target = findNode(graph, targetId);
  if (!source || !target) return "Passo não encontrado.";

  if (getNodeDefinition(target.type)?.isTrigger) return "Um gatilho não recebe ligações.";
  if (source.type === "end") return "O passo final não tem saída.";

  const branches = getNodeBranches(source);
  // One line between two steps, whichever branch it would leave from.
  if (graph.edges.some((edge) => edge.source === sourceId && edge.target === targetId)) {
    return branches.length
      ? "Outro ramo deste passo já segue para aí. Cada ramo tem de ir para um passo diferente."
      : "Estes dois passos já estão ligados.";
  }

  if (branches.length) {
    if (!branch) return "Escolhe de que ramo sai esta ligação.";
    if (!branches.some((item) => item.key === branch)) return "Esse ramo já não existe neste passo.";
    // A branch is a decision: exactly one path leaves it, or which one runs
    // would be arbitrary.
    const taken = graph.edges.some((edge) => edge.source === sourceId && edge.branch === branch);
    if (taken) return "Este ramo já está ligado. Apaga a ligação atual primeiro.";
  } else if (branch) {
    // A step with no branches may still fan out — the engine walks every
    // unbranched edge, so several here are several paths side by side.
    return "Este passo não tem ramos.";
  }

  // Following the edges forward from the target must never come back here.
  if (isReachable(graph, targetId, sourceId)) {
    return "Isto criaria um ciclo, e o percurso ficaria preso a rodar.";
  }

  return null;
}

/** Adds the edge. Caller is expected to have cleared `describeConnectionRefusal`. */
export function connectNodes(
  graph: AutomationGraph,
  sourceId: string,
  targetId: string,
  branch: string | null,
): AutomationGraph {
  return {
    ...graph,
    edges: [...graph.edges, { id: createId('e'), source: sourceId, target: targetId, branch }],
  };
}

/** Removes edges by id. Nodes left unreachable stay on the canvas to be rewired. */
export function disconnectEdges(graph: AutomationGraph, edgeIds: string[]): AutomationGraph {
  const drop = new Set(edgeIds);
  return { ...graph, edges: graph.edges.filter((edge) => !drop.has(edge.id)) };
}
