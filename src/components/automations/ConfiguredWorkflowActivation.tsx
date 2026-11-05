import { Loader2, Play, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useConfiguredWorkflowActivation } from '@/hooks/useConfiguredWorkflowActivation';
import type { AutomationFlow } from '@/types/automations';

export function ConfiguredWorkflowActivation({
  flow,
  disabled = false,
}: Readonly<{
  flow: Pick<AutomationFlow, 'id' | 'name' | 'version' | 'updated_at'>;
  disabled?: boolean;
}>) {
  const activation = useConfiguredWorkflowActivation(flow);
  const busy = activation.state.status === 'preparing' || activation.state.status === 'activating';
  const preview = activation.state.status === 'awaiting_confirmation' || activation.state.status === 'activating'
    ? activation.state.preview
    : null;

  return (
    <AlertDialog onOpenChange={(open) => { if (!open && !busy) activation.cancel(); }}>
      <AlertDialogTrigger asChild>
        <Button type="button" size="sm" disabled={disabled || busy}>
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
          Rever e ativar
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rever ativação de “{flow.name}”</AlertDialogTitle>
          <AlertDialogDescription>
            O servidor calcula o impacto com os dados atuais. A confirmação expira em cinco minutos e deixa de valer se o fluxo mudar.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {(activation.state.status === 'idle' || activation.state.status === 'preparing') && (
          <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
            <p className="font-medium text-foreground">Nenhuma ação será executada nesta etapa.</p>
            <p className="mt-1 text-muted-foreground">A prévia exige sessão MFA e permissão de administrador para toda a organização.</p>
          </div>
        )}

        {preview && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-muted/40 p-3 text-center">
              <Metric label="Consultados" value={preview.scanned_records} />
              <Metric label="Elegíveis" value={preview.eligible_records} />
              <Metric label="Etapas" value={preview.eligible_stages} />
            </div>
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
              Estimativa máxima: até {preview.eligible_records} registos, sujeito às condições, esperas e revalidação imediatamente antes das ações.
            </p>
            <p className="text-xs text-muted-foreground">
              Observado em {preview.observed_local_date}, fuso {preview.time_zone}.
            </p>
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2 text-xs">
              {preview.stages.map((stage) => (
                <li key={stage.stage_id} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5">
                  <span className="truncate text-foreground">{stage.stage_id}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">até {stage.eligible_records}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(activation.state.status === 'failed' || activation.state.status === 'unknown') && (
          <Alert variant={activation.state.status === 'failed' ? 'destructive' : 'default'}>
            <TriangleAlert className="h-4 w-4" />
            <AlertTitle>{activation.state.status === 'failed' ? 'Ativação não preparada' : 'Resultado incerto'}</AlertTitle>
            <AlertDescription>{activation.state.message}</AlertDescription>
          </Alert>
        )}

        {activation.state.status === 'activated' && (
          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>Automação ativada</AlertTitle>
            <AlertDescription>O fluxo foi revalidado e ativado pelo servidor.</AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          {!busy && <AlertDialogCancel>Fechar</AlertDialogCancel>}
          {(activation.state.status === 'idle' || activation.state.status === 'failed') && (
            <Button type="button" onClick={() => void activation.prepare()}>
              <ShieldCheck className="mr-2 h-4 w-4" />
              Preparar prévia
            </Button>
          )}
          {activation.state.status === 'preparing' && <Button disabled><Loader2 className="mr-2 h-4 w-4 animate-spin" />A calcular</Button>}
          {activation.state.status === 'awaiting_confirmation' && (
            <Button type="button" onClick={() => void activation.confirm()}>
              <Play className="mr-2 h-4 w-4" />
              Confirmar ativação
            </Button>
          )}
          {activation.state.status === 'activating' && <Button disabled><Loader2 className="mr-2 h-4 w-4 animate-spin" />A ativar</Button>}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: number }>) {
  return <div><p className="text-lg font-semibold tabular-nums text-foreground">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>;
}
