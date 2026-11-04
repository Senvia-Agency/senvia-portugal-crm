import { addMonths, endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import { dateLocale, useLanguage } from "@/i18n";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ACTION_LABELS, STATUS_LABELS, formatClock, formatDuration, type DaySummary, type TimeClockEntry } from "@/lib/timeclock";

/** "2026-11" → the month's bounds as ISO strings (local time). */
export function monthRange(month: string) {
  const start = startOfMonth(parseISO(`${month}-01`));
  return { start, fromIso: start.toISOString(), toIso: addMonths(start, 1).toISOString(), end: endOfMonth(start) };
}

export const currentMonth = () => format(new Date(), "yyyy-MM");

export function MonthPicker({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const { t } = useLanguage();
  const start = parseISO(`${month}-01`);
  const label = format(start, "MMMM yyyy", { locale: dateLocale() });
  return (
    <div className="flex items-center gap-1 rounded-full border bg-card p-1 shadow-sm">
      <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full" aria-label={t("Mês anterior")}
        onClick={() => onChange(format(addMonths(start, -1), "yyyy-MM"))}><ChevronLeft className="h-4 w-4" /></Button>
      <span className="min-w-[8.5rem] text-center text-sm font-medium capitalize">{label}</span>
      <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full" aria-label={t("Mês seguinte")} disabled={month >= currentMonth()}
        onClick={() => onChange(format(addMonths(start, 1), "yyyy-MM"))}><ChevronRight className="h-4 w-4" /></Button>
    </div>
  );
}

export function monthTotals(days: DaySummary[]) {
  const workedMs = days.reduce((sum, d) => sum + d.workedMs, 0);
  const counted = days.filter(d => d.workedMs > 0).length;
  return {
    workedMs,
    days: counted,
    averageMs: counted ? workedMs / counted : 0,
    incomplete: days.filter(d => d.incomplete).length,
    pending: days.filter(d => d.pending).length,
  };
}

/** Day by day: the entries as chips, then the hours. A chip opens the entry when `onOpen` is given. */
export function TimeClockDayList({ days, onOpen }: { days: DaySummary[]; onOpen?: (entry: TimeClockEntry) => void }) {
  const { t } = useLanguage();
  if (days.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{t("Sem registos neste mês.")}</p>;
  return (
    <ul className="divide-y">
      {days.map(day => (
        <li key={day.day} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:gap-4">
          <span className="w-24 shrink-0 text-sm font-medium capitalize">{format(parseISO(day.day), "EEE dd/MM", { locale: dateLocale() })}</span>
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {day.entries.map(e => {
              const chip = (
                <>
                  <span className="font-mono tabular-nums">{formatClock(e.punched_at)}</span>
                  <span className="text-muted-foreground">{t(ACTION_LABELS[e.action])}</span>
                  {e.source === "admin" && <span title={t("Registado por um administrador")}>*</span>}
                </>
              );
              const cls = cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                e.status === "pending" && "border-amber-300 bg-amber-50 text-amber-900",
                e.status === "voided" && "line-through opacity-50");
              const title = [t(STATUS_LABELS[e.status]), e.employee_note, e.admin_note].filter(Boolean).join(" · ");
              return onOpen
                ? <button key={e.id} type="button" title={title} onClick={() => onOpen(e)} className={cn(cls, "hover:border-primary/50 hover:bg-primary/5")}>{chip}</button>
                : <span key={e.id} title={title} className={cls}>{chip}</span>;
            })}
          </div>
          <div className="flex shrink-0 items-center gap-2 text-sm sm:w-40 sm:justify-end">
            {day.open && <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] text-success">{t("Em curso")}</span>}
            {day.incomplete && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">{t("Incompleto")}</span>}
            <span className="font-semibold tabular-nums">{formatDuration(day.workedMs)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
