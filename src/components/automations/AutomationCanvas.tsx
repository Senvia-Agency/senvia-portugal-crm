import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, BackgroundVariant, Controls, ReactFlow, ReactFlowProvider,
  useReactFlow, type Connection, type Edge, type Node, type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { AutomationFlowNode, GhostFlowNode, type GhostNodeData } from './AutomationFlowNode';
import { AutomationFlowEdge } from './AutomationFlowEdge';
import {
  computeCanvasLayout, computeStepNumbers, findNode, getGhostSlots, ghostDropToNodePosition,
  validateGraph,
} from '@/lib/automation-graph';
import { getBranchLabel, getNodeStyle } from '@/lib/automation-nodes';
import type { AutomationGraph, AutomationNodeStats } from '@/types/automations';

// Defined once — React Flow warns (and re-renders hard) on new object identities.
const nodeTypes = { automation: AutomationFlowNode, ghost: GhostFlowNode };
const edgeTypes = { automation: AutomationFlowEdge };

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
   * Per-node run counters. Omitted for a flow that has never run, which keeps a
   * brand-new canvas free of zero badges.
   */
  nodeStats?: Record<string, AutomationNodeStats>;
}

function CanvasInner({
  graph, entryNodeId, selectedNodeId, onSelectNode, onAddAfter, onInsertOnEdge, onMoveNodes,
  onAddAfterAt, onConnectNodes, onUnlinkEdges, nodeStats,
}: AutomationCanvasProps) {
  const { fitView, getNodes } = useReactFlow();

  // Live positions while a drag is in flight. React Flow is controlled here, so
  // without feeding these back the circles would not follow the pointer.
  const [dragPositions, setDragPositions] = useState<Record<string, { x: number; y: number }>>({});

  const { nodes, edges } = useMemo(() => {
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
        },
      })),
      ...ghosts.map((ghost) => ({
        id: ghost.id,
        type: 'ghost',
        position: dragPositions[ghost.id] ?? positions[ghost.id] ?? { x: 0, y: 0 },
        // Dragging a "+" is how you choose where the next step goes.
        draggable: true,
        selectable: false,
        deletable: false,
        data: {
          sourceId: ghost.sourceId,
          branch: ghost.branch,
          branchLabel: ghost.branchLabel,
          onAdd: onAddAfter,
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
            onInsert: onInsertOnEdge,
            onUnlink: (edgeId: string) => onUnlinkEdges([edgeId]),
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
        },
      })),
    ];

    return { nodes: flowNodes, edges: flowEdges };
  }, [graph, entryNodeId, selectedNodeId, onAddAfter, onInsertOnEdge, onUnlinkEdges, dragPositions, nodeStats]);

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
  // Letting go of a ghost "+" does the same, then asks what step belongs there,
  // so the new step lands where the pointer stopped instead of wherever the
  // auto-layout would have put it.
  const handleNodeDragStop = useCallback((_: React.MouseEvent, dragged: Node) => {
    const positions: Record<string, { x: number; y: number }> = {};
    for (const node of getNodes()) {
      if (node.type === 'automation') {
        positions[node.id] = { x: node.position.x, y: node.position.y };
      }
    }
    // Both state updates land in the same render, so nothing flickers.
    onMoveNodes(positions);

    if (dragged.type === 'ghost') {
      const ghost = dragged.data as unknown as GhostNodeData;
      onAddAfterAt(ghost.sourceId, ghost.branch, ghostDropToNodePosition(dragged.position));
    }

    setDragPositions({});
  }, [getNodes, onMoveNodes, onAddAfterAt]);

  // A connection drawn by hand. Handed upstream even when it will be refused —
  // a line that silently springs back teaches the user nothing.
  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    onConnectNodes(connection.source, connection.target, connection.sourceHandle ?? null);
  }, [onConnectNodes]);

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
