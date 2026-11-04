import { useEffect, useMemo, useState } from "react";
import { Coffee, LogIn, LogOut, Pencil, Play, Loader2, MessageSquarePlus, History } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useCorrectEntry, useMyTimeClock, usePunch } from "@/hooks/useTimeClock";
import { usePermissions } from "@/hooks/usePermissions";
import { useLanguage } from "@/i18n";
import {
  ACTION_BUTTONS, ACTION_LABELS, STATE_LABELS, STATUS_LABELS, formatClock, formatDuration, getWorkday, timeClockError,
  type PunchAction, type TimeClockEntry,
} from "@/lib/timeclock";

const ACTION_ICONS: Record<PunchAction, typeof Play> = { start: LogIn, pause: Coffee, resume: Play, stop: LogOut };

/** Today, as a ticking clock: the state, the time worked, and the buttons that apply now. */
export function useWorkday() {
  const { data: entries = [], isLoading } = useMyTimeClock();
  const [now, setNow] = useState(() => new Date());
  const day = useMemo(() => getWorkday(entries, now), [entries, now]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), day.state === "working" ? 1000 : 30000);
    return () => window.clearInterval(id);
  }, [day.state]);
  return { ...day, entries, isLoading, now };
}

/** "HH:mm" today → ISO, or null when it is not a valid time. */
function todayAt(hhmm: string): string | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const d = new Date();
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.toISOString();
}

/**
 * The day's panel: shown in the top bar's clock and on the Ponto page.
 * Forgot to punch? A time with a reason is recorded and waits for approval.
 */
export function WorkdayPanel({ compact = false }: { compact?: boolean }) {
  const { t } = useLanguage();
  const day = useWorkday();
  const punch = usePunch();
  // An admin's own times are valid at once; everyone else's wait for an admin.
  const { isAdmin } = usePermissions();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTime, setManualTime] = useState("");
  const [busy, setBusy] = useState<PunchAction | null>(null);

  const run = async (action: PunchAction) => {
    const at = manualOpen ? todayAt(manualTime) : null;
    if (manualOpen && !at) { toast.error(t("Indique a hora.")); return; }
    if (manualOpen && note.trim().length < 3) { toast.error(t("Indique o motivo (pelo menos 3 caracteres).")); return; }
    setBusy(action);
    try {
      await punch.mutateAsync({ action, note: note.trim() || undefined, at: at ?? undefined });
      toast.success(manualOpen
        ? t(isAdmin ? "{{action}} registado às {{time}}." : "{{action}} registado às {{time}} — aguarda aprovação.", { action: t(ACTION_LABELS[action]), time: manualTime })
        : t("{{action}} registado.", { action: t(ACTION_LABELS[action]) }));
      setNote(""); setNoteOpen(false); setManualOpen(false); setManualTime("");
    } catch (e) {
      toast.error(timeClockError(e));
    } finally {
      setBusy(null);
    }
  };

  const stateLabel = day.state === "closed" && day.stoppedToday ? t("Dia terminado") : t(STATE_LABELS[day.state]);
  const today = day.session.length ? day.session : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full",
            day.state === "working" ? "bg-success animate-pulse" : day.state === "paused" ? "bg-warning" : "bg-muted-foreground/40")} aria-hidden="true" />
          <span className="text-sm font-semibold">{stateLabel}</span>
        </div>
        {(day.state !== "closed" || day.stoppedToday) && (
          <span className="font-mono text-lg font-semibold tabular-nums" title={t("Tempo de trabalho hoje")}>
            {formatDuration(day.workedMs, true)}
          </span>
        )}
      </div>
      {day.breakMs > 0 && <p className="-mt-2 text-xs text-muted-foreground">{t("Pausas: {{time}}", { time: formatDuration(day.breakMs) })}</p>}

      <div className={cn("grid gap-2", day.actions.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
        {day.actions.map(action => {
          const Icon = ACTION_ICONS[action];
          const label = action === "resume" && day.state === "closed" ? t("Retomar dia") : t(ACTION_BUTTONS[action]);
          return (
            <Button key={action} onClick={() => run(action)} disabled={!!busy || day.isLoading}
              variant={action === "stop" ? "outline" : "default"} className="h-11">
              {busy === action ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Icon className="mr-2 h-4 w-4" />}
              {busy === action ? t("A registar…") : label}
            </Button>
          );
        })}
      </div>

      {manualOpen && (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <label className="block text-xs font-medium" htmlFor="punch-manual-time">{t("A que horas?")}</label>
          <Input id="punch-manual-time" type="time" value={manualTime} onChange={e => setManualTime(e.target.value)} className="h-9 w-32" />
          {!isAdmin && <p className="text-xs text-muted-foreground">{t("Um registo com outra hora fica a aguardar aprovação.")}</p>}
        </div>
      )}
      {(noteOpen || manualOpen) && (
        <Textarea value={note} onChange={e => setNote(e.target.value.slice(0, 300))} rows={2}
          placeholder={manualOpen ? t("Motivo (obrigatório)") : t("Observação (opcional)")} className="text-sm" />
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {!noteOpen && !manualOpen && (
          <button type="button" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setNoteOpen(true)}>
            <MessageSquarePlus className="h-3.5 w-3.5" />{t("Adicionar observação")}
          </button>
        )}
        <button type="button" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          onClick={() => { setManualOpen(o => !o); setNoteOpen(false); }}>
          <History className="h-3.5 w-3.5" />{manualOpen ? t("Usar a hora atual") : t("Esqueceu-se de registar? Indique a hora")}
        </button>
      </div>

      {!compact && today.length > 0 && <TodayTimeline entries={day.entries.filter(e => e.punched_at >= today[0].punched_at)} />}
      {compact && today.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {today.map(e => `${t(ACTION_LABELS[e.action])} ${formatClock(e.punched_at)}`).join(" · ")}
        </p>
      )}
    </div>
  );
}

