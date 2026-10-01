import { AlertTriangle, ChevronLeft, ChevronRight, Eye, EyeOff, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import type { AutomationRun, AutomationRunStatus } from '@/types/automations';

const RUN_STATUS: Record<AutomationRunStatus, { label: string; dot: string; text: string }> = {
  completed: { label: 'Concluída', dot: 'bg-success', text: 'text-success' },
  failed: { label: 'Falhou', dot: 'bg-destructive', text: 'text-destructive' },
  cancelled: { label: 'Parada', dot: 'bg-muted-foreground', text: 'text-muted-foreground' },
  running: { label: 'A correr', dot: 'bg-primary animate-pulse', text: 'text-primary' },
  waiting: { label: 'À espera', dot: 'bg-warning', text: 'text-warning' },
  awaiting_reply: { label: 'À espera de resposta', dot: 'bg-warning', text: 'text-warning' },
};

/**
 * Which execution the canvas is showing, as in n8n: its outcome, when, for
 * whom — and arrows to step through the earlier ones. With nothing picked it
 * follows the newest run, so a run that starts while the flow is open lights
 * up the canvas as it goes.
 */
export function ExecutionBar({
  runs, selectedRunId, onSelect, visible, onToggle, dirty,
}: {
  /** Newest first. */
  runs: AutomationRun[];
  /** null = follow the newest. */
  selectedRunId: string | null;
  onSelect: (runId: string | null) => void;
  visible: boolean;
  onToggle: () => void;
  /** Unsaved edits: real runs use the saved version, not what is on screen. */
  dirty: boolean;
}) {
  const index = selectedRunId ? runs.findIndex((r) => r.id === selectedRunId) : 0;
  const run = index >= 0 ? runs[index] : runs[0];
  const following = !selectedRunId;
  const meta = run ? RUN_STATUS[run.status] : null;
  const who = run ? (run.contact_name || run.contact_phone || run.contact_email || 'contacto') : '';
  const isTest = !!run?.context?.__test;

  const older = () => {
    const next = runs[(index >= 0 ? index : 0) + 1];
    if (next) onSelect(next.id);
  };
  const newer = () => {
    const i = index >= 0 ? index : 0;
    // Back at the newest: follow it again, so new runs keep showing up.
    if (i <= 1) onSelect(null);
    else onSelect(runs[i - 1].id);
  };

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-start gap-2">
      <div className="pointer-events-auto flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-border bg-card/95 px-3 py-2 text-xs shadow-sm backdrop-blur">
        {!run || !meta ? (
          <span className="text-muted-foreground">
            Ainda sem execuções. Carrega em <strong className="text-foreground">Testar</strong> ou espera pelo gatilho:
            cada passo que correr fica marcado aqui.
          </span>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', meta.dot)} />
              <span className={cn('font-semibold', meta.text)}>{meta.label}</span>
            </span>
            <span className="text-muted-foreground" title={run.started_at ? formatDateTime(run.started_at) : undefined}>
              {run.started_at ? formatRelativeTime(run.started_at) : ''} · {who}
            </span>
            {isTest && (
              <span className="rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-semibold text-primary">Teste</span>
            )}
            {following && (
              <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground" title="Mostra sempre a execução mais recente">
                <Radio className="h-3 w-3" /> Última
              </span>
            )}
            {run.status === 'failed' && run.last_error && (
              <span className="max-w-[260px] truncate text-destructive" title={run.last_error}>{run.last_error}</span>
            )}
            <span className="ml-auto flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={older}
                disabled={(index >= 0 ? index : 0) >= runs.length - 1}
                title="Execução anterior"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="min-w-[3.5rem] text-center tabular-nums text-muted-foreground">
                {(index >= 0 ? index : 0) + 1} de {runs.length}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={newer}
                disabled={following}
                title="Execução seguinte"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="ml-1 h-6 px-2 text-xs"
                onClick={onToggle}
                title={visible ? 'Voltar a ver o fluxo sem a execução' : 'Mostrar esta execução no fluxo'}
              >
                {visible ? <EyeOff className="mr-1 h-3.5 w-3.5" /> : <Eye className="mr-1 h-3.5 w-3.5" />}
                {visible ? 'Ocultar' : 'Mostrar'}
              </Button>
            </span>
          </>
        )}
      </div>

      {dirty && (
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-medium text-warning shadow-sm">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Alterações por guardar: as execuções correm a versão guardada.
        </div>
      )}
    </div>
  );
}
