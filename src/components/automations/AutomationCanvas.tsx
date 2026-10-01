import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, BackgroundVariant, Controls, ReactFlow, ReactFlowProvider,
  useReactFlow, ViewportPortal, type Connection, type Edge, type FinalConnectionState,
  type Node, type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { AutomationFlowNode, GhostFlowNode } from './AutomationFlowNode';
import { AutomationFlowEdge } from './AutomationFlowEdge';
import {
  centreNodeOn, computeCanvasLayout, computeStepNumbers, findNode, getGhostSlots,
  NODE_BOX_HEIGHT, NODE_BOX_WIDTH, validateGraph,
} from '@/lib/automation-graph';
import { getBranchLabel, getNodeStyle } from '@/lib/automation-nodes';
import { ghostTaken, type ExecutionView } from '@/lib/automation-execution';
import type { AutomationGraph, AutomationNodeStats } from '@/types/automations';

// Defined once — React Flow warns (and re-renders hard) on new object identities.
const nodeTypes = { automation: AutomationFlowNode, ghost: GhostFlowNode };
const edgeTypes = { automation: AutomationFlowEdge };

/** Where a step's outbound point sits inside its box (see AutomationFlowNode). */
const OUTPUT_DX = NODE_BOX_WIDTH / 2 + 33;
const OUTPUT_DY = 33;
/** Under this much movement the press on a "+" counts as a click. */
const PULL_THRESHOLD = 4;

interface AutomationCanvasProps {
  graph: AutomationGraph;
  entryNodeId: string | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  /** Append a step on a free branch of `sourceId`. */
  onAddAfter: (sourceId: string, branch: string | null) => void;
  /** Splice a step into an existing edge. */
  onInsertOnEdge: (edgeId: string) => void;
  /** Persist node positions after a drag (marks the flow dirty). */
  onMoveNodes: (positions: Record<string, { x: number; y: number }>) => void;
  /** Append a step on a free branch, landing where the "+" was let go. */
  onAddAfterAt: (sourceId: string, branch: string | null, position: { x: number; y: number }) => void;
  /** Draw a connection by hand. The editor decides whether it is allowed. */
  onConnectNodes: (sourceId: string, targetId: string, branch: string | null) => void;
  /** Cut connections — the button on the line, or the Delete key. */
  onUnlinkEdges: (edgeIds: string[]) => void;
  /**
   * A "+" was dragged to a new spot. Comes with every step's rendered
   * position, so a layout dagre drew becomes a manual one as it does on a drag.
   */
  onMoveGhost: (
    sourceId: string,
    branch: string | null,
    offset: { dx: number; dy: number },
    positions: Record<string, { x: number; y: number }>,
  ) => void;
  /**
   * Per-node run counters. Omitted for a flow that has never run, which keeps a
   * brand-new canvas free of zero badges.
   */
  nodeStats?: Record<string, AutomationNodeStats>;
  /** One execution drawn over the flow, as in n8n: what ran, how it ended, the path taken. */
  execution?: ExecutionView | null;
}

