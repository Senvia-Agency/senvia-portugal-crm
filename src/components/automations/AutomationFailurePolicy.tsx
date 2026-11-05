import { ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export interface AutomationFailurePolicyValue {
  readonly enabled: boolean;
  readonly threshold_percent: number;
  readonly min_runs: number;
  readonly window_minutes: number;
  readonly daily_summary: boolean;
}
const defaults: AutomationFailurePolicyValue = { enabled: false, threshold_percent: 20, min_runs: 10, window_minutes: 60, daily_summary: false };
function numberProperty(value: object, key: string, fallback: number): number {
  const property = Reflect.get(value, key);
  return typeof property === 'number' && Number.isFinite(property) ? property : fallback;
}
function readValue(value: unknown): AutomationFailurePolicyValue {
  if (!value || typeof value !== 'object') return defaults;
  return { enabled: Reflect.get(value, 'enabled') === true,
    daily_summary: Reflect.get(value, 'daily_summary') === true,
    threshold_percent: numberProperty(value, 'threshold_percent', 20),
    min_runs: numberProperty(value, 'min_runs', 10), window_minutes: numberProperty(value, 'window_minutes', 60) };
}
export function AutomationFailurePolicy({ value, onChange }: {
  readonly value: unknown;
  readonly onChange: (policy: AutomationFailurePolicyValue) => void;
}) {
  const policy = readValue(value);
  const update = (patch: Partial<AutomationFailurePolicyValue>) => onChange({ ...policy, ...patch });
  const fields = [
    { key: 'threshold_percent', label: 'Taxa de falhas superior a (%)', min: 1, max: 100 },
    { key: 'min_runs', label: 'Mínimo de percursos terminados', min: 2, max: 10000 },
    { key: 'window_minutes', label: 'Janela de avaliação (minutos)', min: 5, max: 1440 },
  ] as const;
  return <Card>
    <CardHeader className="pb-3">
      <CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="h-4 w-4 text-warning" />Proteção contra falhas</CardTitle>
      <CardDescription>Pause novas entradas quando muitas execuções falham. Os percursos já iniciados mantêm o seu estado.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="failure-policy-enabled">Pausar automaticamente quando há muitas falhas</Label>
        <Switch id="failure-policy-enabled" checked={policy.enabled} onCheckedChange={enabled => update({ enabled })} />
      </div>
      {policy.enabled && <div className="grid gap-3 sm:grid-cols-3">{fields.map(field => {
        const invalid = policy[field.key] < field.min || policy[field.key] > field.max || !Number.isInteger(policy[field.key]);
        return <div key={field.key} className="space-y-1.5">
          <Label htmlFor={`failure-${field.key}`} className="text-xs">{field.label}</Label>
          <Input id={`failure-${field.key}`} type="number" min={field.min} max={field.max} step="1" value={policy[field.key]} aria-invalid={invalid}
            onChange={event => update({ [field.key]: Number(event.target.value) })} />
          {invalid && <p className="text-xs text-destructive">Escolha um valor entre {field.min} e {field.max}.</p>}
        </div>;
      })}</div>}
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1"><Label htmlFor="failure-policy-summary">Receber resumo diário de falhas</Label><p className="text-xs text-muted-foreground">O dono da automação recebe um resumo às 09:00, hora de Portugal, quando existem falhas do dia anterior.</p></div>
        <Switch id="failure-policy-summary" checked={policy.daily_summary} onCheckedChange={daily_summary => update({ daily_summary })} />
      </div>
    </CardContent>
  </Card>;
}
