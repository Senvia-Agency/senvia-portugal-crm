import { CalendarClock, Database, type LucideIcon } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
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
  WORKFLOW_ENTITY_LABELS,
  WORKFLOW_TRIGGER_KIND_LABELS,
  changeWorkflowEntity,
  compatibleWorkflowNativeEvents,
  isWorkflowNativeEventCompatible,
  removeFieldReferences,
  selectableFields,
  triggerForKind,
} from '@/components/automations/workflow-editor-model';
import { getNodeLabel } from '@/lib/automation-nodes';
import {
  WORKFLOW_ENTITIES,
  type AutomationWorkflowDraft,
  type WorkflowTrigger,
} from '../../../supabase/functions/_shared/automation-workflow-contract.ts';

const TRIGGER_KINDS: readonly WorkflowTrigger['kind'][] = [
  'daily_schedule',
  'native_event',
  'authenticated_manual',
];

const COMMON_TIME_ZONES = [
  'Europe/Lisbon',
  'Atlantic/Azores',
  'Europe/Madrid',
  'Europe/London',
  'America/Sao_Paulo',
  'Africa/Luanda',
] as const;

export function WorkflowTriggerQueryForm({
  workflow,
  onChange,
}: {
  readonly workflow: AutomationWorkflowDraft;
  readonly onChange: (workflow: AutomationWorkflowDraft) => void;
}) {
  const fields = selectableFields(workflow.query.entity);
  const nativeEvents = compatibleWorkflowNativeEvents(workflow.query.entity);
  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        <SectionTitle icon={CalendarClock} title="Quando começa" description="Escolha um horário, um evento do sistema ou uma execução manual autenticada." />
        <Select
          value={workflow.trigger.kind}
          onValueChange={(kind) => {
            const parsed = TRIGGER_KINDS.find((candidate) => candidate === kind);
            if (parsed) onChange({
              ...workflow,
              trigger: triggerForKind(parsed, workflow.trigger.timeZone ?? '', workflow.query.entity),
            });
          }}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {TRIGGER_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind} disabled={kind === 'native_event' && nativeEvents.length === 0}>
                {WORKFLOW_TRIGGER_KIND_LABELS[kind]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {workflow.trigger.kind === 'daily_schedule' && (
          <div className="space-y-1.5">
            <Label htmlFor="workflow-time">Hora local</Label>
            <Input
              id="workflow-time"
              type="time"
              value={workflow.trigger.localTime ?? ''}
              onChange={(event) => onChange({
                ...workflow,
                trigger: {
                  kind: 'daily_schedule',
                  localTime: event.target.value,
                  timeZone: workflow.trigger.timeZone ?? '',
                },
              })}
            />
          </div>
        )}
        {workflow.trigger.kind === 'native_event' && (
          <div className="space-y-1.5">
            <Label>Evento do sistema</Label>
            <Select
              value={isWorkflowNativeEventCompatible(workflow.query.entity, workflow.trigger.event)
                ? workflow.trigger.event
                : ''}
              onValueChange={(event) => {
                const parsed = nativeEvents.find((candidate) => candidate === event);
                if (parsed) onChange({
                  ...workflow,
                  trigger: { kind: 'native_event', event: parsed, timeZone: workflow.trigger.timeZone ?? '' },
                });
              }}
            >
              <SelectTrigger disabled={nativeEvents.length === 0}><SelectValue placeholder="Escolher evento compatível" /></SelectTrigger>
              <SelectContent>
                {nativeEvents.map((event) => <SelectItem key={event} value={event}>{getNodeLabel(event)}</SelectItem>)}
              </SelectContent>
            </Select>
            {!isWorkflowNativeEventCompatible(workflow.query.entity, workflow.trigger.event) && (
              <p className="text-xs text-destructive">
                {nativeEvents.length === 0
                  ? 'Este tipo de registo ainda não tem eventos nativos compatíveis.'
                  : 'Escolha um evento que entregue o mesmo tipo de registo da consulta.'}
              </p>
            )}
          </div>
        )}
        {workflow.trigger.kind === 'authenticated_manual' && (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            Só arranca quando um utilizador autenticado executar o fluxo. Guardar ou testar não envia mensagens.
          </p>
        )}
        <WorkflowTimeZoneField
          value={workflow.trigger.timeZone ?? ''}
          onChange={(timeZone) => onChange({ ...workflow, trigger: withTimeZone(workflow.trigger, timeZone) })}
        />
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
        <SectionTitle icon={Database} title="Registos a consultar" description="A primeira versão consulta toda a organização atual. Ainda não permite limitar a consulta a um responsável." />
        <div className="space-y-1.5">
          <Label>Tipo de registo</Label>
          <Select
            value={workflow.query.entity}
            onValueChange={(entity) => {
              const parsed = WORKFLOW_ENTITIES.find((candidate) => candidate === entity);
              if (parsed) onChange(changeWorkflowEntity(workflow, parsed));
            }}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {WORKFLOW_ENTITIES.map((entity) => <SelectItem key={entity} value={entity}>{WORKFLOW_ENTITY_LABELS[entity]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Campos disponíveis no fluxo</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {fields.map((field) => {
              const checked = workflow.query.select.includes(field.name);
              return (
                <label key={field.name} className="flex min-h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
                  <Checkbox
                    checked={checked}
                    disabled={checked && workflow.query.select.length === 1}
                    onCheckedChange={(next) => {
                      const select = next === true
                        ? [...workflow.query.select, field.name]
                        : workflow.query.select.filter((name) => name !== field.name);
                      onChange(removeFieldReferences(workflow, select));
                    }}
                  />
                  <span>{field.label}</span>
                </label>
              );
            })}
          </div>
        </div>
        <div className="space-y-2 border-t border-border pt-4">
          <div>
            <Label>Filtros iniciais</Label>
            <p className="mt-1 text-xs text-muted-foreground">Só os registos que cumprem todos os filtros entram nas etapas.</p>
          </div>
          <WorkflowPredicateEditor
            entity={workflow.query.entity}
            selectedFields={workflow.query.select}
            value={workflow.query.filters}
            onChange={(filters) => onChange({ ...workflow, query: { ...workflow.query, filters } })}
            emptyText="Sem filtros: serão consultados todos os registos acessíveis deste tipo."
          />
        </div>
      </section>
    </div>
  );
}

function WorkflowTimeZoneField({ value, onChange }: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="workflow-time-zone">Fuso horário</Label>
      <Input
        id="workflow-time-zone"
        list="workflow-time-zones"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Europe/Lisbon"
      />
      <datalist id="workflow-time-zones">
        {COMMON_TIME_ZONES.map((zone) => <option key={zone} value={zone} />)}
      </datalist>
      <p className="text-xs text-muted-foreground">Usado para interpretar datas e o dia local desta automação.</p>
    </div>
  );
}

function withTimeZone(trigger: WorkflowTrigger, timeZone: string): WorkflowTrigger {
  if (trigger.kind === 'daily_schedule') {
    return { kind: trigger.kind, localTime: trigger.localTime ?? '09:00', timeZone };
  }
  if (trigger.kind === 'native_event') {
    return { kind: trigger.kind, event: trigger.event ?? 'lead_created', timeZone };
  }
  return { kind: trigger.kind, timeZone };
}

function SectionTitle({ icon: Icon, title, description }: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
