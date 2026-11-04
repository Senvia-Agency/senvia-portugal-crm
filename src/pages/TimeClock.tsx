import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarClock, CheckCheck, Clock3, FileSpreadsheet, History, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FinanceTabNav } from "@/components/finance/FinanceLayout";
import { WorkdayPanel } from "@/components/timeclock/WorkdayPanel";
import { MonthPicker, TimeClockDayList, currentMonth, monthRange, monthTotals } from "@/components/timeclock/TimeClockDayList";
import { HistoryTab, ReviewTab, SheetTab, TodayTab } from "@/components/timeclock/AdminTabs";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useTeamMembers } from "@/hooks/useTeam";
import { useMyTimeClock, usePendingTimeClock } from "@/hooks/useTimeClock";
import { formatDuration, summarizeDays } from "@/lib/timeclock";
import { useLanguage } from "@/i18n";

const TABS = [
  { key: "meu", label: "O meu ponto", icon: Clock3 },
  { key: "hoje", label: "Hoje", icon: Users },
  { key: "folha", label: "Folha de ponto", icon: FileSpreadsheet },
  { key: "revisao", label: "Revisão", icon: CheckCheck },
  { key: "historico", label: "Histórico", icon: History },
] as const;
type Tab = typeof TABS[number]["key"];

export default function TimeClock() {
  const { t } = useLanguage();
  const { isAdmin } = usePermissions();
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab") as Tab | null;
  const tab: Tab = isAdmin && asked && TABS.some(t => t.key === asked) ? asked : "meu";
  const { user, profile } = useAuth();
  const team = useTeamMembers();
  const pending = usePendingTimeClock(isAdmin);
  const members = useMemo(() => {
    const list = (team.data ?? []).map(m => ({ user_id: m.user_id, full_name: m.full_name || m.email || t("Colaborador") }));
    if (user && !list.some(m => m.user_id === user.id)) list.push({ user_id: user.id, full_name: profile?.full_name || t("Eu") });
    return list.sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [team.data, user, profile?.full_name, t]);

  return (
    <div className="crm-page">
      <div className="space-y-5 p-4 pb-nav-safe sm:p-6 lg:px-8 lg:py-7">
      <PageHeader icon={CalendarClock} className="mb-0" title={t("Ponto")} subtitle={isAdmin ? t("O seu dia e o controlo de ponto da equipa") : t("O seu dia de trabalho")} />
      {isAdmin && (
        <FinanceTabNav tabs={TABS.map(x => ({ ...x, label: t(x.label) }))} current={tab} badges={{ revisao: pending.data?.length ?? 0 }}
          onSelect={key => setParams(key === "meu" ? {} : { tab: key }, { replace: true })} />
      )}
      {tab === "meu" && <MyTab />}
      {tab === "hoje" && <TodayTab members={members} />}
      {tab === "folha" && <SheetTab members={members} />}
      {tab === "revisao" && <ReviewTab members={members} />}
      {tab === "historico" && <HistoryTab members={members} />}
      </div>
    </div>
  );
}

function MyTab() {
  const { t } = useLanguage();
  const [month, setMonth] = useState(currentMonth);
  const range = monthRange(month);
  const { data: entries = [], isLoading } = useMyTimeClock(range.fromIso, range.toIso);
  const days = useMemo(() => summarizeDays(entries), [entries]);
  const totals = monthTotals(days);
  const stats = [
    { label: t("Horas"), value: formatDuration(totals.workedMs) },
    { label: t("Dias com registo"), value: String(totals.days) },
    { label: t("Média por dia"), value: formatDuration(totals.averageMs) },
    { label: t("Incompletos"), value: String(totals.incomplete) },
  ];
  return (
    <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
      <Card className="h-fit">
        <CardHeader className="pb-3"><CardTitle className="text-base">{t("Hoje")}</CardTitle></CardHeader>
        <CardContent><WorkdayPanel /></CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
          <CardTitle className="text-base">{t("O meu mês")}</CardTitle>
          <MonthPicker month={month} onChange={setMonth} />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map(s => (
              <div key={s.label} className="rounded-xl border px-3 py-2.5">
                <p className="text-[11px] font-medium text-muted-foreground">{s.label}</p>
                <p className="text-lg font-semibold tabular-nums">{isLoading ? "…" : s.value}</p>
              </div>
            ))}
          </div>
          {isLoading ? <Skeleton className="h-48 w-full" /> : <TimeClockDayList days={days} />}
        </CardContent>
      </Card>
    </div>
  );
}
