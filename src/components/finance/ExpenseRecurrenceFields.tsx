import { CalendarClock, PauseCircle, RefreshCw } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import {
  MONTH_LABELS,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_FREQUENCY_LABELS,
  WEEKDAY_LABELS,
  describeSchedule,
  maxDueDay,
  shortMonthNote,
  withFrequency,
  type RecurrenceSchedule,
} from '@/lib/expense-recurrence';

interface ExpenseRecurrenceFieldsProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  schedule: RecurrenceSchedule;
  onScheduleChange: (schedule: RecurrenceSchedule) => void;
  /** The expense's own date: defaults and the quarter's starting month follow it. */
  date: Date;
  /** Next booking already scheduled, when editing an expense that recurs. */
  nextScheduled?: string | null;
  /** The saved schedule of a paused expense: switching on resumes it. */
  paused?: RecurrenceSchedule | null;
  /** Paused only: remove the recurrence for good when saving. */
  forget?: boolean;
  onForgetChange?: (forget: boolean) => void;
}

/** "Recorrência" section of the expense forms: how often, and the due day. */
export function ExpenseRecurrenceFields({
  enabled,
  onEnabledChange,
  schedule,
  onScheduleChange,
  date,
  nextScheduled,
  paused,
  forget = false,
  onForgetChange,
}: ExpenseRecurrenceFieldsProps) {
  const note = shortMonthNote(schedule);
  const days = Array.from({ length: maxDueDay(schedule.frequency, schedule.month) }, (_, i) => i + 1);

  const setMonth = (month: number) =>
    onScheduleChange({ ...schedule, month, day: Math.min(schedule.day, maxDueDay('yearly', month)) });

  return (
    <section className="space-y-5 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <RefreshCw className="h-4 w-4 text-primary" />
            Recorrência
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            A despesa volta a ser lançada sozinha, sempre no dia de vencimento.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} aria-label="Despesa recorrente" />
      </div>

      {!enabled && paused && (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-3">
          <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 text-xs text-foreground">
            {forget ? (
              <>
                <p className="font-medium">A recorrência é removida ao guardar.</p>
                <p className="mt-0.5 text-muted-foreground">A despesa fica como uma despesa normal.</p>
              </>
            ) : (
              <>
                <p className="font-medium">Em pausa · {describeSchedule(paused)}</p>
                <p className="mt-0.5 text-muted-foreground">
                  Liga a recorrência para retomar: volta no vencimento seguinte, sem os períodos em pausa.
                </p>
              </>
            )}
            {onForgetChange && (
              <button
                type="button"
                onClick={() => onForgetChange(!forget)}
                className="mt-2 text-xs font-medium text-primary hover:underline"
              >
                {forget ? 'Manter em pausa' : 'Remover a recorrência'}
              </button>
            )}
          </div>
        </div>
      )}

      {enabled && (
        <>
          <div className="space-y-2">
            <Label>Repete</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {RECURRENCE_FREQUENCIES.map((frequency) => (
                <button
                  key={frequency}
                  type="button"
                  onClick={() => onScheduleChange(withFrequency(schedule, frequency, date))}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    schedule.frequency === frequency
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted',
                  )}
                >
                  {RECURRENCE_FREQUENCY_LABELS[frequency]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Vence</Label>
            {schedule.frequency === 'weekly' ? (
              <Select value={String(schedule.day)} onValueChange={(v) => onScheduleChange({ ...schedule, day: Number(v) })}>
                <SelectTrigger aria-label="Dia da semana">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAY_LABELS.map((label, i) => (
                    <SelectItem key={label} value={String(i + 1)}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">Dia</span>
                <Select value={String(schedule.day)} onValueChange={(v) => onScheduleChange({ ...schedule, day: Number(v) })}>
                  <SelectTrigger className="w-24" aria-label="Dia de vencimento">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {days.map((day) => (
                      <SelectItem key={day} value={String(day)}>{day}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {schedule.frequency === 'yearly' ? (
                  <>
                    <span className="text-sm text-muted-foreground">de</span>
                    <Select value={String(schedule.month ?? date.getMonth() + 1)} onValueChange={(v) => setMonth(Number(v))}>
                      <SelectTrigger className="w-40" aria-label="Mês de vencimento">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MONTH_LABELS.map((label, i) => (
                          <SelectItem key={label} value={String(i + 1)}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {schedule.frequency === 'quarterly'
                      ? `de 3 em 3 meses, a contar de ${MONTH_LABELS[date.getMonth()]}`
                      : 'de cada mês'}
                  </span>
                )}
              </div>
            )}
            {note && <p className="text-xs text-muted-foreground">{note}</p>}
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-3">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="text-xs text-foreground">
              <p className="font-medium">{describeSchedule(schedule)}</p>
              <p className="mt-0.5 text-muted-foreground">
                {nextScheduled
                  ? `Próximo lançamento agendado: ${formatDate(nextScheduled)}. Muda se alterares a recorrência.`
                  : 'Esta despesa conta como a do seu período; a próxima é lançada no vencimento seguinte, nunca numa data já passada.'}
              </p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