/** Today's entries, each with "Corrigir a hora". */
function TodayTimeline({ entries }: { entries: TimeClockEntry[] }) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("Registos de hoje")}</h3>
      <ol className="space-y-1.5">
        {entries.map(e => (
          <li key={e.id} className={cn("rounded-lg border px-3 py-2 text-sm", e.status === "voided" && "opacity-50 line-through")}>
            <div className="flex items-center gap-2">
              <span className="w-12 font-mono tabular-nums">{formatClock(e.punched_at)}</span>
              <span className="min-w-0 flex-1 truncate">{t(ACTION_LABELS[e.action])}</span>
              {e.status !== "valid" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">{t(STATUS_LABELS[e.status])}</span>}
              {e.status !== "voided" && (
                <button type="button" title={t("Corrigir a hora deste registo")} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setEditing(editing === e.id ? null : e.id)}>
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {e.employee_note && <p className="mt-1 text-xs text-muted-foreground">{e.employee_note}</p>}
            {editing === e.id && <CorrectTime entry={e} onDone={() => setEditing(null)} />}
          </li>
        ))}
      </ol>
    </div>
  );
}

function CorrectTime({ entry, onDone }: { entry: TimeClockEntry; onDone: () => void }) {
  const { t } = useLanguage();
  const correct = useCorrectEntry();
  const { isAdmin } = usePermissions();
  const [time, setTime] = useState(formatClock(entry.punched_at));
  const [reason, setReason] = useState("");
  const save = async () => {
    const at = todayAt(time);
    if (!at) { toast.error(t("Indique a hora.")); return; }
    try {
      await correct.mutateAsync({ entryId: entry.id, at, reason: reason.trim() });
      toast.success(isAdmin ? t("Hora corrigida.") : t("Hora corrigida — aguarda aprovação."));
      onDone();
    } catch (e) {
      toast.error(timeClockError(e));
    }
  };
  return (
    <div className="mt-2 space-y-2 border-t pt-2">
      <div className="flex items-center gap-2">
        <Input type="time" value={time} onChange={e => setTime(e.target.value)} className="h-8 w-28" />
        <Input value={reason} onChange={e => setReason(e.target.value.slice(0, 300))} placeholder={t("Motivo")} className="h-8 flex-1" />
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>{t("Cancelar")}</Button>
        <Button size="sm" onClick={save} disabled={correct.isPending}>{correct.isPending ? t("A guardar…") : t("Guardar")}</Button>
      </div>
    </div>
  );
}
