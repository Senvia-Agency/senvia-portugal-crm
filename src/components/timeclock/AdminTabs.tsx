import { useMemo, useState } from "react";
import { subDays } from "date-fns";
import { toast } from "sonner";
import { Check, CheckCheck, Loader2, Plus, Printer, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminSetStatus, useOrgTimeClock, usePendingTimeClock, useTimeClockHistory } from "@/hooks/useTimeClock";
import { cn, matchesSearch } from "@/lib/utils";
import { printTimesheet } from "@/lib/timesheet-print";
import {
  ACTION_LABELS, formatClock, formatDuration, getWorkday, summarizeDays, timeClockError, type TimeClockEntry,
} from "@/lib/timeclock";
import { EntryDialog, type MemberOption } from "./EntryDialog";
import { HistoryList } from "./HistoryList";
import { intlLocale, useLanguage } from "@/i18n";
import { MonthPicker, TimeClockDayList, currentMonth, monthRange, monthTotals } from "./TimeClockDayList";

const byUser = (entries: TimeClockEntry[]) => {
  const map = new Map<string, TimeClockEntry[]>();
  for (const e of entries) map.set(e.user_id, [...(map.get(e.user_id) ?? []), e]);
  return map;
};

/** Hoje: who is working, on a pause, already gone, or not started. */
export function TodayTab({ members }: { members: MemberOption[] }) {
  const { t } = useLanguage();
  const from = useMemo(() => subDays(new Date(), 1).toISOString(), []);
  const to = useMemo(() => new Date(Date.now() + 3600_000).toISOString(), []);
  const { data: entries = [], isLoading } = useOrgTimeClock(from, to);
  const now = new Date();
  const perUser = byUser(entries);
  const rows = members.map(m => ({ member: m, day: getWorkday(perUser.get(m.user_id) ?? [], now) }));
  const groups = [
    { key: "working", title: t("A trabalhar"), tone: "bg-success", rows: rows.filter(r => r.day.state === "working") },
    { key: "paused", title: t("Em pausa"), tone: "bg-warning", rows: rows.filter(r => r.day.state === "paused") },
    { key: "gone", title: t("Já saíram"), tone: "bg-muted-foreground/50", rows: rows.filter(r => r.day.state === "closed" && r.day.stoppedToday) },
    { key: "not", title: t("Ainda não começaram"), tone: "bg-muted-foreground/25", rows: rows.filter(r => r.day.state === "closed" && !r.day.stoppedToday) },
  ];
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {groups.map(g => (
        <Card key={g.key}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <span className={cn("h-2.5 w-2.5 rounded-full", g.tone)} />{g.title}
              <span className="ml-auto text-muted-foreground">{g.rows.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {g.rows.length === 0 && <p className="text-xs text-muted-foreground">{t("Ninguém.")}</p>}
            {g.rows.map(({ member, day }) => (
              <div key={member.user_id} className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-sm">
                <span className="min-w-0 truncate">{member.full_name}</span>
                {day.last && (day.state !== "closed" || day.stoppedToday) && (
                  <span className="shrink-0 text-xs text-muted-foreground" title={t("{{action}} às {{time}}", { action: t(ACTION_LABELS[day.last.action]), time: formatClock(day.last.punched_at) })}>
                    {formatDuration(day.workedMs)} · {t("desde {{time}}", { time: formatClock(day.last.punched_at) })}
                  </span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Folha: the month per person, editable, and printable to sign. */
export function SheetTab({ members }: { members: MemberOption[] }) {
  const { t } = useLanguage();
  const { organization } = useAuth();
  const [month, setMonth] = useState(currentMonth);
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ entry: TimeClockEntry | null; userId?: string } | null>(null);
  const range = monthRange(month);
  const { data: entries = [], isLoading } = useOrgTimeClock(range.fromIso, range.toIso);
  const perUser = byUser(entries);
  const people = members
    .filter(m => matchesSearch(search, m.full_name))
    .map(m => ({ member: m, days: summarizeDays(perUser.get(m.user_id) ?? []) }))
    .sort((a, b) => Number(b.days.length > 0) - Number(a.days.length > 0) || a.member.full_name.localeCompare(b.member.full_name));

  const print = () => {
    const ok = printTimesheet({
      organizationName: organization?.name ?? "",
      logoUrl: organization?.logo_url,
      month: range.start,
      people: people.map(p => ({ name: p.member.full_name, entries: perUser.get(p.member.user_id) ?? [] })),
    });
    if (!ok) toast.error(t("O browser bloqueou a janela. Permita pop-ups para este site."));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <MonthPicker month={month} onChange={setMonth} />
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("Pesquisar colaborador")} className="h-9 rounded-full pl-9" />
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={print} disabled={isLoading}><Printer className="mr-1.5 h-4 w-4" />{t("Imprimir / PDF")}</Button>
          <Button onClick={() => setDialog({ entry: null })}><Plus className="mr-1.5 h-4 w-4" />{t("Novo registo")}</Button>
        </div>
      </div>
      {isLoading ? <Skeleton className="h-64 w-full" /> : people.map(({ member, days }) => {
        const totals = monthTotals(days);
        return (
          <Card key={member.user_id}>
            <CardHeader className="flex flex-row flex-wrap items-center gap-x-4 gap-y-1 pb-1">
              <CardTitle className="text-base">{member.full_name}</CardTitle>
              <span className="text-sm text-muted-foreground">
                {formatDuration(totals.workedMs)} · {t(totals.days === 1 ? "{{n}} dia" : "{{n}} dias", { n: totals.days })}
                {totals.incomplete > 0 && <> · <span className="text-destructive">{t(totals.incomplete === 1 ? "{{n}} incompleto" : "{{n}} incompletos", { n: totals.incomplete })}</span></>}
                {totals.pending > 0 && <> · <span className="text-amber-700">{t("{{n}} por aprovar", { n: totals.pending })}</span></>}
              </span>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setDialog({ entry: null, userId: member.user_id })}>
                <Plus className="mr-1 h-3.5 w-3.5" />{t("Registo", { context: "entry" })}
              </Button>
            </CardHeader>
            <CardContent>
              <TimeClockDayList days={days} onOpen={entry => setDialog({ entry })} />
            </CardContent>
          </Card>
        );
      })}
      <EntryDialog open={!!dialog} onOpenChange={o => !o && setDialog(null)} entry={dialog?.entry ?? null}
        defaultUserId={dialog?.userId} members={members} />
    </div>
  );
}

/** Revisão: entries waiting for approval (forgotten punches and corrected times), each decided on its own line. */
export function ReviewTab({ members }: { members: MemberOption[] }) {
  const { t } = useLanguage();
  const { data: pending = [], isLoading } = usePendingTimeClock();
  const setStatus = useAdminSetStatus();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const nameOf = (id: string) => members.find(m => m.user_id === id)?.full_name ?? t("Colaborador");

  const decide = async (ids: string[], status: "valid" | "voided", busy: string) => {
    setBusyId(busy);
    try {
      const n = await setStatus.mutateAsync({ entryIds: ids, status, reason: status === "voided" ? reason : undefined });
      toast.success(status === "valid" ? (n === 1 ? t("Registo aprovado.") : t("{{n}} registos aprovados.", { n })) : t("Registo rejeitado."));
      setRejecting(null); setReason("");
    } catch (e) {
      toast.error(timeClockError(e));
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (pending.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border bg-card py-12 text-center">
        <CheckCheck className="h-8 w-8 text-success" />
        <p className="text-sm font-medium">{t("Nada a aguardar aprovação")}</p>
        <p className="text-xs text-muted-foreground">{t("Os registos com outra hora e as correções aparecem aqui.")}</p>
      </div>
    );
  }
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">{t("A aguardar aprovação")}</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">{t(pending.length === 1 ? "{{n}} registo com hora indicada à mão ou corrigida." : "{{n}} registos com hora indicada à mão ou corrigida.", { n: pending.length })}</p>
        </div>
        {pending.length > 1 && (
          <Button size="sm" variant="outline" onClick={() => decide(pending.map(e => e.id), "valid", "all")} disabled={!!busyId}>
            {busyId === "all" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCheck className="mr-1.5 h-4 w-4" />}
            {t("Aprovar todos ({{n}})", { n: pending.length })}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {pending.map(e => {
          const name = nameOf(e.user_id);
          return (
            <div key={e.id} className="rounded-xl border p-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {name.trim().charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{name}</p>
                  <p className="text-sm text-muted-foreground">
                    {t(ACTION_LABELS[e.action])} {t("às")} <span className="font-medium text-foreground">{formatClock(e.punched_at)}</span>
                    {" · "}{new Date(e.punched_at).toLocaleDateString(intlLocale())}
                  </p>
                </div>
                {rejecting !== e.id && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => decide([e.id], "valid", e.id)} disabled={!!busyId}>
                      {busyId === e.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}{t("Aprovar")}
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive hover:text-destructive"
                      onClick={() => { setRejecting(e.id); setReason(""); }} disabled={!!busyId}>
                      <X className="mr-1 h-4 w-4" />{t("Rejeitar")}
                    </Button>
                  </div>
                )}
              </div>
              {e.employee_note && (
                <p className="mt-2 rounded-lg bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground sm:ml-12">“{e.employee_note}”</p>
              )}
              {rejecting === e.id && (
                <div className="mt-2 flex flex-wrap gap-2 sm:ml-12">
                  <Input autoFocus value={reason} onChange={ev => setReason(ev.target.value.slice(0, 300))}
                    onKeyDown={ev => { if (ev.key === "Enter" && reason.trim().length >= 3) void decide([e.id], "voided", e.id); }}
                    placeholder={t("Motivo da rejeição")} className="h-9 min-w-[12rem] flex-1" />
                  <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>{t("Cancelar")}</Button>
                  <Button size="sm" variant="destructive" onClick={() => decide([e.id], "voided", e.id)} disabled={reason.trim().length < 3 || !!busyId}>
                    {t("Rejeitar registo")}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** Histórico: every change in the last 30 days. */
export function HistoryTab({ members }: { members: MemberOption[] }) {
  const { t } = useLanguage();
  const from = useMemo(() => subDays(new Date(), 30).toISOString(), []);
  const { data = [], isLoading } = useTimeClockHistory(from);
  const [onlyAdmin, setOnlyAdmin] = useState(true);
  const rows = onlyAdmin ? data.filter(r => r.changed_by && r.changed_by !== r.user_id) : data;
  const nameOf = (id: string) => members.find(m => m.user_id === id)?.full_name ?? t("Colaborador");
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <Checkbox checked={onlyAdmin} onCheckedChange={c => setOnlyAdmin(!!c)} />{t("Só alterações de administradores")}
      </label>
      <HistoryList rows={rows} loading={isLoading} nameOf={nameOf} />
    </div>
  );
}
