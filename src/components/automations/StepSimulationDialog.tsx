import { useState } from 'react';
import { FlaskConical, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AutomationToolContactPicker } from './AutomationToolContactPicker';
import type { AutomationToolContact } from '@/hooks/useAutomationToolContacts';
import { useSimulateAutomationStep } from '@/hooks/useSimulateAutomationStep';
export function StepSimulationDialog({ flowId, nodeId, disabled = false, sampleSubject }: {
  readonly flowId: string; readonly nodeId: string; readonly disabled?: boolean;
  readonly sampleSubject?: { readonly type: string; readonly id: string; readonly name?: string };
}) {
  const [open, setOpen] = useState(false), [contact, setContact] = useState<AutomationToolContact | null>(null);
  const simulation = useSimulateAutomationStep();
  const subject = contact ? { type: contact.subjectType, id: contact.id } : sampleSubject;
  const result = simulation.data;
  const details = Object.entries(result?.detail ?? {}).filter(([key, value]) => !key.startsWith('__') && !/secret|token|authorization|password/i.test(key) && ['string', 'number', 'boolean'].includes(typeof value));
  return <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) simulation.reset(); }}>
    <DialogTrigger asChild><Button type="button" variant="outline" size="sm" disabled={disabled}><FlaskConical className="mr-2 h-4 w-4" />Simular este passo</Button></DialogTrigger>
    <DialogContent className="max-w-xl">
      <DialogHeader><DialogTitle>Simular este passo</DialogTitle><DialogDescription>Usa a configuração guardada e os dados do registo escolhido. Não envia mensagens, não altera registos e não executa os passos seguintes.</DialogDescription></DialogHeader>
      <AutomationToolContactPicker enabled={open} selected={contact} onChange={value => { setContact(value); simulation.reset(); }} emptyLabel={sampleSubject ? `Usar ${sampleSubject.name || 'registo da execução'}` : 'Nenhum contacto'} />
      {simulation.isError && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{simulation.error instanceof Error ? simulation.error.message : 'Não foi possível simular este passo.'}</p>}
      {result && <section className="max-h-72 overflow-y-auto rounded-lg border border-success/30 bg-success/5 p-4" aria-live="polite"><h3 className="text-sm font-semibold">Simulação concluída, sem executar ações</h3><dl className="mt-3 space-y-2">{details.map(([key, value]) => <div key={key}><dt className="text-xs text-muted-foreground">{key.replace(/_/g, ' ')}</dt><dd className="whitespace-pre-wrap break-words text-sm">{String(value)}</dd></div>)}</dl>{!details.length && <p className="mt-2 text-sm text-muted-foreground">Os dados foram avaliados. Nenhuma ação foi executada.</p>}</section>}
      <div className="flex justify-end"><Button disabled={!subject || simulation.isPending} onClick={() => subject && simulation.mutate({ flow_id: flowId, node_id: nodeId, subject_type: subject.type, subject_id: subject.id })}>{simulation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simular sem executar</Button></div>
    </DialogContent>
  </Dialog>;
}
