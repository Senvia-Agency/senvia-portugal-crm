import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowLeft, Check, FlaskConical, LayoutGrid, Loader2, Pause, Play, Save,
  SlidersHorizontal, Workflow,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

import { AutomationCanvas } from '@/components/automations/AutomationCanvas';
import { NodeDetailsView } from '@/components/automations/NodeDetailsView';
import { NodesPanel } from '@/components/automations/NodesPanel';
import { FlowActivity } from '@/components/automations/FlowActivity';
import { FlowStatusPill } from '@/components/automations/FlowStatusPill';
import { FlowSettings } from '@/components/automations/FlowSettings';
import { TestFlowDialog } from '@/components/automations/TestFlowDialog';
import { ExecutionBar } from '@/components/automations/ExecutionBar';
import { ConfiguredWorkflowManualRun } from '@/components/automations/ConfiguredWorkflowManualRun';
import { ConfiguredWorkflowActivation } from '@/components/automations/ConfiguredWorkflowActivation';
import { buildExecutionView } from '@/lib/automation-execution';

import {
  appendNode, applyAutoLayout, changeTriggerType, connectNodes, describeConnectionRefusal,
  disconnectEdges, findNode, insertNodeOnEdge, pruneOrphanBranches, removeNode,
  setGhostOffset, updateNodeConfig, updateNodePositions, validateGraph,
} from '@/lib/automation-graph';
import { MESSAGE_BUFFER_DEFAULT_SECONDS } from '@/lib/automation-nodes';
import {
  CONFIGURED_WORKFLOW_ACTION_TYPES,
  CONFIGURED_WORKFLOW_CANVAS_TYPES,
} from '@/components/automations/workflow-editor-model';
import {
  useAutomationFlow, useAutomationFlowNodeStats, useAutomationRuns, useAutomationRunSteps,
  useSetAutomationFlowStatus,
  useUpdateAutomationFlow,
} from '@/hooks/useAutomationFlows';
import { useAutomationFolders } from '@/hooks/useAutomationFolders';
import type {
  AutomationGraph, AutomationNodeConfig, AutomationNodeType, AutomationReentryPolicy,
  AutomationTriggerType,
} from '@/types/automations';
import {
  parseAutomationWorkflowDefinition,
  parseAutomationWorkflowDraft,
  validateWorkflowStageNodeReferences,
} from '../../supabase/functions/_shared/automation-workflow-contract.ts';

