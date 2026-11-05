import { Plus, X } from 'lucide-react';
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
import type {
  WorkflowEntity,
  WorkflowPredicate,
} from '../../../supabase/functions/_shared/automation-workflow-contract.ts';
import {
  WORKFLOW_OPERATORS,
  WORKFLOW_OPERATOR_LABELS,
  createPredicate,
  fieldType,
  isRelativeDateOperand,
  predicateWithOperator,
  relativeDateDirection,
  relativeDateOperand,
  replaceCondition,
  selectableFields,
  type WorkflowOperand,
} from '@/components/automations/workflow-editor-model';

type PredicateListEditorProps = {
  readonly entity: WorkflowEntity;
  readonly selectedFields: readonly string[];
  readonly value: readonly WorkflowPredicate[];
  readonly onChange: (value: WorkflowPredicate[]) => void;
  readonly emptyText: string;
};

export function WorkflowPredicateEditor({
  entity,
  selectedFields,
  value,
  onChange,
  emptyText,
}: PredicateListEditorProps) {
  const fields = selectableFields(entity).filter((field) => selectedFields.includes(field.name));
  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          {emptyText}
        </p>
      )}
      {value.map((predicate, index) => (
        <div key={`${predicate.field}-${index}`} className="space-y-3 rounded-lg border border-border bg-background p-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Select
              value={predicate.field}
              onValueChange={(field) => onChange(replaceCondition(value, index, createPredicate(entity, field)))}
            >
              <SelectTrigger aria-label="Campo"><SelectValue /></SelectTrigger>
              <SelectContent>
                {fields.map((field) => <SelectItem key={field.name} value={field.name}>{field.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select
              value={predicate.operator}
              onValueChange={(operator) => {
                if (!isCompatibleOperator(operator, fieldType(entity, predicate.field))) return;
                onChange(replaceCondition(value, index, predicateWithOperator(entity, predicate.field, operator)));
              }}
            >
              <SelectTrigger aria-label="Operador"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WORKFLOW_OPERATORS[fieldType(entity, predicate.field)].map((operator) => (
                  <SelectItem key={operator} value={operator}>{WORKFLOW_OPERATOR_LABELS[operator]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remover condição"
              onClick={() => onChange(value.filter((_, conditionIndex) => conditionIndex !== index))}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <PredicateValueEditor
            entity={entity}
            predicate={predicate}
            onChange={(next) => onChange(replaceCondition(value, index, next))}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={fields.length === 0}
        onClick={() => onChange([...value, createPredicate(entity, fields[0]?.name)])}
      >
        <Plus className="mr-2 h-4 w-4" />
        Adicionar condição
      </Button>
      {fields.length === 0 && <p className="text-xs text-destructive">Escolha pelo menos um campo antes de adicionar condições.</p>}
    </div>
  );
}

function PredicateValueEditor({
  entity,
  predicate,
  onChange,
}: {
  readonly entity: WorkflowEntity;
  readonly predicate: WorkflowPredicate;
  readonly onChange: (value: WorkflowPredicate) => void;
}) {
  if (predicate.operator === 'exists' || predicate.operator === 'not_exists') return null;
  const type = fieldType(entity, predicate.field);
  if (predicate.operator === 'between') {
    if (!('values' in predicate) || !predicate.values) return null;
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <OperandEditor
          label="Desde"
          type={type}
          value={predicate.values[0]}
          onChange={(operand) => onChange({ ...predicate, values: [operand, predicate.values[1]] })}
        />
        <OperandEditor
          label="Até"
          type={type}
          value={predicate.values[1]}
          onChange={(operand) => onChange({ ...predicate, values: [predicate.values[0], operand] })}
        />
      </div>
    );
  }
  if (!('value' in predicate)) return null;
  return (
    <OperandEditor
      label="Valor"
      type={type}
      value={predicate.value}
      onChange={(value) => onChange({ ...predicate, value })}
    />
  );
}

function OperandEditor({
  label,
  type,
  value,
  onChange,
}: {
  readonly label: string;
  readonly type: ReturnType<typeof fieldType>;
  readonly value: unknown;
  readonly onChange: (value: WorkflowOperand) => void;
}) {
  if (type === 'boolean') {
    return (
      <div className="space-y-1.5">
        <Label>{label}</Label>
        <Select value={value === true ? 'true' : 'false'} onValueChange={(next) => onChange(next === 'true')}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="true">Sim</SelectItem><SelectItem value="false">Não</SelectItem></SelectContent>
        </Select>
      </div>
    );
  }
  if (type === 'date' || type === 'datetime') {
    const relative = isRelativeDateOperand(value);
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <Select
          value={relative ? 'relative' : 'fixed'}
          onValueChange={(mode) => onChange(mode === 'relative' ? { kind: 'today_offset_days', days: 0 } : new Date().toISOString().slice(0, 10))}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="relative">Relativo a hoje</SelectItem><SelectItem value="fixed">Data específica</SelectItem></SelectContent>
        </Select>
        {relative ? (
          <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <Select
              value={relativeDateDirection(value.days)}
              onValueChange={(direction) => {
                if (direction !== 'past' && direction !== 'today' && direction !== 'future') return;
                onChange(relativeDateOperand(direction, Math.abs(value.days) || 1));
              }}
            >
              <SelectTrigger aria-label="Direção da data"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="past">Há</SelectItem>
                <SelectItem value="today">Hoje</SelectItem>
                <SelectItem value="future">Daqui a</SelectItem>
              </SelectContent>
            </Select>
            {relativeDateDirection(value.days) !== 'today' && (
              <div className="flex items-center gap-2">
                <Input
                  aria-label="Número de dias"
                  type="number"
                  min={1}
                  max={3650}
                  value={Math.abs(value.days)}
                  onChange={(event) => onChange(relativeDateOperand(
                    relativeDateDirection(value.days),
                    boundedNumber(event.target.value, 1, 3650),
                  ))}
                />
                <span className="shrink-0 text-xs text-muted-foreground">dias</span>
              </div>
            )}
          </div>
        ) : (
          <Input type="date" value={typeof value === 'string' ? value.slice(0, 10) : ''} onChange={(event) => onChange(event.target.value)} />
        )}
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type={type === 'number' ? 'number' : 'text'}
        value={typeof value === 'string' || typeof value === 'number' ? value : ''}
        onChange={(event) => onChange(type === 'number' ? Number(event.target.value) : event.target.value)}
      />
    </div>
  );
}

function isCompatibleOperator(value: string, type: ReturnType<typeof fieldType>): value is WorkflowPredicate['operator'] {
  return WORKFLOW_OPERATORS[type].some((operator) => operator === value);
}

function boundedNumber(value: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}