function CanvasInner({
  graph, entryNodeId, selectedNodeId, onSelectNode, onAddAfter, onInsertOnEdge, onMoveNodes,
  onAddAfterAt, onConnectNodes, onUnlinkEdges, nodeStats, execution, onMoveGhost,
}: AutomationCanvasProps) {
  const { fitView, getNodes, screenToFlowPosition } = useReactFlow();

  // Letting go of a dragged "+" must not also count as a click on it (which
  // would open the step picker).
  const lastGhostDragAt = useRef(0);
  const handleGhostAdd = useCallback((sourceId: string, branch: string | null) => {
    if (Date.now() - lastGhostDragAt.current < 400) return;
    onAddAfter(sourceId, branch);
  }, [onAddAfter]);

  // Live positions while a drag is in flight. React Flow is controlled here, so
  // without feeding these back the circles would not follow the pointer.
  const [dragPositions, setDragPositions] = useState<Record<string, { x: number; y: number }>>({});

  // A line being pulled out of the "+" that sits on an existing connection.
  // React Flow draws its own line for handles, but that "+" is drawn over the
  // edge rather than on a node, so this one is ours to render.
  const [pull, setPull] = useState<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(null);

  /** The step whose box contains this point on the board, if any. */
  const stepAt = useCallback((point: { x: number; y: number }) => {
    for (const node of getNodes()) {
      if (node.type !== 'automation') continue;
      const width = node.measured?.width ?? NODE_BOX_WIDTH;
      const height = node.measured?.height ?? NODE_BOX_HEIGHT;
      const insideX = point.x >= node.position.x && point.x <= node.position.x + width;
      const insideY = point.y >= node.position.y && point.y <= node.position.y + height;
      if (insideX && insideY) return node.id;
    }
    return null;
  }, [getNodes]);

  /**
   * The "+" on a connection, pressed. Released without moving it inserts a step
   * between the two it joins, which is what it always did. Dragged, it pulls a
   * new path out of the step the line leaves from — the same gesture as every
   * other "+" on the canvas, which is the whole point of doing this by hand.
   */
  const handleEdgePullStart = useCallback((edgeId: string, event: React.PointerEvent) => {
    const edge = graph.edges.find((item) => item.id === edgeId);
    const source = edge ? getNodes().find((node) => node.id === edge.source) : null;
    if (!edge || !source) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const from = { x: source.position.x + OUTPUT_DX, y: source.position.y + OUTPUT_DY };

    const move = (moveEvent: PointerEvent) => {
      const at = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
      setPull({ from, to: at });
    };

    const up = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPull(null);

      const travelled = Math.hypot(upEvent.clientX - startX, upEvent.clientY - startY);
      if (travelled < PULL_THRESHOLD) {
        onInsertOnEdge(edgeId);
        return;
      }

      const at = screenToFlowPosition({ x: upEvent.clientX, y: upEvent.clientY });
      const landedOn = stepAt(at);
      const branch = edge.branch ?? null;
      if (landedOn) {
        onConnectNodes(edge.source, landedOn, branch);
      } else {
        onAddAfterAt(edge.source, branch, centreNodeOn(at));
      }
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [graph, getNodes, screenToFlowPosition, stepAt, onInsertOnEdge, onConnectNodes, onAddAfterAt]);

  const { nodes, edges, ghostAnchors } = useMemo(() => {
    const ghosts = getGhostSlots(graph);
    const { positions } = computeCanvasLayout(graph, ghosts);
    const steps = computeStepNumbers(graph, entryNodeId);

    // Nodes flagged by validation get a warning badge on the circle.
    const issues = new Set(
      validateGraph(graph, entryNodeId)
        .map((issue) => issue.nodeId)
        .filter(Boolean) as string[],
    );


    const flowNodes: Node[] = [
      ...graph.nodes.map((node) => ({
        id: node.id,
        type: 'automation',
        position: dragPositions[node.id] ?? positions[node.id] ?? { x: 0, y: 0 },
        draggable: true,
        // Steps are removed from the inspector. Keeping them off the Delete key
        // means that key can only ever cut a line.
        deletable: false,
        selected: node.id === selectedNodeId,
        data: {
          graphNode: node,
          step: steps[node.id] ?? 0,
          hasIssue: issues.has(node.id),
          // A node nobody reached still shows a zero — that is the signal.
          stats: nodeStats?.[node.id] ?? { passed: 0, failed: 0, waiting: 0 },
          showStats: !!nodeStats,
          inExecution: !!execution,
          runStatus: execution?.nodes[node.id] ?? null,
        },
      })),
      ...ghosts.map((ghost) => ({
        id: ghost.id,
        type: 'ghost',
        position: dragPositions[ghost.id] ?? positions[ghost.id] ?? { x: 0, y: 0 },
        // An empty branch can be left wherever it reads best.
        draggable: true,
        selectable: false,
        deletable: false,
        data: {
          sourceId: ghost.sourceId,
          branch: ghost.branch,
          branchLabel: ghost.branchLabel,
          onAdd: handleGhostAdd,
        },
      })),
    ];

    const nodeIds = new Set(graph.nodes.map((node) => node.id));

    const flowEdges: Edge[] = [
      ...graph.edges
        .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
        .map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          // A branching step now shows one outbound point per branch, so the
          // line has to name the one it leaves from or it meets the wrong spot.
          sourceHandle: edge.branch ?? undefined,
          type: 'automation',
          deletable: true,
          data: {
            branchLabel: getBranchLabel(findNode(graph, edge.source), edge.branch),
            stroke: getNodeStyle(findNode(graph, edge.source)?.type ?? '').stroke,
            ghost: false,
            onPullStart: handleEdgePullStart,
            onUnlink: (edgeId: string) => onUnlinkEdges([edgeId]),
            inExecution: !!execution,
            taken: !!execution?.edges.has(edge.id),
          },
        })),
      ...ghosts.map((ghost) => ({
        id: `edge_${ghost.id}`,
        source: ghost.sourceId,
        target: ghost.id,
        sourceHandle: ghost.branch ?? undefined,
        type: 'automation',
        selectable: false,
        deletable: false,
        data: {
          branchLabel: ghost.branchLabel,
          stroke: getNodeStyle(findNode(graph, ghost.sourceId)?.type ?? '').stroke,
          ghost: true,
          inExecution: !!execution,
          // The branch a condition took is lit even when it leads to a "+".
          taken: ghostTaken(execution, ghost.sourceId, ghost.branch),
        },
      })),
    ];

    // A line pulled out of a "+" really comes from the step behind it. This
    // says which, so both handlers translate before touching the graph.
    const ghostAnchors = new Map(ghosts.map((ghost) => [ghost.id, ghost]));

    return { nodes: flowNodes, edges: flowEdges, ghostAnchors };
  }, [graph, entryNodeId, selectedNodeId, handleGhostAdd, handleEdgePullStart, onUnlinkEdges, dragPositions, nodeStats, execution]);

  // Re-fit when the shape of the graph changes (not on mere config edits or drags).
  const shapeKey = `${graph.nodes.length}:${graph.edges.length}`;
  const lastShape = useRef<string>('');
  useEffect(() => {
    if (lastShape.current === shapeKey) return;
    lastShape.current = shapeKey;
    const timer = setTimeout(() => fitView({ padding: 0.2, duration: 300, maxZoom: 1 }), 60);
    return () => clearTimeout(timer);
  }, [shapeKey, fitView]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === 'ghost') return;
      onSelectNode(node.id);
    },
    [onSelectNode],
  );

  // Track drag movement only; selection is driven by our own click handler.
  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    const moved: Record<string, { x: number; y: number }> = {};
    for (const change of changes) {
      if (change.type === 'position' && change.position) moved[change.id] = change.position;
    }
    if (Object.keys(moved).length) {
      setDragPositions((prev) => ({ ...prev, ...moved }));
    }
  }, []);

  // On drop, persist EVERY real node's rendered position — the first drag
  // converts a dagre layout into a manual one without anything jumping.
  const handleNodeDragStop = useCallback((_event: MouseEvent, dragged: Node) => {
    const positions: Record<string, { x: number; y: number }> = {};
    for (const node of getNodes()) {
      if (node.type === 'automation') {
        positions[node.id] = { x: node.position.x, y: node.position.y };
      }
    }
    const ghost = dragged.type === 'ghost' ? ghostAnchors.get(dragged.id) : undefined;
    const anchor = ghost ? positions[ghost.sourceId] : undefined;
    if (ghost && anchor) {
      lastGhostDragAt.current = Date.now();
      onMoveGhost(ghost.sourceId, ghost.branch, {
        dx: dragged.position.x - anchor.x,
        dy: dragged.position.y - anchor.y,
      }, positions);
    } else {
      // Both state updates land in the same render, so nothing flickers.
      onMoveNodes(positions);
    }
    setDragPositions({});
  }, [getNodes, onMoveNodes, onMoveGhost, ghostAnchors]);

  /**
   * A line can be pulled from a step's own point or from a "+", and a "+" is
   * only a placeholder for the step behind it. Resolves either to the real
   * step and branch, or null when the line started somewhere meaningless.
   */
  const resolveSource = useCallback((nodeId: string, handleId: string | null) => {
    const ghost = ghostAnchors.get(nodeId);
    if (ghost) return { sourceId: ghost.sourceId, branch: ghost.branch };
    return { sourceId: nodeId, branch: handleId };
  }, [ghostAnchors]);

  // A connection drawn by hand. Handed upstream even when it will be refused —
  // a line that silently springs back teaches the user nothing.
  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    // A "+" is scenery: nothing connects TO one.
    if (ghostAnchors.has(connection.target)) return;
    const { sourceId, branch } = resolveSource(connection.source, connection.sourceHandle ?? null);
    onConnectNodes(sourceId, connection.target, branch);
  }, [ghostAnchors, resolveSource, onConnectNodes]);

  // The same line let go on empty canvas: there is nothing to connect to, so
  // the step is created right there. This is how a second, parallel path
  // starts, and it is why pressing a "+" and pressing a step's point behave
  // identically — a press with no movement simply lands back where it began.
  const handleConnectEnd = useCallback((event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (!state.fromNode || !state.fromHandle) return;
    if (state.fromHandle.type !== 'source') return;
    // Landing on a real step is a connection, already handled above. Landing on
    // a "+" is landing on nothing.
    if (state.toNode && !ghostAnchors.has(state.toNode.id)) return;
    if (state.toHandle && !ghostAnchors.has(state.toHandle.nodeId)) return;
    // From the pointer, not from `state.to`: that one is already in canvas
    // space, and converting it a second time dropped the step back on top of
    // the one it came from.
    const pointer = 'changedTouches' in event ? event.changedTouches[0] : event;
    const at = screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY });
    const { sourceId, branch } = resolveSource(state.fromNode.id, state.fromHandle.id ?? null);
    onAddAfterAt(sourceId, branch, centreNodeOn(at));
  }, [ghostAnchors, resolveSource, screenToFlowPosition, onAddAfterAt]);

  // Ghost lines are scenery and carry no edge in the graph.
  const handleEdgesDelete = useCallback((deleted: Edge[]) => {
    const ids = deleted.map((edge) => edge.id).filter((id) => !id.startsWith('edge_ghost'));
    if (ids.length) onUnlinkEdges(ids);
  }, [onUnlinkEdges]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={handleNodeClick}
      onPaneClick={() => onSelectNode(null)}
      onNodesChange={handleNodesChange}
      onNodeDragStop={handleNodeDragStop}
      onConnect={handleConnect}
      onConnectEnd={handleConnectEnd}
      onEdgesDelete={handleEdgesDelete}
      // Steps can be moved and rewired by hand; "Auto-organizar" restores a tidy
      // layout. Delete cuts the selected line only, since steps are not
      // deletable here — the key can never wipe one by accident.
      nodesDraggable
      nodesConnectable
      elementsSelectable
      deleteKeyCode={['Backspace', 'Delete']}
      // Under this many pixels it counts as a click, so tapping a "+" still
      // opens the picker instead of starting a one-pixel drag.
      nodeDragThreshold={4}
      connectionLineStyle={{ stroke: 'hsl(var(--primary))', strokeWidth: 3, strokeLinecap: 'round' }}
      panOnScroll
      selectionOnDrag={false}
      minZoom={0.2}
      maxZoom={1.5}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
      proOptions={{ hideAttribution: false }}
      className="bg-background"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} className="!bg-background" color="hsl(var(--muted-foreground) / 0.25)" />
      <Controls showInteractive={false} position="bottom-right" />

      {/* The line trailing the "+" that was pulled off a connection. Drawn in
          board coordinates, so it stays put while the canvas is panned. */}
      {pull && (
        <ViewportPortal>
          <svg
            className="pointer-events-none absolute left-0 top-0 overflow-visible"
            style={{ width: 1, height: 1 }}
          >
            <path
              d={`M ${pull.from.x} ${pull.from.y} C ${pull.from.x + 70} ${pull.from.y}, ${pull.to.x - 70} ${pull.to.y}, ${pull.to.x} ${pull.to.y}`}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth={3}
              strokeLinecap="round"
            />
            <circle cx={pull.to.x} cy={pull.to.y} r={4} fill="hsl(var(--primary))" />
          </svg>
        </ViewportPortal>
      )}
    </ReactFlow>
  );
}

export function AutomationCanvas(props: AutomationCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
