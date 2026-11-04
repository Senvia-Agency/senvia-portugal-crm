import {
  AUTOMATION_WORKFLOW_SCHEMA_VERSION,
  WORKFLOW_FIELD_CATALOG,
  WORKFLOW_NATIVE_EVENT_ENTITY_RULES,
  getWorkflowFieldType,
  type AutomationWorkflowDraft,
  type WorkflowCadence,
  type WorkflowCondition,
  type WorkflowEntity,
  type WorkflowFieldType,
  type WorkflowPredicate,
  type WorkflowStage,
  type WorkflowTrigger,
} from '../../../supabase/functions/_shared/automation-workflow-contract.ts';
import type { AutomationActionType, AutomationNodeType } from '@/types/automations';

export type WorkflowOperand = string | number | boolean | {
  readonly kind: 'today_offset_days';
  readonly days: number;
};

export type RelativeDateDirection = 'past' | 'today' | 'future';
export type WorkflowNativeEvent = (typeof WORKFLOW_NATIVE_EVENT_ENTITY_RULES)[number]['event'];

export const WORKFLOW_ENTITY_LABELS: Readonly<Record<WorkflowEntity, string>> = {
  receivables: 'Dívidas e mensalidades',
  clients: 'Clientes',
  leads: 'Leads',
  proposals: 'Propostas',
};

export const WORKFLOW_TRIGGER_KIND_LABELS = {
  daily_schedule: 'Todos os dias',
  native_event: 'Quando acontece um evento',
  authenticated_manual: 'Início manual',
} as const;

export const WORKFLOW_CADENCE_LABELS: Readonly<Record<WorkflowCadence['mode'], string>> = {
  once: 'Uma vez por registo',
  per_run: 'Em cada execução',
  interval_days: 'Repetir após alguns dias',
};

export const CONFIGURED_WORKFLOW_ACTION_TYPES = [
  'send_whatsapp',
  'send_email',
  'move_stage',
  'assign_user',
  'add_to_list',
  'create_task',
  'webhook',
] as const satisfies readonly AutomationActionType[];

export const CONFIGURED_WORKFLOW_CANVAS_TYPES = [
  ...CONFIGURED_WORKFLOW_ACTION_TYPES,
  'condition',
  'wait',
  'end',
] as const satisfies readonly AutomationNodeType[];

const DEFAULT_SELECT: Readonly<Record<WorkflowEntity, readonly string[]>> = {
  receivables: ['due_date', 'outstanding_amount', 'status', 'contact_name', 'contact_email', 'contact_phone'],
  clients: ['name', 'status', 'email', 'phone', 'created_at'],
  leads: ['name', 'status', 'source', 'email', 'phone', 'created_at'],
  proposals: ['status', 'total_value', 'proposal_date', 'client_id', 'lead_id'],
};

export const WORKFLOW_OPERATORS = {
  text: ['exists', 'not_exists', 'equals', 'not_equals', 'contains'],
  number: ['exists', 'not_exists', 'equals', 'not_equals', 'greater_than', 'greater_than_or_equal', 'less_than', 'less_than_or_equal', 'between'],
  date: ['exists', 'not_exists', 'equals', 'not_equals', 'before', 'after', 'between'],
  datetime: ['exists', 'not_exists', 'equals', 'not_equals', 'before', 'after', 'between'],
  boolean: ['exists', 'not_exists', 'equals', 'not_equals'],
} as const satisfies Readonly<Record<WorkflowFieldType, readonly WorkflowPredicate['operator'][]>>;

export const WORKFLOW_OPERATOR_LABELS: Readonly<Record<WorkflowPredicate['operator'], string>> = {
  exists: 'Está preenchido',
  not_exists: 'Não está preenchido',
  equals: 'É igual a',
  not_equals: 'É diferente de',
  contains: 'Contém',
  greater_than: 'É maior que',
  greater_than_or_equal: 'É maior ou igual a',
  less_than: 'É menor que',
  less_than_or_equal: 'É menor ou igual a',
  before: 'É anterior a',
  after: 'É posterior a',
  between: 'Está entre',
};

export function createWorkflowDraft(timeZone: string): AutomationWorkflowDraft {
  return {
    schemaVersion: AUTOMATION_WORKFLOW_SCHEMA_VERSION,
    trigger: { kind: 'authenticated_manual', timeZone },
    query: {
      entity: 'clients',
      select: [...DEFAULT_SELECT.clients],
      filters: [],
      pageSize: 100,
    },
    stages: [],
  };
}

export function changeWorkflowEntity(
  workflow: AutomationWorkflowDraft,
  entity: WorkflowEntity,
): AutomationWorkflowDraft {
  return {
    ...workflow,
    query: {
      entity,
      select: [...DEFAULT_SELECT[entity]],
      filters: [],
      pageSize: workflow.query.pageSize,
    },
    stages: workflow.stages.map((stage) => ({ ...stage, conditions: [] })),
  };
}