const CONFIGURED_ACTION_TYPES = new Set<string>(CONFIGURED_WORKFLOW_ACTION_TYPES);
const CONFIGURED_CANVAS_TYPES = new Set<string>(CONFIGURED_WORKFLOW_CANVAS_TYPES);

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
  const { data: folders = [] } = useAutomationFolders();

  const [graph, setGraph] = useState<AutomationGraph>({ nodes: [], edges: [] });
  const [name, setName] = useState('');
  // Edited from two places — the message triggers' «Só uma vez por número» and
  // Definições — so it lives here, saved with the rest of the flow.
  const [reentry, setReentry] = useState<AutomationReentryPolicy>('once');
  const [dirty, setDirty] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);
  const [tab, setTab] = useState<'canvas' | 'activity' | 'settings'>('canvas');
  const [testOpen, setTestOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Only polled while the canvas is on screen — the badges live on the circles.
  const { data: nodeStats } = useAutomationFlowNodeStats(tab === 'canvas' ? id ?? null : null);
  // A flow that never ran gets no badges at all, so a new canvas stays clean.
  const hasRunStats = !!nodeStats && Object.keys(nodeStats).length > 0;

  // The execution drawn on the canvas, as in n8n. null follows the newest run,
  // so a run that starts while the flow is open lights the steps up as it goes.
  const [execRunId, setExecRunId] = useState<string | null>(null);
  const [showExecution, setShowExecution] = useState(true);
  const { data: recentRuns = [] } = useAutomationRuns(tab === 'canvas' ? id ?? null : null, 20, 4000);
  const viewedRun = (execRunId && recentRuns.find((run) => run.id === execRunId)) || recentRuns[0] || null;
  const viewedRunLive = !!viewedRun && ['running', 'waiting', 'awaiting_reply'].includes(viewedRun.status);
  const { data: viewedSteps } = useAutomationRunSteps(
    showExecution && tab === 'canvas' ? viewedRun?.id ?? null : null,
    viewedRunLive || !execRunId,
  );

  // Hydrate local editing state once per flow. The ref guard means a background
  // refetch can never clobber edits the user has not saved yet.
  const hydratedFlowId = useRef<string | null>(null);
  useEffect(() => {
    if (!flow || hydratedFlowId.current === flow.id) return;
    hydratedFlowId.current = flow.id;
    setGraph(flow.graph);
    setName(flow.name);
    setReentry(flow.reentry_policy ?? 'once');
    setDirty(false);
    // A flow just created lands here with ?novo=1: the trigger opens at once,
    // so choosing it is the first thing that happens — n8n's "first step".
    if (searchParams.get('novo')) {
      setSelectedNodeId(flow.entry_node_id);
      const next = new URLSearchParams(searchParams);
      next.delete('novo');
      setSearchParams(next, { replace: true });
    } else {
      setSelectedNodeId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow]);

  const issues = useMemo(() => {
    const graphIssues = validateGraph(graph, flow?.entry_node_id ?? null);
    const entry = findNode(graph, flow?.entry_node_id ?? null);
    if (entry?.type !== 'configured_workflow') return graphIssues;
    const parsed = parseAutomationWorkflowDefinition(entry.config.workflow);
    if (parsed.ok === false) {
      return [
        ...graphIssues,
        ...parsed.issues.map((issue) => ({ nodeId: entry.id, message: issue.message })),
      ];
    }
    const referenceIssues = validateWorkflowStageNodeReferences(
      parsed.value,
      new Set(graph.nodes.map((node) => node.id)),
    ).map((issue) => ({ nodeId: entry.id, message: issue.message }));
    const supportedNodeIds = new Set(
      graph.nodes.filter((node) => CONFIGURED_ACTION_TYPES.has(node.type)).map((node) => node.id),
    );
    const actionIssues = parsed.value.stages
      .filter((stage) => !supportedNodeIds.has(stage.nodeId))
      .map(() => ({ nodeId: entry.id, message: 'Uma etapa aponta para uma ação incompatível.' }));
    const stageNodeIds = new Set(parsed.value.stages.map((stage) => stage.nodeId));
    const unsupportedNodeIssues = graph.nodes
      .filter((node) => node.id !== entry.id && !CONFIGURED_CANVAS_TYPES.has(node.type))
      .map((node) => ({ nodeId: node.id, message: 'Este passo ainda não é suportado no motor de fluxos configuráveis.' }));
    const unreferencedActionIssues = graph.nodes
      .filter((node) => node.id !== entry.id && CONFIGURED_ACTION_TYPES.has(node.type) && !stageNodeIds.has(node.id))
      .map((node) => ({ nodeId: node.id, message: 'Adicione esta ação à lista de etapas antes de ativar.' }));
    const interactiveWaitIssues = graph.nodes
      .filter((node) => node.type === 'send_whatsapp' && node.config?.wait_reply === true)
      .map((node) => ({ nodeId: node.id, message: '“Esperar resposta” no WhatsApp ainda não é suportado neste modo.' }));
    return [
      ...graphIssues,
      ...referenceIssues,
      ...actionIssues,
      ...unsupportedNodeIssues,
      ...unreferencedActionIssues,
      ...interactiveWaitIssues,
    ];
  }, [graph, flow?.entry_node_id]);

  const selectedNode = findNode(graph, selectedNodeId);
  const entryNode = findNode(graph, flow?.entry_node_id ?? null);
  const configuredDraft = entryNode?.type === 'configured_workflow'
    ? parseAutomationWorkflowDraft(entryNode.config.workflow)
    : null;

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
      // Pulled from a branch that already has a line. A branch carries exactly
      // one path, so there is no room for a second step on it.
      if (branch && graph.edges.some((edge) => edge.source === sourceId && edge.branch === branch)) {
        toast.error('Ramo já ligado', {
          description: 'Apaga a ligação atual antes de pôr outro passo neste ramo.',
        });
        return;
      }
      setPickerTarget({ kind: 'append', sourceId, branch, position });
    },
    [graph],
  );

  // A connection drawn on the canvas. Refusals are explained rather than
  // swallowed — the line springing back with no reason is the worst outcome.
  const handleConnectNodes = useCallback(
    (sourceId: string, targetId: string, branch: string | null) => {
      // Judged on the graph as rendered. A dropped "+" arrives right after a
      // position update, and only the edges decide whether this is allowed.
      const refusal = describeConnectionRefusal(graph, sourceId, targetId, branch);
      if (refusal) {
        toast.error('Ligação não permitida', { description: refusal });
        return;
      }
      // Functional, so the edge stacks on the positions written by the same
      // gesture rather than overwriting them.
      setGraph((current) => connectNodes(current, sourceId, targetId, branch));
      setDirty(true);
    },
    [graph],
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

    const entry = findNode(graph, flow?.entry_node_id ?? null);
    if (entry?.type === 'configured_workflow' && !CONFIGURED_CANVAS_TYPES.has(type)) {
      toast.error('Passo incompatível', {
        description: 'Neste modo, use ações, condições, Esperar ou Fim. “Esperar resposta” interativo ainda não é suportado.',
      });
      return;
    }
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

    // trigger_config is the OTHER column the engine reads (keywords for
    // whatsapp_keyword, the caixa for message_received — handleMessageStart) —
    // separate from the entry node's own `config`, which only drives what the
    // inspector shows. Editing keywords in the inspector silently did nothing at
    // the engine level before this, because nothing ever copied node.config
    // into this column.
    const triggerConfig = triggerType === 'whatsapp_keyword'
      ? { keywords: entryNode?.config?.keywords ?? [] }
      : triggerType === 'message_received'
        ? {
          channel_id: entryNode?.config?.channel_id ?? null,
          buffer_seconds: entryNode?.config?.buffer_seconds ?? MESSAGE_BUFFER_DEFAULT_SECONDS,
        }
        : triggerType === 'configured_workflow'
          ? { workflow: entryNode?.config?.workflow }
          : {};

    await updateFlow.mutateAsync({
      id: flow.id,
      name: name.trim() || flow.name,
      graph,
      entry_node_id: flow.entry_node_id,
      trigger_type: triggerType,
      trigger_config: triggerConfig,
      reentry_policy: reentry,
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
    const entry = findNode(graph, flow.entry_node_id);
    if (entry?.type === 'configured_workflow') {
      toast.error('Prévia ainda indisponível', {
        description: issues[0]?.message ?? 'A prévia segura no servidor tem de estar integrada antes de executar este rascunho.',
      });
      return;
    }
    if (dirty) await handleSave();
    setTestOpen(true);
  };

  const handleToggleStatus = async () => {
    if (!flow) return;
    const nextStatus = flow.status === 'active' ? 'paused' : 'active';
    const entry = findNode(graph, flow.entry_node_id);

    if (nextStatus === 'active' && entry?.type === 'configured_workflow') {
      toast.error('Ativação ainda indisponível', {
        description: 'A verificação administrativa e a prévia no servidor têm de estar integradas antes de ativar este fluxo.',
      });
      return;
    }

    if (nextStatus === 'active' && issues.length) {
      toast.error('Não é possível ativar', { description: issues[0].message });
      return;
    }
    // Never activate a graph that differs from what is stored.
    if (dirty) await handleSave();
    setStatus.mutate({ id: flow.id, status: nextStatus, version: flow.version });
  };

  // Ctrl+S / Cmd+S saves, as in n8n. Through a ref so the listener, added
  // once, always calls the current handleSave.
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (dirtyRef.current) void saveRef.current();
      }
    };
    // Closing or reloading the tab with edits that real runs would never see.
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  const executionView = useMemo(
    () => (showExecution && viewedRun && viewedSteps ? buildExecutionView(graph, viewedRun, viewedSteps) : null),
    [showExecution, viewedRun, viewedSteps, graph],
  );

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
          <span className="flex items-center gap-1 text-xs font-medium text-warning">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" />
            Alterações por guardar
          </span>
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

          {entryNode?.type !== 'configured_workflow' && (
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
          )}

          {isActive
            && configuredDraft?.ok === true
            && configuredDraft.value.trigger.kind === 'authenticated_manual' && (
            <ConfiguredWorkflowManualRun
              flowId={flow.id}
              disabled={dirty || isBusy}
              onReviewExecutions={() => setTab('activity')}
            />
          )}

          {/* As in n8n: "Guardado" when the canvas is what runs, a highlighted
              "Guardar" the moment it is not. */}
          <Button
            variant={dirty ? 'default' : 'ghost'}
            size="sm"
            onClick={handleSave}
            disabled={!dirty || isBusy}
            title={dirty ? 'Guardar (Ctrl+S)' : 'Tudo guardado'}
            className={cn(!dirty && 'text-muted-foreground disabled:opacity-100')}
          >
            {updateFlow.isPending
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              : dirty
                ? <Save className="mr-1.5 h-3.5 w-3.5" />
                : <Check className="mr-1.5 h-3.5 w-3.5" />}
            {dirty ? 'Guardar' : 'Guardado'}
          </Button>

          {!isActive && entryNode?.type === 'configured_workflow' ? (
            <ConfiguredWorkflowActivation
              flow={flow}
              disabled={dirty || isBusy || issues.length > 0}
            />
          ) : (
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
          )}
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
              execution={executionView}
              onMoveGhost={(sourceId, branch, offset, positions) => {
                mutateGraph(setGhostOffset(updateNodePositions(graph, positions), sourceId, branch, offset));
              }}
            />

            <ExecutionBar
              runs={recentRuns}
              selectedRunId={execRunId}
              onSelect={(runId) => { setExecRunId(runId); setShowExecution(true); }}
              visible={showExecution}
              onToggle={() => setShowExecution((v) => !v)}
              dirty={dirty}
            />

            {/* The step catalogue slides in over the canvas, which stays visible. */}
            {pickerTarget && (
              <NodesPanel
                onClose={() => setPickerTarget(null)}
                onSelect={handlePickNodeType}
                allowedTypes={findNode(graph, flow.entry_node_id)?.type === 'configured_workflow'
                  ? CONFIGURED_WORKFLOW_CANVAS_TYPES
                  : undefined}
              />
            )}

            <NodeDetailsView
              // Keyed so per-node form state (tag drafts, custom-field mode)
              // never leaks between different nodes.
              key={selectedNode?.id ?? 'none'}
              node={selectedNode ?? null}
              isEntry={!!selectedNode && selectedNode.id === flow.entry_node_id}
              flowId={flow.id}
              graph={graph}
              triggerType={findNode(graph, flow.entry_node_id)?.type ?? flow.trigger_type}
              stats={selectedNode ? nodeStats?.[selectedNode.id] : undefined}
              // The execution on the canvas: its data is what the details show.
              runId={executionView?.runId ?? null}
              onChange={handleConfigChange}
              onChangeTrigger={handleChangeTrigger}
              reentryPolicy={reentry}
              onReentryChange={(policy) => { setReentry(policy); setDirty(true); }}
              onDelete={handleDeleteNode}
              onClose={() => setSelectedNodeId(null)}
            />
          </>
        ) : tab === 'activity' ? (
          <div className="h-full overflow-y-auto">
            <FlowActivity flowId={flow.id} graph={graph} />
          </div>
        ) : (
          <div className="h-full overflow-y-auto">
            <FlowSettings
              // The switch on the trigger may hold a choice not saved yet.
              flow={{ ...flow, reentry_policy: reentry }}
              folders={folders}
              isSaving={isBusy}
              onFolderChange={(folderId) => updateFlow.mutate({ id: flow.id, folder_id: folderId })}
              onSave={(patch) => {
                setReentry(patch.reentry_policy);
                updateFlow.mutate({ id: flow.id, ...patch });
              }}
            />
          </div>
        )}
      </div>

      <TestFlowDialog
        open={testOpen}
        onOpenChange={setTestOpen}
        flowId={flow.id}
        graph={graph}
        entryNodeId={flow.entry_node_id}
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
