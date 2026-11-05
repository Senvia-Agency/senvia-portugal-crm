import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getNodeLabel } from '@/lib/automation-nodes';
import { activityFilterError, EMPTY_ACTIVITY_FILTERS, type AutomationActivityFilters } from '@/lib/automation-activity-filters';
import type { AutomationGraph } from '@/types/automations';

interface ActivityFiltersProps {
  readonly value: AutomationActivityFilters;
  readonly onChange: (value: AutomationActivityFilters) => void;
  readonly graph: AutomationGraph;
  readonly resultCount: number;
}
export function ActivityFilters({value,onChange,graph,resultCount}:ActivityFiltersProps) {
  const error=activityFilterError(value);
  const active=!!(value.contact || value.startDate || value.endDate || value.nodeId);
  const change=(patch:Partial<AutomationActivityFilters>)=>onChange({...value,...patch});
  return <section aria-label="Filtros de execuções" className="space-y-3 rounded-xl border border-border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-medium">Pesquisar nas 100 execuções recentes</p>
      <Button type="button" variant="ghost" size="sm" disabled={!active} onClick={()=>onChange(EMPTY_ACTIVITY_FILTERS)}>Limpar filtros</Button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="space-y-1.5"><Label htmlFor="activity-contact">Contacto</Label><Input id="activity-contact" type="search" value={value.contact} onChange={event=>change({contact:event.target.value})} placeholder="Nome, email ou telefone" /></div>
      <div className="space-y-1.5"><Label htmlFor="activity-start">Data inicial</Label><Input id="activity-start" type="date" value={value.startDate} onChange={event=>change({startDate:event.target.value})} aria-invalid={!!error} aria-describedby={error?'activity-date-error':undefined} /></div>
      <div className="space-y-1.5"><Label htmlFor="activity-end">Data final</Label><Input id="activity-end" type="date" value={value.endDate} onChange={event=>change({endDate:event.target.value})} aria-invalid={!!error} aria-describedby={error?'activity-date-error':undefined} /></div>
      <div className="space-y-1.5"><Label htmlFor="activity-node">Passo atual</Label><Select value={value.nodeId || '__all__'} onValueChange={nodeId=>change({nodeId:nodeId==='__all__'?'':nodeId})}><SelectTrigger id="activity-node"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__all__">Qualquer passo</SelectItem>{graph.nodes.map((node,index)=><SelectItem key={node.id} value={node.id}>{index+1}. {getNodeLabel(node.type)}</SelectItem>)}</SelectContent></Select></div>
    </div>
    {error && <p id="activity-date-error" role="alert" className="text-sm text-destructive">{error}</p>}
    <p className="text-xs text-muted-foreground">{resultCount} execução(ões) encontrada(s). Datas de início em Portugal continental, incluindo o dia inteiro. O passo considera todos os caminhos em espera.</p>
  </section>;
}
