import { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Database, GitBranch, GripVertical, HelpCircle, RotateCcw, SlidersHorizontal, Trash2, Waypoints,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import { NodeInspector } from '@/components/automations/NodeInspector';
import { FlowIoProvider } from '@/components/automations/FlowIoContext';
import { STEP_STATUS_META } from '@/components/automations/FlowActivity';
import {
  describeStepDetail, getNodeDefinition, getNodeLabel, getNodeStyle, humanizeNodeType, type StepDetailLookups,
} from '@/lib/automation-nodes';
import { inputFieldsFor, nodeOutput, sampleValueFor, triggerInput } from '@/lib/automation-io';
import { useAutomationNodeSteps, useAutomationRuns, useRetryAutomationRun } from '@/hooks/useAutomationFlows';
import { useEmailTemplates } from '@/hooks/useEmailTemplates';
import { useTeamMembers } from '@/hooks/useTeam';
import { useContactLists } from '@/hooks/useContactLists';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import type {
  AutomationGraph, AutomationGraphNode, AutomationNodeConfig, AutomationNodeStats,
  AutomationReentryPolicy, AutomationRun, AutomationTriggerType,
} from '@/types/automations';

interface NodeDetailsViewProps {
  node: AutomationGraphNode | null;
  isEntry: boolean;
  flowId: string;
  graph: AutomationGraph;
  /** The flow's trigger — what every step downstream receives. */
  triggerType: string | null;
  /** Canvas counters for this node, when the flow has already run. */
  stats?: AutomationNodeStats;
  onChange: (config: AutomationNodeConfig) => void;
  onChangeTrigger: (type: AutomationTriggerType) => void;
  /** The flow's reentry policy — message triggers edit it as «Só uma vez por número». */
  reentryPolicy: AutomationReentryPolicy;
  onReentryChange: (policy: AutomationReentryPolicy) => void;
  onDelete: () => void;
  onClose: () => void;
}

type Pane = 'input' | 'params' | 'output';

const PANES: Array<{ key: Pane; label: string; icon: typeof Database }> = [
  { key: 'input', label: 'Entrada', icon: Database },
  { key: 'params', label: 'Parâmetros', icon: SlidersHorizontal },
  { key: 'output', label: 'Saída', icon: Waypoints },
];

/** Context keys the engine keeps for itself (`__cursors`, `__test`, `__retry_of`…) — noise to the person reading. */
const isEngineKey = (key: string) => key.startsWith('__');

/**
 * One step, full screen, the way n8n opens a node: what comes in on the left,
 * the step's own settings in the middle, what it does on the right. Both side
 * columns follow the step: the input lists the fields THIS flow's trigger
 * delivers (plus what earlier steps added), the output says what THIS step
 * produces and shows its real executions.
 */
export function NodeDetailsView({
  node, isEntry, flowId, graph, triggerType, stats, onChange, onChangeTrigger,
  reentryPolicy, onReentryChange, onDelete, onClose,
}: NodeDetailsViewProps) {
  const [pane, setPane] = useState<Pane>('params');

  const definition = node ? getNodeDefinition(node.type) : undefined;
  const style = getNodeStyle(node?.type ?? 'end');
  const Icon = definition?.icon ?? HelpCircle;

  const { data: runs } = useAutomationRuns(node ? flowId : null, 50);
  const { data: nodeSteps, isLoading: loadingSteps } = useAutomationNodeSteps(node ? flowId : null, node?.id ?? null, 10);
  const retryRun = useRetryAutomationRun();

  // Ids in the step details → names, same as the activity tab.
  const { data: templates } = useEmailTemplates();
  const { data: members } = useTeamMembers();
  const { data: lists } = useContactLists();
  const { data: stages } = usePipelineStages();
  const lookups = useMemo<StepDetailLookups>(() => ({
    templateNameById: Object.fromEntries((templates ?? []).map((t) => [t.id, t.name])),
    memberNameById: Object.fromEntries((members ?? []).map((m) => [m.user_id, m.full_name || m.email || 'utilizador'])),
    listNameById: Object.fromEntries((lists ?? []).map((l) => [l.id, l.name])),
    stageNameByKey: Object.fromEntries((stages ?? []).map((s) => [s.key, s.name])),
  }), [templates, members, lists, stages]);

  // The sample for the input column: the run of the most recent step through
  // this node, else the flow's most recent run at all.
  const sampleRun: AutomationRun | null = useMemo(() => {
    const latestStepRunId = nodeSteps?.[0]?.run?.id;
    return (latestStepRunId && runs?.find((r) => r.id === latestStepRunId)) ?? runs?.[0] ?? null;
  }, [nodeSteps, runs]);

  // For the trigger node the input is its OWN record (so it changes as the
  // trigger is changed); for any other step, whatever the flow's trigger sends.
  const effectiveTrigger = isEntry ? node?.type ?? triggerType : triggerType;
  const trigger = triggerInput(effectiveTrigger);
  const inputFields = useMemo(
    () => (node ? inputFieldsFor(graph, node, effectiveTrigger) : []),
    [graph, node, effectiveTrigger],
  );
  const output = node ? nodeOutput(node, effectiveTrigger) : null;

  if (!node) return null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent variant="fullScreen" className="flex flex-col gap-0 p-0">
        {/* Header */}
        <div className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-3 pr-14 sm:px-6">
          <Button variant="ghost" size="sm" className="-ml-2 h-8 shrink-0 gap-1 px-2" onClick={onClose}>
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Voltar ao fluxo</span>
          </Button>
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-[2.5px]', style.bg, style.ring)}>
            <Icon className={cn('h-5 w-5', style.icon)} />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-base">
              {definition?.label ?? humanizeNodeType(node.type)}
              {isEntry && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">Gatilho</span>}
            </DialogTitle>
            <DialogDescription className="line-clamp-2 text-xs">{definition?.description}</DialogDescription>
          </div>
          {stats && (
            <div className="hidden items-center gap-1.5 md:flex">
              <StatChip label="passaram" value={stats.passed} className="text-success" />
              <StatChip label="à espera" value={stats.waiting} className="text-warning" />
              <StatChip label="falharam" value={stats.failed} className={stats.failed > 0 ? 'text-destructive' : 'text-muted-foreground'} />
            </div>
          )}
        </div>

        {/* Mobile pane switcher — on desktop the three columns sit side by side. */}
        <div className="flex shrink-0 gap-1 border-b border-border px-4 py-2 lg:hidden">
          {PANES.map((item) => {
            const PaneIcon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setPane(item.key)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  pane === item.key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}
              >
                <PaneIcon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)]">
          {/* Input */}
          <section className={cn('flex min-h-0 flex-col border-border bg-muted/20 lg:border-r', pane !== 'input' && 'hidden lg:flex')}>
            <div className="shrink-0 border-b border-border/60 px-4 pb-3 pt-4">
            <ColumnTitle icon={Database}>Entrada</ColumnTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {isEntry
                ? (trigger ? `${trigger.source}. É isto que cada percurso recebe à partida.` : 'O que o gatilho entrega ao fluxo.')
                : trigger
                  ? `Vem do gatilho «${getNodeLabel(effectiveTrigger ?? '')}»: ${trigger.source.toLowerCase()}, mais o que os passos anteriores juntaram.`
                  : 'O que este passo recebe do anterior.'}
            </p>
            {trigger?.note && (
              <p className="mt-2 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-[11px] text-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                {trigger.note}
              </p>
            )}

            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Variáveis <span className="tabular-nums normal-case opacity-60">{inputFields.length}</span>
            </h4>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Arrasta uma variável para um campo de texto, ou clica no nome dela nos botões por baixo do campo. O exemplo vem do último contacto que passou aqui.</p>
            <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-background">
              {inputFields.map((field) => {
                const sample = sampleValueFor(sampleRun, field.key);
                return (
                  <li
                    key={field.key}
                    // Native drag and drop: the browser inserts text/plain at
                    // the drop caret of any input or textarea by itself, and
                    // React sees the resulting input event — so the token lands
                    // in the message exactly where it is let go, as in n8n.
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', `{{${field.key}}}`);
                      event.dataTransfer.effectAllowed = 'copy';
                    }}
                    title={`Arrasta {{${field.key}}} para um campo de texto`}
                    className="flex cursor-grab items-start justify-between gap-2 px-2 py-2 active:cursor-grabbing hover:bg-primary/5"
                  >
                    <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground">{field.label}</p>
                      <code className="text-[11px] text-primary">{`{{${field.key}}}`}</code>
                      {field.hint && <p className="text-[10px] text-muted-foreground">{field.hint}</p>}
                    </div>
                    <span className="max-w-[45%] truncate text-right text-[11px] text-muted-foreground" title={sample}>
                      {sample || '—'}
                    </span>
                  </li>
                );
              })}
            </ul>

            <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Registo completo</h4>
            {!sampleRun ? (
              <p className="mt-2 rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
                Ainda não passou nenhum contacto por aqui. Os exemplos aparecem depois da primeira execução.
              </p>
            ) : (
              <>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Exemplo: {sampleRun.contact_name || sampleRun.contact_phone || sampleRun.contact_email || 'contacto'}
                  {sampleRun.started_at ? ` · ${formatDateTime(sampleRun.started_at)}` : ''}
                </p>
                <dl className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-background text-[11px]">
                  {contextRows(sampleRun).map(([key, value]) => (
                    <div key={key} className="flex gap-2 px-3 py-1.5">
                      <dt className="w-2/5 shrink-0 truncate font-mono text-muted-foreground" title={key}>{key}</dt>
                      <dd className="min-w-0 flex-1 break-words text-foreground">{value}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
            </div>
          </section>

          {/* Parameters */}
          <section className={cn('flex min-h-0 flex-col', pane !== 'params' && 'hidden lg:flex')}>
            <div className="shrink-0 border-b border-border/60 px-4 py-3 sm:px-6">
              <div className="mx-auto max-w-2xl">
                <ColumnTitle icon={SlidersHorizontal}>Parâmetros</ColumnTitle>
              </div>
            </div>
            {/* No padding on the scrolling box itself: Chrome offsets sticky
                children by it, so the trigger catalogue's search bar floated
                below the top edge with the cards scrolling past above it. */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-2xl px-4 py-4 sm:px-6">
                <FlowIoProvider fields={inputFields}>
                  <NodeInspector
                    node={node}
                    isEntry={isEntry}
                    onChange={onChange}
                    onChangeTrigger={isEntry ? onChangeTrigger : undefined}
                    reentry={isEntry ? { policy: reentryPolicy, onChange: onReentryChange } : undefined}
                  />
                </FlowIoProvider>
              </div>
            </div>
          </section>

          {/* Output */}
          <section className={cn('flex min-h-0 flex-col border-border bg-muted/20 lg:border-l', pane !== 'output' && 'hidden lg:flex')}>
            <div className="shrink-0 border-b border-border/60 px-4 pb-3 pt-4">
              <ColumnTitle icon={Waypoints}>Saída</ColumnTitle>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
            {output && (
              <>
                <p className="text-xs text-foreground">{output.summary}</p>
                {output.branches && output.branches.length > 0 && (
                  <div className="mt-2">
                    <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                      <GitBranch className="h-3 w-3" /> Caminhos possíveis
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {output.branches.map((branch, i) => (
                        <span key={`${branch}-${i}`} className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-foreground">{branch}</span>
                      ))}
                    </div>
                  </div>
                )}
                {output.fields.length > 0 && (
                  <div className="mt-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Acrescenta ao percurso</h4>
                    <ul className="mt-1.5 divide-y divide-border overflow-hidden rounded-xl border border-border bg-background">
                      {output.fields.map((field) => (
                        <li key={field.key} className="px-3 py-2">
                          <p className="text-xs font-medium text-foreground">{field.label}</p>
                          <code className="text-[11px] text-primary">{`{{${field.key}}}`}</code>
                          {field.hint && <p className="text-[10px] text-muted-foreground">{field.hint}</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {isEntry && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Passa {inputFields.length} variáveis ao passo seguinte — as da Entrada.
                  </p>
                )}
              </>
            )}

            {stats && (
              <div className="mt-4 grid grid-cols-3 gap-2">
                <MiniStat label="Passaram" value={stats.passed} className="text-success" />
                <MiniStat label="À espera" value={stats.waiting} className="text-warning" />
                <MiniStat label="Falharam" value={stats.failed} className={stats.failed > 0 ? 'text-destructive' : 'text-muted-foreground'} />
              </div>
            )}

            <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Últimas execuções</h4>
            <div className="mt-2">
              {loadingSteps ? (
                <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
              ) : !nodeSteps?.length ? (
                <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
                  Este passo ainda não correu. Testa a automação, ou ativa-a, e o resultado aparece aqui.
                </p>
              ) : (
                <ol className="space-y-2">
                  {nodeSteps.map(({ step, run }) => {
                    const meta = STEP_STATUS_META[step.status] ?? STEP_STATUS_META.ok;
                    const StepIcon = meta.icon;
                    const rows = describeStepDetail(step.detail, lookups);
                    return (
                      <li key={step.id} className={cn('rounded-xl border bg-background p-3', step.status === 'failed' ? 'border-destructive/40' : 'border-border')}>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <StepIcon className={cn('h-3.5 w-3.5 shrink-0', meta.className)} />
                          <span className="text-xs font-semibold text-foreground">
                            {run?.contact_name || run?.contact_phone || run?.contact_email || 'Contacto'}
                          </span>
                          <span className={cn('text-[11px] font-medium', meta.className)}>{meta.label}</span>
                          <span className="ml-auto text-[11px] text-muted-foreground">{formatDateTime(step.created_at)}</span>
                        </div>
                        {/* The run broke on THIS step: run it again from here, as n8n's retry does. */}
                        {step.status === 'failed' && run?.status === 'failed' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-2 h-7 text-xs"
                            disabled={retryRun.isPending}
                            onClick={() => retryRun.mutate({ runId: run.id, from: 'failed_step' })}
                          >
                            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Repetir daqui
                          </Button>
                        )}
                        {rows.length > 0 && (
                          <dl className="mt-1.5 space-y-0.5 text-[11px] leading-snug">
                            {rows.map((row) => (
                              <div key={row.key} className="flex gap-1.5">
                                <dt className={cn('shrink-0 font-medium', step.status === 'failed' ? 'text-destructive/80' : 'text-muted-foreground')}>{row.label}:</dt>
                                <dd className={cn('break-words', step.status === 'failed' ? 'text-destructive' : 'text-foreground')}>{row.value}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 sm:px-6">
          <p className="text-[11px] text-muted-foreground">
            As alterações ficam no fluxo. Carrega em <strong>Guardar</strong> no editor para as gravar.
          </p>
          <div className="flex items-center gap-2">
            {!isEntry && (
              <Button variant="outline" className="text-destructive hover:text-destructive" onClick={onDelete}>
                <Trash2 className="mr-2 h-4 w-4" />
                Eliminar passo
              </Button>
            )}
            <Button onClick={onClose}>Concluído</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ColumnTitle({ icon: Icon, children }: { icon: typeof Database; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
      <Icon className="h-4 w-4 text-primary" />
      {children}
    </h3>
  );
}

function StatChip({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
      <strong className={cn('tabular-nums', className)}>{value}</strong> {label}
    </span>
  );
}

function MiniStat({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-lg font-bold tabular-nums', className)}>{value}</p>
    </div>
  );
}

/** The trigger's record as stored on the run, minus the engine's own bookkeeping. */
function contextRows(run: AutomationRun): Array<[string, string]> {
  const ctx = (run.context ?? {}) as Record<string, unknown>;
  return Object.entries(ctx)
    .filter(([key, value]) => !isEngineKey(key) && value !== null && value !== undefined && value !== '')
    .slice(0, 24)
    .map(([key, value]) => {
      const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return [key, text.length > 90 ? `${text.slice(0, 90)}…` : text];
    });
}
