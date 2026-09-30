import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowLeft, FlaskConical, LayoutGrid, Loader2, Pause, Play, Save,
  SlidersHorizontal, Workflow,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

import { AutomationCanvas } from '@/components/automations/AutomationCanvas';
import { NodeInspector } from '@/components/automations/NodeInspector';
import { NodePickerDialog } from '@/components/automations/NodePickerDialog';
import { FlowActivity } from '@/components/automations/FlowActivity';
import { FlowStatusPill } from '@/components/automations/FlowStatusPill';
import { FlowSettings } from '@/components/automations/FlowSettings';
import { TestFlowDialog } from '@/components/automations/TestFlowDialog';

import {
  appendNode, applyAutoLayout, changeTriggerType, connectNodes, describeConnectionRefusal,
  disconnectEdges, findNode, insertNodeOnEdge, pruneOrphanBranches, removeNode,
  updateNodeConfig, updateNodePositions, validateGraph,
} from '@/lib/automation-graph';
import {
  useAutomationFlow, useAutomationFlowNodeStats, useSetAutomationFlowStatus,
  useUpdateAutomationFlow,
} from '@/hooks/useAutomationFlows';
import type {
  AutomationGraph, AutomationNodeConfig, AutomationNodeType, AutomationTriggerType,
} from '@/types/automations';

type PickerTarget =
  // `position` is set when the "+" was dragged: the step lands exactly there
  // instead of beside its source.
  | { kind: 'append'; sourceId: string; branch: string | null; position?: { x: number; y: number } }
  | { kind: 'insert'; edgeId: string }
  | null;

