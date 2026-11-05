import { useState } from 'react';
import { Eye, Loader2, Play, ShieldCheck, TriangleAlert } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  useConfiguredWorkflowManual,
  type ConfiguredWorkflowManualState,
} from '@/hooks/useConfiguredWorkflowManual';

type ManualRunViewProps = Readonly<{
  state: ConfiguredWorkflowManualState;
  disabled?: boolean;
  onPrepare: () => void | Promise<void>;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  onReviewExecutions?: () => void;
}>;

export function ConfiguredWorkflowManualRun({
  flowId,
  disabled = false,
  onReviewExecutions,
}: Readonly<{
  flowId: string;
  disabled?: boolean;
  onReviewExecutions?: () => void;
}>) {
  const manual = useConfiguredWorkflowManual(flowId);
  return (
    <ConfiguredWorkflowManualRunView
      state={manual.state}
      disabled={disabled}
      onPrepare={manual.prepare}
      onConfirm={manual.confirm}
      onCancel={manual.cancelConfirmation}
      onReviewExecutions={onReviewExecutions}
    />
  );
}

export function ConfiguredWorkflowManualRunView({
  state,
  disabled = false,
  onPrepare,
  onConfirm,
  onCancel,
  onReviewExecutions,
}: ManualRunViewProps) {
  const [open, setOpen] = useState(false);
  const busy = state.status === 'preparing' || state.status === 'running';

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen && busy) return;
    if (!nextOpen && state.status === 'awaiting_confirmation') onCancel();
    setOpen(nextOpen);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled || busy}
        onClick={() => setOpen(true)}
      >
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
        {manualRunButtonLabel(state)}
      </Button>

      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">{manualRunTitle(state)}</AlertDialogTitle>
            <AlertDialogDescription>
              {manualRunDescription(state)}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {(state.status === 'idle' || state.status === 'failed') && (
            <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-foreground">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="space-y-1">
                  <p className="font-medium">Prévia do impacto</p>
                  <p className="leading-relaxed text-muted-foreground">
                    O fluxo consultará os registos atuais e poderá iniciar as ações configuradas,
                    incluindo envios. Nenhuma ação acontece até confirmar no passo seguinte.
                  </p>
                </div>
              </div>
            </div>
          )}

          {state.status === 'failed' && (
            <Alert variant="destructive">
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>
                {state.phase === 'prepare' ? 'Não foi possível preparar a execução' : 'Execução rejeitada'}
              </AlertTitle>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          )}

          {state.status === 'unknown' && (
            <Alert>
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>Resultado incerto</AlertTitle>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          )}

          {state.status === 'completed' && (
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-muted/40 p-3 text-center">
              <SummaryMetric label="Consultados" value={state.summary.scanned} />
              <SummaryMetric label="Iniciados" value={state.summary.started} />
              <SummaryMetric label="Ignorados" value={state.summary.skipped} />
              {state.summary.errors.length > 0 && (
                <p className="col-span-3 mt-1 text-sm text-destructive">
                  {state.summary.errors.length} erro(s) registado(s). Consulte as execuções.
                </p>
              )}
            </div>
          )}

          <AlertDialogFooter>
            {!busy && <AlertDialogCancel>Fechar</AlertDialogCancel>}
            {(state.status === 'idle' || state.status === 'failed') && (
              <Button
                type="button"
                className="bg-action text-background hover:bg-action/90"
                onClick={() => void onPrepare()}
              >
                <ShieldCheck className="mr-2 h-4 w-4" />
                Preparar confirmação
              </Button>
            )}
            {state.status === 'preparing' && (
              <Button type="button" disabled>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                A preparar
              </Button>
            )}
            {state.status === 'awaiting_confirmation' && (
              <Button
                type="button"
                className="bg-action text-background hover:bg-action/90"
                onClick={() => void onConfirm()}
              >
                <Play className="mr-2 h-4 w-4" />
                Confirmar e executar
              </Button>
            )}
            {state.status === 'running' && (
              <Button type="button" disabled>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                A executar
              </Button>
            )}
            {(state.status === 'unknown' || state.status === 'completed') && onReviewExecutions && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setOpen(false);
                  onReviewExecutions();
                }}
              >
                Ver execuções
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function manualRunButtonLabel(state: ConfiguredWorkflowManualState): string {
  switch (state.status) {
    case 'idle': return 'Pré-visualizar execução';
    case 'preparing': return 'A preparar confirmação';
    case 'awaiting_confirmation': return 'Continuar execução';
    case 'running': return 'A executar';
    case 'completed': return 'Ver resultado';
    case 'failed': return state.phase === 'prepare' ? 'Rever execução' : 'Ver rejeição';
    case 'unknown': return 'Ver estado da execução';
  }
}

function manualRunTitle(state: ConfiguredWorkflowManualState): string {
  switch (state.status) {
    case 'awaiting_confirmation': return 'Confirmar execução manual?';
    case 'running': return 'Execução em curso';
    case 'completed': return 'Execução iniciada';
    case 'unknown': return 'Confirme o resultado nas execuções';
    case 'failed': return state.phase === 'prepare' ? 'Executar este fluxo agora?' : 'A execução foi rejeitada';
    default: return 'Executar este fluxo agora?';
  }
}

function manualRunDescription(state: ConfiguredWorkflowManualState): string {
  switch (state.status) {
    case 'awaiting_confirmation':
      return `A confirmação é única, válida até ${formatConfirmationExpiry(state.expiresAt)} e só serve para este fluxo. O próximo clique inicia a execução.`;
    case 'preparing':
      return 'A validar a sua sessão, MFA, organização e permissões de administrador.';
    case 'running':
      return 'Não feche esta janela até receber o resultado.';
    case 'completed':
      return 'O motor terminou a consulta e registou o resultado abaixo.';
    case 'unknown':
      return 'A resposta perdeu-se depois do pedido. Não repita a execução sem consultar o histórico.';
    default:
      return 'Reveja o impacto antes de pedir a confirmação segura ao servidor.';
  }
}

function formatConfirmationExpiry(expiresAt: string): string {
  return new Intl.DateTimeFormat('pt-PT', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(expiresAt));
}

function SummaryMetric({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div>
      <p className="text-lg font-semibold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
