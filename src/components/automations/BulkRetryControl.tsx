import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useRetryFailedAutomationRuns } from '@/hooks/useAutomationFlows';

export function BulkRetryControl({ flowId, failed, disabled = false }: {
  readonly flowId: string;
  readonly failed: number;
  readonly disabled?: boolean;
}) {
  const retry = useRetryFailedAutomationRuns();
  const summary = retry.data;
  return <div className="mt-4 space-y-3">
    {failed > 0 && <AlertDialog>
      <AlertDialogTrigger asChild><Button type="button" variant="outline" disabled={disabled || retry.isPending}><RotateCcw className="mr-2 h-4 w-4" />{retry.isPending ? 'A agendar…' : 'Repetir percursos falhados'}</Button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Agendar até {Math.min(failed, 100)} percursos falhados para repetir?</AlertDialogTitle>
          <AlertDialogDescription>O motor selecionará os percursos falhados mais recentes desta automação, até ao limite de 100. Os percursos elegíveis entram na fila e retomam no passo que falhou quando forem processados. Podem voltar a enviar mensagens. Confirme que a causa foi corrigida antes de continuar.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => retry.mutate(flowId)}>Agendar repetição</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>}
    {retry.isError && <p role="alert" className="text-sm text-destructive">Não foi possível agendar a repetição: {retry.error instanceof Error ? retry.error.message : 'Resposta inválida do motor.'}</p>}
    {summary && <div role="status" className="rounded-lg border p-3 text-sm">
      {summary.total === 0 ? <p>Não foram encontrados percursos falhados elegíveis.</p> : <>
        <p className="font-medium">Pedidos de repetição: {summary.total}.</p>
        <p className="mt-1 text-muted-foreground">Agendados para repetir: {summary.queued} · Concluídos: {summary.completed} · Ainda ativos: {summary.active} · Voltaram a falhar: {summary.failed} · Não iniciados: {summary.refused}</p>
        {summary.unknown > 0 && <p className="mt-1 text-muted-foreground">Sem estado confirmado: {summary.unknown}. Consulte a atividade para acompanhar o resultado.</p>}
      </>}
    </div>}
  </div>;
}