export function triggerForKind(
  kind: WorkflowTrigger['kind'],
  timeZone: string,
  entity: WorkflowEntity,
): WorkflowTrigger {
  if (kind === 'daily_schedule') {
    return {
      kind,
      localTime: '09:00',
      timeZone,
    };
  }
  if (kind === 'native_event') {
    return { kind, event: compatibleWorkflowNativeEvents(entity)[0] ?? 'lead_created', timeZone };
  }
  return { kind, timeZone };
}

export function isValidWorkflowTimeZone(value: string): boolean {
  if (!value.trim()) return false;
  try {
    new Intl.DateTimeFormat('pt', { timeZone: value }).format(0);
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

export function isWorkflowNativeEventCompatible(
  entity: WorkflowEntity,
  event: string | undefined,
): event is WorkflowNativeEvent {
  return compatibleWorkflowNativeEvents(entity).some((candidate) => candidate === event);
}

export function compatibleWorkflowNativeEvents(entity: WorkflowEntity): readonly WorkflowNativeEvent[] {
  return WORKFLOW_NATIVE_EVENT_ENTITY_RULES.flatMap((rule) => (
    rule.entities.some((candidate) => candidate === entity) ? [rule.event] : []
  ));
}

export function fieldType(entity: WorkflowEntity, field: string): WorkflowFieldType {
  return getWorkflowFieldType(entity, field) ?? 'text';
}

export function createPredicate(entity: WorkflowEntity, field?: string): WorkflowPredicate {
  const candidate = field ?? WORKFLOW_FIELD_CATALOG[entity][0].name;
  const type = fieldType(entity, candidate);
  if (type === 'number') return { field: candidate, operator: 'greater_than', value: 0 };
  if (type === 'boolean') return { field: candidate, operator: 'equals', value: true };
  if (type === 'date' || type === 'datetime') {
    return { field: candidate, operator: 'before', value: { kind: 'today_offset_days', days: 0 } };
  }
  return { field: candidate, operator: 'equals', value: '' };
}

export function predicateWithOperator(
  entity: WorkflowEntity,
  field: string,
  operator: WorkflowPredicate['operator'],
): WorkflowPredicate {
  if (operator === 'exists' || operator === 'not_exists') return { field, operator };
  const type = fieldType(entity, field);
  const value: WorkflowOperand = type === 'number'
    ? 0
    : type === 'boolean'
      ? true
      : type === 'date' || type === 'datetime'
        ? { kind: 'today_offset_days', days: 0 }
        : '';
  if (operator === 'between') return { field, operator, values: [value, value] };
  return { field, operator, value };
}

export function isRelativeDateOperand(value: unknown): value is Extract<WorkflowOperand, { kind: string }> {
  return typeof value === 'object'
    && value !== null
    && 'kind' in value
    && 'days' in value
    && value.kind === 'today_offset_days'
    && typeof value.days === 'number';
}

export function relativeDateDirection(days: number): RelativeDateDirection {
  if (days < 0) return 'past';
  if (days > 0) return 'future';
  return 'today';
}

export function relativeDateOperand(
  direction: RelativeDateDirection,
  magnitude: number,
): Extract<WorkflowOperand, { kind: string }> {
  const days = Math.min(3650, Math.max(1, Math.round(Math.abs(magnitude))));
  return {
    kind: 'today_offset_days',
    days: direction === 'past' ? -days : direction === 'future' ? days : 0,
  };
}

export function createWorkflowStage(nodeId: string): WorkflowStage {
  return {
    id: `stage_${nodeId}`,
    nodeId,
    conditions: [],
    cadence: { mode: 'once' },
  };
}

export function selectableFields(entity: WorkflowEntity) {
  return WORKFLOW_FIELD_CATALOG[entity];
}

export function removeFieldReferences(
  workflow: AutomationWorkflowDraft,
  selected: readonly string[],
): AutomationWorkflowDraft {
  const keep = new Set(selected);
  return {
    ...workflow,
    query: {
      ...workflow.query,
      select: [...selected],
      filters: workflow.query.filters.filter((filter) => keep.has(filter.field)),
    },
    stages: workflow.stages.map((stage) => ({
      ...stage,
      conditions: stage.conditions.filter((condition) => keep.has(condition.field)),
    })),
  };
}

export function replaceCondition(
  conditions: readonly WorkflowCondition[],
  index: number,
  value: WorkflowCondition,
): WorkflowCondition[] {
  return conditions.map((condition, conditionIndex) => conditionIndex === index ? value : condition);
}
