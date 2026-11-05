import { Target, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CONDITION_OPERATOR_OPTIONS, NUMERIC_OPERATORS, VALUELESS_OPERATORS } from '@/lib/automation-nodes';
import { conditionValueIssue } from '@/lib/automation-condition-validation';
import type { AutomationNodeConfig, ConditionOperator } from '@/types/automations';

export interface ExitGoal {
  readonly match: 'all' | 'any';
  readonly conditions: AutomationNodeConfig[];
}

function goalOperator(value: unknown): ConditionOperator | undefined {
  switch (value) {
    case 'equals': case 'not_equals': case 'contains': case 'exists': case 'not_exists':
    case 'greater_than': case 'less_than': case 'greater_or_equal': case 'less_or_equal':
    case 'before': case 'after': case 'older_than_days': case 'contains_any':
    case 'in_clients': case 'in_leads': case 'in_crm': return value;
    default: return undefined;
  }
}

export function readExitGoal(value: unknown): ExitGoal | undefined {
  if (!value || typeof value !== 'object' || !('conditions' in value) || !Array.isArray(value.conditions)) return undefined;
  if (!('match' in value) || (value.match !== 'all' && value.match !== 'any')) return undefined;
  const conditions: AutomationNodeConfig[] = [];
  for (const rule of value.conditions) {
    if (!rule || typeof rule !== 'object' || !('field' in rule) || typeof rule.field !== 'string') return undefined;
    const operator = 'operator' in rule ? goalOperator(rule.operator) : undefined;
    if (!operator) return undefined;
    conditions.push({ field: rule.field, operator, value: 'value' in rule ? String(rule.value ?? '') : '' });
  }
  return conditions.length ? { match: value.match, conditions } : undefined;
}

export function exitGoalValid(goal: ExitGoal | undefined): boolean {
  return !goal || (goal.conditions.length > 0 && goal.conditions.every(rule => !!rule.field?.trim() && !conditionValueIssue(rule.operator ?? 'equals', rule.value)));
}

const emptyRule = (): AutomationNodeConfig => ({ field: 'status', operator: 'equals', value: '' });

export function GoalSettings({ goal, onChange }: {
  readonly goal: ExitGoal | undefined;
  readonly onChange: (value: ExitGoal | undefined) => void;
}) {
  const replaceRule = (index: number, patch: AutomationNodeConfig) => {
    if (goal) onChange({ ...goal, conditions: goal.conditions.map((rule, position) => position === index ? { ...rule, ...patch } : rule) });
  };
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Target className="h-4 w-4 text-primary" />Objetivo de saída</CardTitle>
        <CardDescription>O percurso termina quando o registo cumpre este objetivo. Por exemplo, quando a etapa passa a ganha ou o pagamento é confirmado.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="goal-enabled">Terminar ao atingir o objetivo</Label>
          <Switch id="goal-enabled" checked={!!goal} onCheckedChange={(enabled) => onChange(enabled ? { match: 'any', conditions: [emptyRule()] } : undefined)} />
        </div>
        {goal && <>
          <div className="space-y-1.5">
            <Label>Quando</Label>
            <Select value={goal.match} onValueChange={(match) => onChange({ ...goal, match: match === 'all' ? 'all' : 'any' })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todas as condições se verificam</SelectItem><SelectItem value="any">Qualquer condição se verifica</SelectItem></SelectContent>
            </Select>
          </div>
          {goal.conditions.map((rule, index) => <div key={index} className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between"><span className="text-sm font-medium">Condição {index + 1}</span><Button type="button" variant="ghost" size="icon" disabled={goal.conditions.length === 1} aria-label={`Remover condição do objetivo ${index + 1}`} onClick={() => onChange({ ...goal, conditions: goal.conditions.filter((_, position) => position !== index) })}><Trash2 className="h-4 w-4" /></Button></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor={`goal-field-${index}`}>Campo do registo</Label><Input id={`goal-field-${index}`} value={rule.field ?? ''} placeholder="status" onChange={(event) => replaceRule(index, { field: event.target.value })} /></div>
              <div className="space-y-1.5"><Label>Condição</Label><Select value={rule.operator ?? 'equals'} onValueChange={(operator) => {
                const parsed = goalOperator(operator);
                if (parsed) replaceRule(index, { operator: parsed });
              }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CONDITION_OPERATOR_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
            </div>
            {!VALUELESS_OPERATORS.includes(rule.operator ?? 'equals') && <div className="space-y-1.5"><Label htmlFor={`goal-value-${index}`}>Valor</Label><Input id={`goal-value-${index}`} type={NUMERIC_OPERATORS.includes(rule.operator ?? 'equals') ? 'number' : 'text'} value={rule.value ?? ''} placeholder="Valor que identifica o objetivo" onChange={(event) => replaceRule(index, { value: event.target.value })} /></div>}
            {conditionValueIssue(rule.operator ?? 'equals', rule.value) && <p className="text-xs text-destructive">{conditionValueIssue(rule.operator ?? 'equals', rule.value)}</p>}
          </div>)}
          <Button type="button" variant="outline" onClick={() => onChange({ ...goal, conditions: [...goal.conditions, emptyRule()] })}><Plus className="mr-2 h-4 w-4" />Adicionar condição</Button>
        </>}
      </CardContent>
    </Card>
  );
}
