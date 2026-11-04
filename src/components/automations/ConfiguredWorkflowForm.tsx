import { useState } from 'react';
import { AlertCircle, CheckCircle2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WorkflowStagesEditor } from '@/components/automations/WorkflowStagesEditor';
import { WorkflowTriggerQueryForm } from '@/components/automations/WorkflowTriggerQueryForm';
import { createWorkflowDraft, isValidWorkflowTimeZone } from '@/components/automations/workflow-editor-model';
import type { AutomationGraph, AutomationNodeConfig } from '@/types/automations';
import {
  parseAutomationWorkflowDefinition,
  parseAutomationWorkflowDraft,
  validateWorkflowStageNodeReferences,
  type WorkflowParseIssue,
} from '../../../supabase/functions/_shared/automation-workflow-contract.ts';

export function ConfiguredWorkflowForm({
  config,
  graph,
  set,
}: {
  readonly config: AutomationNodeConfig;
  readonly graph: AutomationGraph;
  readonly set: (patch: Partial<AutomationNodeConfig>) => void;
}) {
  const [timeZone, setTimeZone] = useState('');
  const [timeZoneError, setTimeZoneError] = useState('');
  if (requiresTimeZoneSelection(config.workflow)) {
    return (
      <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
        <div>
          <p className="text-sm font-semibold text-foreground">Escolha o fuso horário</p>
          <p className="mt-1 text-xs text-muted-foreground">
            O motor usa este fuso para interpretar datas e o dia local. A escolha fica gravada no fluxo e não é inferida do navegador.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="workflow-initial-time-zone">Fuso horário IANA</Label>
          <Input
            id="workflow-initial-time-zone"
            list="workflow-initial-time-zones"
            value={timeZone}
            onChange={(event) => { setTimeZone(event.target.value); setTimeZoneError(''); }}
            placeholder="Europe/Lisbon"
          />
          <datalist id="workflow-initial-time-zones">
            {['Europe/Lisbon', 'Atlantic/Azores', 'Europe/Madrid', 'Europe/London', 'America/Sao_Paulo', 'Africa/Luanda']
              .map((zone) => <option key={zone} value={zone} />)}
          </datalist>
          {timeZoneError && <p className="text-xs text-destructive">{timeZoneError}</p>}
        </div>
        <Button
          type="button"
          size="sm"
          disabled={!isValidWorkflowTimeZone(timeZone)}
          onClick={() => {
            const workflow = workflowWithTimeZone(config.workflow, timeZone);
            if (!workflow) {
              setTimeZoneError('Não foi possível preservar este rascunho. Reponha a configuração antes de continuar.');
              return;
            }
            set({ workflow });
          }}
        >
          Continuar
        </Button>
      </div>
    );
  }

  const draft = parseAutomationWorkflowDraft(config.workflow);
  if (draft.ok === false) {
    return (
      <div className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="text-sm font-semibold text-foreground">Configuração incompatível</p>
            <p className="mt-1 text-xs text-muted-foreground">O editor não alterou estes dados. Reponha apenas se quiser começar uma configuração nova.</p>
          </div>
        </div>
        <IssueList issues={draft.issues} />
        <Button type="button" variant="outline" size="sm" onClick={() => set({ workflow: undefined })}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Repor configuração
        </Button>
      </div>
    );
  }

  const workflow = draft.value;
  const complete = parseAutomationWorkflowDefinition(workflow);
  const referenceIssues = complete.ok === true
    ? validateWorkflowStageNodeReferences(complete.value, new Set(graph.nodes.map((node) => node.id)))
    : [];
  const issues = complete.ok === true ? referenceIssues : complete.issues;
  const onChange = (next: typeof workflow) => set({ workflow: next });

  return (
    <div className="space-y-4">
      <WorkflowTriggerQueryForm workflow={workflow} onChange={onChange} />
      <WorkflowStagesEditor workflow={workflow} graph={graph} onChange={onChange} />
      <div className={issues.length === 0
        ? 'flex items-start gap-2 rounded-xl border border-success/30 bg-success/5 p-3'
        : 'space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-3'}
      >
        <div className="flex items-start gap-2">
          {issues.length === 0
            ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />}
          <div>
            <p className="text-sm font-medium text-foreground">
              {issues.length === 0 ? 'Configuração completa' : 'Rascunho ainda incompleto'}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {issues.length === 0
                ? 'A prévia e a validação final ainda são obrigatórias antes de ativar.'
                : 'Pode guardar o rascunho, mas ele não está pronto para executar ou ativar.'}
            </p>
          </div>
        </div>
        {issues.length > 0 && <IssueList issues={issues} />}
      </div>
    </div>
  );
}

function requiresTimeZoneSelection(input: unknown): boolean {
  if (input === undefined) return true;
  if (typeof input !== 'object' || input === null || !('trigger' in input)) return false;
  const trigger = input.trigger;
  if (typeof trigger !== 'object' || trigger === null || !('kind' in trigger)) return false;
  return 'timeZone' in trigger
    ? typeof trigger.timeZone !== 'string' || !isValidWorkflowTimeZone(trigger.timeZone)
    : true;
}

function workflowWithTimeZone(input: unknown, timeZone: string) {
  if (input === undefined) return createWorkflowDraft(timeZone);
  if (typeof input !== 'object' || input === null || !('trigger' in input)) return null;
  const trigger = input.trigger;
  if (typeof trigger !== 'object' || trigger === null) return null;
  const candidate = { ...input, trigger: { ...trigger, timeZone } };
  const parsed = parseAutomationWorkflowDraft(candidate);
  return parsed.ok === true ? parsed.value : null;
}

function IssueList({ issues }: { readonly issues: readonly WorkflowParseIssue[] }) {
  return (
    <ul className="space-y-1 text-xs text-muted-foreground">
      {issues.slice(0, 5).map((issue, index) => (
        <li key={`${issue.path}-${index}`}>• {formatIssue(issue)}</li>
      ))}
      {issues.length > 5 && <li>• Mais {issues.length - 5} problema(s)</li>}
    </ul>
  );
}

function formatIssue(issue: WorkflowParseIssue): string {
  if (issue.path === 'stages') return 'Adicione pelo menos uma etapa.';
  if (issue.path.startsWith('trigger')) return `Início: ${issue.message}`;
  if (issue.path.startsWith('query')) return `Consulta: ${issue.message}`;
  if (issue.path.startsWith('stages')) return `Etapas: ${issue.message}`;
  return issue.message;
}
