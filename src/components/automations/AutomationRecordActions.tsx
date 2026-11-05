import { useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAutomationFlows } from '@/hooks/useAutomationFlows';
import { usePermissions } from '@/hooks/usePermissions';
import { supabase } from '@/integrations/supabase/client';

interface AutomationRecordActionsProps {
  readonly subjectType: 'lead' | 'client' | 'sale' | 'proposal';
  readonly subjectIds: readonly string[];
  readonly onStarted?: () => void;
}

const responseSchema = z.object({
  enrolled: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative().optional(),
  errors: z.array(z.unknown()).optional(),
  results: z.array(z.unknown()).optional(),
});

export function AutomationRecordActions({ subjectType, subjectIds, onStarted }: AutomationRecordActionsProps) {
  const { isAdmin } = usePermissions();
  const { data: flows = [], isLoading } = useAutomationFlows();
  const [open, setOpen] = useState(false);
  const [flowId, setFlowId] = useState('');
  const [pending, setPending] = useState(false);
  const ids = [...new Set(subjectIds)];
  const active = flows.filter(flow => flow.status === 'active');
  const selected = active.find(flow => flow.id === flowId);

  const start = async () => {
    if (!selected || !ids.length || ids.length > 100) return;
    setPending(true);
    try {
      const { data, error } = await supabase.functions.invoke('automation-engine', {
        body: { action: 'manual', flow_id: selected.id, subject_type: subjectType, subject_ids: ids },
      });
      if (error) throw error;
      const outcome = responseSchema.parse(data);
      const notify = outcome.enrolled > 0 ? toast.success : toast.info;
      notify(`${outcome.enrolled} registos inscritos${outcome.queued === undefined ? '' : ` · ${outcome.queued} em fila`}`, {
        description: outcome.enrolled < ids.length
          ? 'Alguns registos não entraram. Consulte a atividade da automação para acompanhar os percursos.'
          : 'Os registos em fila serão processados pelo motor. Acompanhe os percursos na atividade da automação.',
      });
      setOpen(false);
      onStarted?.();
    } catch (error) {
      toast.error('Não foi possível iniciar a automação', {
        description: error instanceof Error ? error.message : 'Tente novamente ou verifique as suas permissões.',
      });
    } finally {
      setPending(false);
    }
  };

  if (!isAdmin || !ids.length) return null;
  return <>
    <Button type="button" variant="outline" onClick={() => setOpen(true)}><Play className="mr-2 h-4 w-4" />Iniciar automação</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!pending) setOpen(value); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Iniciar automação</DialogTitle><DialogDescription>Escolha uma automação ativa para os {ids.length} registos selecionados. Os filtros e as regras de reentrada continuam a aplicar-se.</DialogDescription></DialogHeader>
        <div className="space-y-3 py-2">
          <Label htmlFor="manual-automation">Automação</Label>
          <Select value={flowId} onValueChange={setFlowId} disabled={pending || isLoading}>
            <SelectTrigger id="manual-automation"><SelectValue placeholder={isLoading ? 'A carregar…' : 'Escolher automação'} /></SelectTrigger>
            <SelectContent>{active.map(flow => <SelectItem key={flow.id} value={flow.id}>{flow.name}</SelectItem>)}</SelectContent>
          </Select>
          {!isLoading && active.length === 0 && <p className="text-sm text-muted-foreground">Ainda não há automações ativas.</p>}
          {ids.length > 100 && <p className="text-sm text-destructive">Selecione até 100 registos por execução.</p>}
          {selected && <p className="text-sm text-muted-foreground">Ao iniciar, os registos elegíveis entram na fila. Quando forem processados, a automação poderá executar ações e enviar as mensagens configuradas.</p>}
        </div>
        <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancelar</Button><Button type="button" disabled={pending || !selected || ids.length > 100} onClick={start}>{pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}{pending ? 'A agendar…' : `Iniciar para ${ids.length} registos`}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