export default function AutomationEditor() {
  const { id } = useParams<{ id: string }>();
  const { data: flow, isLoading } = useAutomationFlow(id ?? null);
  const updateFlow = useUpdateAutomationFlow();
  const setStatus = useSetAutomationFlowStatus();

  const [graph, setGraph] = useState<AutomationGraph>({ nodes: [], edges: [] });
  const [name, setName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);
  const [tab, setTab] = useState<'canvas' | 'activity' | 'settings'>('canvas');
  const [testOpen, setTestOpen] = useState(false);

  // Only polled while the canvas is on screen — the badges live on the circles.
  const { data: nodeStats } = useAutomationFlowNodeStats(tab === 'canvas' ? id ?? null : null);
  // A flow that never ran gets no badges at all, so a new canvas stays clean.
  const hasRunStats = !!nodeStats && Object.keys(nodeStats).length > 0;

  // Hydrate local editing state once per flow. The ref guard means a background
  // refetch can never clobber edits the user has not saved yet.
  const hydratedFlowId = useRef<string | null>(null);
  useEffect(() => {
    if (!flow || hydratedFlowId.current === flow.id) return;
    hydratedFlowId.current = flow.id;
    setGraph(flow.graph);
    setName(flow.name);
    setDirty(false);
    setSelectedNodeId(null);
  }, [flow]);

  const issues = useMemo(
    () => validateGraph(graph, flow?.entry_node_id ?? null),
    [graph, flow?.entry_node_id],
  );

  const selectedNode = findNode(graph, selectedNodeId);

  const mutateGraph = useCallback((next: AutomationGraph) => {
    setGraph(next);
    setDirty(true);
  }, []);

  const handleAddAfter = useCallback((sourceId: string, branch: string | null) => {
    setPickerTarget({ kind: 'append', sourceId, branch });
  }, []);

  // The "+" was dragged somewhere. Same picker, but the drop point travels with
  // it so the step can be placed there once its type is known.
  const handleAddAfterAt = useCallback(
    (sourceId: string, branch: string | null, position: { x: number; y: number }) => {
      setPickerTarget({ kind: 'append', sourceId, branch, position });
    },
    [],
  );

  // A connection drawn on the canvas. Refusals are explained rather than
  // swallowed — the line springing back with no reason is the worst outcome.
  const handleConnectNodes = useCallback(
    (sourceId: string, targetId: string, branch: string | null) => {
      setGraph((current) => {
        const refusal = describeConnectionRefusal(current, sourceId, targetId, branch);
        if (refusal) {
          toast.error('Ligação não permitida', { description: refusal });
          return current;
        }
        setDirty(true);
        return connectNodes(current, sourceId, targetId, branch);
      });
    },
    [],
  );

  const handleUnlinkEdges = useCallback((edgeIds: string[]) => {
    setGraph((current) => disconnectEdges(current, edgeIds));
    setDirty(true);
  }, []);

  const handleInsertOnEdge = useCallback((edgeId: string) => {
    setPickerTarget({ kind: 'insert', edgeId });
  }, []);

  // Drag-stop on the canvas: persist the positions and mark the flow dirty so
  // "Guardar" stores the hand-made layout.
  const handleMoveNodes = useCallback((positions: Record<string, { x: number; y: number }>) => {
    setGraph((current) => updateNodePositions(current, positions));
    setDirty(true);
  }, []);

  // Re-runs dagre and writes the tidy positions into the graph.
  const handleAutoLayout = useCallback(() => {
    setGraph((current) => applyAutoLayout(current));
    setDirty(true);
  }, []);

  const handlePickNodeType = (type: AutomationNodeType) => {
    if (!pickerTarget) return;

    const built = pickerTarget.kind === 'append'
      ? appendNode(graph, pickerTarget.sourceId, pickerTarget.branch, type)
      : insertNodeOnEdge(graph, pickerTarget.edgeId, type);

    // Dropped "+": override the computed spot with where it was let go.
    const dropped = pickerTarget.kind === 'append' ? pickerTarget.position : undefined;
    const result = dropped && built.node
      ? { ...built, graph: updateNodePositions(built.graph, { [built.node.id]: dropped }) }
      : built;

    mutateGraph(result.graph);
    // Open the new node's config straight away — it always needs filling in.
    if (result.node) setSelectedNodeId(result.node.id);
    setPickerTarget(null);
  };

  const handleConfigChange = (config: AutomationNodeConfig) => {
    if (!selectedNodeId) return;
    // Editing wait_reply rules can orphan branch edges — prune them in the same pass.
    mutateGraph(pruneOrphanBranches(updateNodeConfig(graph, selectedNodeId, config)));
  };

  // Swaps the entry node's type (and resets its config — the old trigger's
  // fields don't apply to a different one). trigger_type is derived from the
  // graph at save time, so this alone is enough to make the switch stick.
  const handleChangeTrigger = (type: AutomationTriggerType) => {
    if (!flow) return;
    mutateGraph(changeTriggerType(graph, flow.entry_node_id, type));
  };

  const handleDeleteNode = () => {
    if (!selectedNodeId) return;
    mutateGraph(removeNode(graph, selectedNodeId));
    setSelectedNodeId(null);
  };

  const handleSave = async () => {
    if (!flow) return;

    // trigger_type is the flow-level column the engine matches on — it must
    // track whatever the entry node's type CURRENTLY is, not what the flow was
    // created with, or switching the trigger in the inspector would change the
    // canvas without the engine ever finding out.
    const entryNode = findNode(graph, flow.entry_node_id);
    const triggerType = (entryNode?.type as AutomationTriggerType | undefined) ?? flow.trigger_type;

    // trigger_config is the OTHER column the engine reads (keyword matching for
    // whatsapp_keyword, in handleKeywordStart) — separate from the entry node's
    // own `config`, which only drives what the inspector shows. Editing
    // keywords in the inspector silently did nothing at the engine level before
    // this, because nothing ever copied node.config into this column.
    const triggerConfig = triggerType === 'whatsapp_keyword'
      ? { keywords: entryNode?.config?.keywords ?? [] }
      : {};

    await updateFlow.mutateAsync({
      id: flow.id,
      name: name.trim() || flow.name,
      graph,
      entry_node_id: flow.entry_node_id,
      trigger_type: triggerType,
      trigger_config: triggerConfig,
    });
    setDirty(false);
    toast.success('Automação guardada');
  };

  /**
   * The engine reads the stored row, so a test of unsaved edits would be a lie —
   * save first, then ask for the contact details.
   */
  const handleOpenTest = async () => {
    if (!flow) return;
    if (dirty) await handleSave();
    setTestOpen(true);
  };

  const handleToggleStatus = async () => {
    if (!flow) return;
    const nextStatus = flow.status === 'active' ? 'paused' : 'active';

    if (nextStatus === 'active' && issues.length) {
      toast.error('Não é possível ativar', { description: issues[0].message });
      return;
    }
    // Never activate a graph that differs from what is stored.
    if (dirty) await handleSave();
    setStatus.mutate({ id: flow.id, status: nextStatus, version: flow.version });
  };

  if (isLoading) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-[60dvh] w-full rounded-2xl" />
      </div>
    );
  }

  if (!flow) {
    return (
      <div className="p-4 md:p-6">
        <EmptyState
          icon={Workflow}
          title="Automação não encontrada"
          description="O fluxo que procura foi eliminado ou não pertence a esta organização."
        >
          <Button asChild variant="outline">
            <Link to="/automacoes">Voltar às automações</Link>
          </Button>
        </EmptyState>
      </div>
    );
  }

  const isActive = flow.status === 'active';
  const isBusy = updateFlow.isPending || setStatus.isPending;

  return (
    <div className="flex h-[calc(100dvh-9rem)] min-h-[520px] flex-col overflow-hidden md:h-dvh">
      {/* Toolbar */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2.5 md:px-4">
        <Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0">
          <Link to="/automacoes" title="Voltar">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>

        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setDirty(true);
          }}
          className="h-8 w-40 border-transparent bg-transparent px-2 text-sm font-semibold shadow-none hover:border-border focus-visible:border-border sm:w-64"
          placeholder="Nome da automação"
        />

        <FlowStatusPill status={flow.status} />

        {dirty && (
          <span className="text-xs font-medium text-muted-foreground">Alterações por guardar</span>
        )}

        {issues.length > 0 && (
          <span
            className="inline-flex items-center gap-1 text-xs font-medium text-warning"
            title={issues.map((issue) => issue.message).join('\n')}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {issues.length} {issues.length === 1 ? 'aviso' : 'avisos'}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {tab === 'canvas' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAutoLayout}
              title="Reorganizar os passos automaticamente"
            >
              <LayoutGrid className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Auto-organizar</span>
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenTest}
            disabled={isBusy}
            title="Correr o fluxo com os seus contactos"
          >
            <FlaskConical className="h-3.5 w-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Testar</span>
          </Button>

          <Button variant="outline" size="sm" onClick={handleSave} disabled={!dirty || isBusy}>
            {updateFlow.isPending
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              : <Save className="mr-1.5 h-3.5 w-3.5" />}
            Guardar
          </Button>

          <Button
            size="sm"
            variant={isActive ? 'outline' : 'default'}
            onClick={handleToggleStatus}
            disabled={isBusy}
            className={cn(isActive && 'text-warning')}
          >
            {isActive ? (
              <><Pause className="mr-1.5 h-3.5 w-3.5" /> Pausar</>
            ) : (
              <><Play className="mr-1.5 h-3.5 w-3.5" /> Ativar</>
            )}
          </Button>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex shrink-0 gap-1 border-b border-border bg-card px-3 md:px-4">
        <TabButton active={tab === 'canvas'} onClick={() => setTab('canvas')} icon={Workflow}>
          Fluxo
        </TabButton>
        <TabButton active={tab === 'activity'} onClick={() => setTab('activity')} icon={Activity}>
          Atividade
        </TabButton>
        <TabButton active={tab === 'settings'} onClick={() => setTab('settings')} icon={SlidersHorizontal}>
          Definições
        </TabButton>
      </div>

      {/* Body */}
      <div className="relative min-h-0 flex-1">
        {tab === 'canvas' ? (
          <>
            <AutomationCanvas
              graph={graph}
              entryNodeId={flow.entry_node_id}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              onAddAfter={handleAddAfter}
              onInsertOnEdge={handleInsertOnEdge}
              onMoveNodes={handleMoveNodes}
              onAddAfterAt={handleAddAfterAt}
              onConnectNodes={handleConnectNodes}
              onUnlinkEdges={handleUnlinkEdges}
              nodeStats={hasRunStats ? nodeStats : undefined}
            />

            {selectedNode && (
              <NodeInspector
                // Keyed so per-node form state (tag drafts, custom-field mode)
                // never leaks between different nodes.
                key={selectedNode.id}
                node={selectedNode}
                isEntry={selectedNode.id === flow.entry_node_id}
                onChange={handleConfigChange}
                onChangeTrigger={handleChangeTrigger}
                onDelete={handleDeleteNode}
                onClose={() => setSelectedNodeId(null)}
              />
            )}
          </>
        ) : tab === 'activity' ? (
          <div className="h-full overflow-y-auto">
            <FlowActivity flowId={flow.id} graph={graph} />
          </div>
        ) : (
          <div className="h-full overflow-y-auto">
            <FlowSettings
              flow={flow}
              isSaving={isBusy}
              onSave={(patch) => updateFlow.mutate({ id: flow.id, ...patch })}
            />
          </div>
        )}
      </div>

      <NodePickerDialog
        open={!!pickerTarget}
        onOpenChange={(open) => !open && setPickerTarget(null)}
        onSelect={handlePickNodeType}
      />

      <TestFlowDialog
        open={testOpen}
        onOpenChange={setTestOpen}
        flowId={flow.id}
        // Land straight on the run the user just started.
        onStarted={() => setTab('activity')}
      />
    </div>
  );
}

function TabButton({
  active, onClick, icon: Icon, children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Workflow;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}
