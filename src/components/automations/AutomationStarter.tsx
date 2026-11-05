import { useState } from 'react';
import { Loader2, WandSparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NODE_DEFINITIONS, TRIGGER_TYPES } from '@/lib/automation-nodes';
import { buildStarterRecipe } from '@/lib/automation-starter';
import type { AutomationRecipe } from '@/lib/automation-recipes';
import type { AutomationActionType, AutomationTriggerType } from '@/types/automations';

const FIRST_ACTIONS: readonly AutomationActionType[] = ['send_whatsapp', 'send_email', 'create_task', 'assign_user', 'condition', 'wait'];
export function AutomationStarter({ onCreate, busy }: { onCreate: (recipe: AutomationRecipe) => Promise<void>; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<AutomationTriggerType>('lead_created');
  const [audience, setAudience] = useState<'all' | 'filtered'>('all');
  const [field, setField] = useState('');
  const [value, setValue] = useState('');
  const [action, setAction] = useState<AutomationActionType>('create_task');
  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}><WandSparkles className="mr-2 h-4 w-4" />Criar com assistente</Button>;
  const valid = audience === 'all' || (field.trim().length > 0 && value.trim().length > 0);
  return <section aria-label="Assistente de automação" className="space-y-4 rounded-xl border bg-card p-4">
    <div><h2 className="text-base font-semibold">Crie o primeiro percurso</h2><p className="text-sm text-muted-foreground">Três escolhas criam um rascunho. Os detalhes ficam disponíveis no editor.</p></div>
    <div className="grid gap-4 md:grid-cols-3">
      <div className="space-y-2"><Label htmlFor="starter-trigger">1. Quando começa?</Label>
        <Select value={trigger} onValueChange={value => { const next = TRIGGER_TYPES.find(type => type === value); if (next) setTrigger(next); }}>
          <SelectTrigger id="starter-trigger"><SelectValue /></SelectTrigger><SelectContent>{TRIGGER_TYPES.map(type => <SelectItem key={type} value={type}>{NODE_DEFINITIONS[type].label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-2"><Label htmlFor="starter-audience">2. Para quem?</Label>
        <Select value={audience} onValueChange={value => setAudience(value === 'filtered' ? 'filtered' : 'all')}>
          <SelectTrigger id="starter-audience"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os registos deste evento</SelectItem><SelectItem value="filtered">Só os que cumprem uma condição</SelectItem></SelectContent>
        </Select>
        {audience === 'filtered' && <><Label htmlFor="starter-field">Campo</Label><Input id="starter-field" placeholder="Ex.: source" value={field} onChange={event => setField(event.target.value)} /><Label htmlFor="starter-value">É igual a</Label><Input id="starter-value" placeholder="Valor do segmento" value={value} onChange={event => setValue(event.target.value)} /></>}
      </div>
      <div className="space-y-2"><Label htmlFor="starter-action">3. O que acontece primeiro?</Label>
        <Select value={action} onValueChange={value => { const next = FIRST_ACTIONS.find(type => type === value); if (next) setAction(next); }}>
          <SelectTrigger id="starter-action"><SelectValue /></SelectTrigger><SelectContent>{FIRST_ACTIONS.map(type => <SelectItem key={type} value={type}>{NODE_DEFINITIONS[type].label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
    <div className="flex flex-wrap gap-2"><Button disabled={busy || !valid} onClick={() => onCreate(buildStarterRecipe({ trigger, audience, field, value, action }))}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Criar rascunho e configurar</Button><Button variant="ghost" onClick={() => setOpen(false)}>Fechar assistente</Button></div>
  </section>;
}
