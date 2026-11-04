import { ArrowDown, ArrowUp, ListChecks, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { WorkflowPredicateEditor } from '@/components/automations/WorkflowPredicateEditor';
import {
  CONFIGURED_WORKFLOW_ACTION_TYPES,
  WORKFLOW_CADENCE_LABELS,
  createWorkflowStage,
} from '@/components/automations/workflow-editor-model';
import { getNodeLabel } from '@/lib/automation-nodes';
import type { AutomationGraph } from '@/types/automations';
import type {
  AutomationWorkflowDraft,
  WorkflowCadence,
  WorkflowStage,
} from '../../../supabase/functions/_shared/automation-workflow-contract.ts';

const ACTION_TYPES = new Set<string>(CONFIGURED_WORKFLOW_ACTION_TYPES);

export function WorkflowStagesEditor({
  workflow,
  graph,
  onChange,
}: {
  readonly workflow: AutomationWorkflowDraft;
  readonly graph: AutomationGraph;
  readonly onChange: (workflow: AutomationWorkflowDraft) => void;
}) {
  const actions = graph.nodes.filter((node) => ACTION_TYPES.has(node.type));
  const selectedNodeIds = new Set(workflow.stages.map((stage) => stage.nodeId));
  const availableActions = actions.filter((node) => !selectedNodeIds.has(node.id));
  const setStages = (stages: WorkflowStage[]) => onChange({ ...workflow, stages });

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
          <ListChecks className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">Etapas por registo</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Cada etapa usa uma ação já criada no fluxo. As condições são verificadas com os dados mais recentes antes da ação.
          </p>
        </div>
      </div>

      <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground">
        O percurso segue as ligações, condições, ramos e esperas do canvas. As etapas abaixo acrescentam filtros de dados e frequência a cada ação. “Esperar resposta” interativo ainda não é suportado neste modo.
      </p>

      {workflow.stages.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          Ainda não há etapas. Adicione uma ação ao fluxo e escolha-a aqui.
        </p>
      )}

      <div className="space-y-3">
        {workflow.stages.map((stage, index) => {
          const selectableActions = actions.filter((node) => node.id === stage.nodeId || !selectedNodeIds.has(node.id));
          const actionExists = actions.some((node) => node.id === stage.nodeId);
          return (
            <article key={stage.id} className="space-y-4 rounded-xl border border-border bg-background p-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {actionExists ? getNodeLabel(actions.find((node) => node.id === stage.nodeId)?.type ?? '') : 'Ação em falta'}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={index === 0}
                  aria-label="Mover etapa para cima"
                  onClick={() => setStages(moveStage(workflow.stages, index, index - 1))}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={index === workflow.stages.length - 1}
                  aria-label="Mover etapa para baixo"
                  onClick={() => setStages(moveStage(workflow.stages, index, index + 1))}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remover etapa"
                  onClick={() => setStages(workflow.stages.filter((_, stageIndex) => stageIndex !== index))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Ação</Label>
                  <Select
                    value={stage.nodeId}
                    onValueChange={(nodeId) => setStages(updateStage(workflow.stages, index, {
                      ...stage,
                      id: `stage_${nodeId}`,
                      nodeId,
                    }))}
                  >
                    <SelectTrigger aria-invalid={!actionExists}><SelectValue placeholder="Escolher ação" /></SelectTrigger>
                    <SelectContent>
                      {selectableActions.map((node) => (
                        <SelectItem key={node.id} value={node.id}>{getNodeLabel(node.type)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!actionExists && <p className="text-xs text-destructive">Esta ação já não existe no fluxo.</p>}
                </div>

                <div className="space-y-1.5">
                  <Label>Frequência desta etapa</Label>
                  <Select
                    value={stage.cadence.mode}
                    onValueChange={(mode) => {
                      const cadence = cadenceForMode(mode);
                      if (cadence) setStages(updateStage(workflow.stages, index, { ...stage, cadence }));
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(WORKFLOW_CADENCE_LABELS).map(([mode, label]) => (
                        <SelectItem key={mode} value={mode}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {stage.cadence.mode === 'interval_days' && (
                <div className="space-y-1.5 sm:max-w-xs">
                  <Label htmlFor={`workflow-cadence-${stage.id}`}>Intervalo em dias</Label>
                  <Input
                    id={`workflow-cadence-${stage.id}`}
                    type="number"
                    min={1}
                    max={3650}
                    value={stage.cadence.days}
                    onChange={(event) => setStages(updateStage(workflow.stages, index, {
                      ...stage,
                      cadence: { mode: 'interval_days', days: boundedDays(event.target.value) },
                    }))}
                  />
                </div>
              )}

              <div className="space-y-2 border-t border-border pt-4">
                <div>
                  <Label>Condições da etapa</Label>
                  <p className="mt-1 text-xs text-muted-foreground">Sem condições, a ação corre para todos os registos devolvidos pela consulta.</p>
                </div>
                <WorkflowPredicateEditor
                  entity={workflow.query.entity}
                  selectedFields={workflow.query.select}
                  value={stage.conditions}
                  onChange={(conditions) => setStages(updateStage(workflow.stages, index, { ...stage, conditions }))}
                  emptyText="Esta etapa não tem condições adicionais."
                />
              </div>
            </article>
          );
        })}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={availableActions.length === 0}
        onClick={() => {
          const action = availableActions[0];
          if (action) setStages([...workflow.stages, createWorkflowStage(action.id)]);
        }}
      >
        <Plus className="mr-2 h-4 w-4" />
        Adicionar etapa
      </Button>
      {actions.length === 0 && <p className="text-xs text-muted-foreground">Crie uma ação de WhatsApp, email, CRM, tarefa ou webhook no fluxo para a poder usar.</p>}
      {actions.length > 0 && availableActions.length === 0 && workflow.stages.length > 0 && (
        <p className="text-xs text-muted-foreground">Todas as ações compatíveis já estão usadas.</p>
      )}
    </section>
  );
}

function updateStage(stages: readonly WorkflowStage[], index: number, stage: WorkflowStage): WorkflowStage[] {
  return stages.map((current, stageIndex) => stageIndex === index ? stage : current);
}

function moveStage(stages: readonly WorkflowStage[], from: number, to: number): WorkflowStage[] {
  if (to < 0 || to >= stages.length) return [...stages];
  const next = [...stages];
  const [stage] = next.splice(from, 1);
  if (stage) next.splice(to, 0, stage);
  return next;
}

function cadenceForMode(mode: string): WorkflowCadence | null {
  if (mode === 'once' || mode === 'per_run') return { mode };
  if (mode === 'interval_days') return { mode, days: 7 };
  return null;
}

function boundedDays(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(3650, Math.max(1, Math.round(parsed)));
}
