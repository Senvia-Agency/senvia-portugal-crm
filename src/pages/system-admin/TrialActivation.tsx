import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Activity, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { AdminShell, AdminStatBand, AdminTableSkeleton, type AdminStat } from "@/components/system-admin/AdminShell";
import { useLanguage, tr, dateLocale } from "@/i18n";

// Mirrors public.trial_activation_overview (security_invoker view).
interface TrialRow {
  organization_id: string;
  name: string;
  created_at: string | null;
  trial_ends_at: string | null;
  plan: string | null;
  first_paid_at: string | null;
  current_period_end: string | null;
  last_active_at: string | null;
  first_lead_at: string | null;
  first_client_at: string | null;
  first_sale_at: string | null;
  first_proposal_at: string | null;
  trial_days_left: number | null;
  hours_since_active: number | null;
  is_paying: boolean;
  activated_min: boolean;
  activated_med: boolean;
  activated_adv: boolean;
  activation_level: "none" | "minimum" | "medium" | "advanced";
  trial_status: "active" | "expired" | "paying";
}

type Level = TrialRow["activation_level"];

const LEVEL_META: Record<Level, { label: string; badge: string; bar: string }> = {
  none: { label: "Sem atividade", badge: "bg-muted text-muted-foreground", bar: "bg-muted-foreground/25" },
  minimum: { label: "Mínimo", badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300", bar: "bg-amber-400" },
  medium: { label: "Médio (venda)", badge: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300", bar: "bg-blue-500" },
  advanced: { label: "Avançado", badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300", bar: "bg-emerald-500" },
};

const STUCK_HOURS = 48;

function fmtLastActive(hours: number | null): string {
  if (hours === null) return tr("nunca");
  if (hours < 1) return tr("agora mesmo");
  if (hours < 24) return tr("há {{n}}h", { n: hours });
  return tr("há {{n}}d", { n: Math.floor(hours / 24) });
}

function isStuck(r: TrialRow): boolean {
  return r.hours_since_active === null || r.hours_since_active >= STUCK_HOURS;
}

export default function SystemAdminTrialActivation() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { switchOrganization } = useAuth();
  const [onlyStuck, setOnlyStuck] = useState(false);

  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ["trial-activation-overview"],
    staleTime: 2 * 60 * 1000,
    retry: false,
    queryFn: async (): Promise<TrialRow[]> => {
      // View not in generated types yet — cast through any.
      const { data, error } = await (supabase as any)
        .from("trial_activation_overview")
        .select("*")
        .order("trial_ends_at", { ascending: true });
      if (error) throw error;
      return (data || []) as TrialRow[];
    },
  });

  const metrics = useMemo(() => {
    const active = rows.filter((r) => r.trial_status === "active");
    const expired = rows.filter((r) => r.trial_status === "expired");
    const paying = rows.filter((r) => r.is_paying);

    const reachedAha = active.filter((r) => r.activated_med).length;
    const stuck = active.filter(isStuck).length;

    // Honest conversion: of trials that already ended their journey (expired or
    // paying), how many pay? Active trials are still undecided, so excluded.
    const decided = expired.length + paying.length;
    const conversionRate = decided > 0 ? Math.round((paying.length / decided) * 100) : null;

    const funnel = {
      none: active.filter((r) => r.activation_level === "none").length,
      minimum: active.filter((r) => r.activation_level === "minimum").length,
      medium: active.filter((r) => r.activation_level === "medium").length,
      advanced: active.filter((r) => r.activation_level === "advanced").length,
    };

    return { active, activeCount: active.length, reachedAha, stuck, payingCount: paying.length, conversionRate, funnel };
  }, [rows]);

  const activeRows = useMemo(
    () => [...metrics.active].sort((a, b) => (a.trial_days_left ?? 999) - (b.trial_days_left ?? 999)),
    [metrics.active],
  );
  const displayedRows = useMemo(
    () => (onlyStuck ? activeRows.filter(isStuck) : activeRows),
    [activeRows, onlyStuck],
  );

  const handleAccess = (orgId: string) => {
    switchOrganization(orgId);
    navigate("/dashboard");
  };

  const stats: AdminStat[] = [
    { label: t("Trials ativos"), value: metrics.activeCount, loading: isLoading },
    {
      label: t("Chegaram ao aha"),
      value: metrics.reachedAha,
      tone: "primary",
      loading: isLoading,
      hint: metrics.activeCount > 0 ? t("{{pct}}% dos ativos", { pct: Math.round((metrics.reachedAha / metrics.activeCount) * 100) }) : t("primeira venda"),
    },
    {
      label: t("Parados +{{n}}h", { n: STUCK_HOURS }),
      value: metrics.stuck,
      tone: metrics.stuck > 0 ? "warning" : "default",
      loading: isLoading,
      hint: metrics.stuck > 0 ? t("precisam de toque") : t("tudo a mexer"),
    },
    {
      label: t("Conversão"),
      value: metrics.conversionRate === null ? "—" : `${metrics.conversionRate}%`,
      tone: "success",
      loading: isLoading,
      hint: t("{{n}} a pagar", { n: metrics.payingCount }),
    },
  ];

  return (
    <AdminShell
      title={t("Ativação de Trials")}
      description={t('Onde está cada trial no funil de ativação. O "aha" é a primeira venda registada.')}
      icon={Activity}
    >
      {isError ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground">
              {t("Não foi possível carregar os dados de ativação. A vista pode ainda não estar disponível na base de dados.")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <AdminStatBand stats={stats} />

          {/* Funil */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                {t("Funil de ativação")}{!isLoading && ` ${t("({{n}} trials ativos)", { n: metrics.activeCount })}`}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FunnelBar funnel={metrics.funnel} total={metrics.activeCount} loading={isLoading} />
            </CardContent>
          </Card>

          {/* Tabela */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
              <CardTitle className="text-sm">{t("Trials ativos")}</CardTitle>
              {!isLoading && (
                <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs">
                  <FilterTab active={!onlyStuck} onClick={() => setOnlyStuck(false)} label={t("Todos {{n}}", { n: activeRows.length })} />
                  <FilterTab active={onlyStuck} onClick={() => setOnlyStuck(true)} label={t("Parados +48h {{n}}", { n: metrics.stuck })} />
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <AdminTableSkeleton rows={5} cols={5} />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("Organização")}</TableHead>
                        <TableHead className="text-center">{t("Dias restantes")}</TableHead>
                        <TableHead className="text-center">{t("Nível")}</TableHead>
                        <TableHead className="hidden text-center sm:table-cell">{t("Sinais")}</TableHead>
                        <TableHead className="text-right">{t("Última atividade")}</TableHead>
                        <TableHead className="w-8" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayedRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                            {onlyStuck ? t("Nenhum trial parado há mais de 48h. 🎉") : t("Nenhum trial ativo de momento.")}
                          </TableCell>
                        </TableRow>
                      ) : (
                        displayedRows.map((r) => {
                          const stuck = isStuck(r);
                          const meta = LEVEL_META[r.activation_level];
                          return (
                            <TableRow
                              key={r.organization_id}
                              onClick={() => handleAccess(r.organization_id)}
                              title={t("Aceder a {{name}}", { name: r.name })}
                              className={cn("group cursor-pointer", stuck && "bg-amber-50/50 dark:bg-amber-950/20")}
                            >
                              <TableCell className="font-medium">{r.name}</TableCell>
                              <TableCell className="text-center">
                                <span className={cn("font-medium tabular-nums", (r.trial_days_left ?? 0) <= 3 && "text-destructive")}>
                                  {r.trial_days_left ?? "—"}
                                </span>
                                {r.trial_ends_at && (
                                  <span className="ml-1 hidden text-xs text-muted-foreground md:inline">
                                    ({format(new Date(r.trial_ends_at), "dd MMM", { locale: dateLocale() })})
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge variant="secondary" className={cn("border-transparent", meta.badge)}>{t(meta.label)}</Badge>
                              </TableCell>
                              <TableCell className="hidden text-center sm:table-cell">
                                <div className="flex items-center justify-center gap-1">
                                  <SignalDot on={!!r.first_lead_at} title={t("Leads")} letter="L" />
                                  <SignalDot on={!!r.first_client_at} title={t("Clientes")} letter="C" />
                                  <SignalDot on={!!r.first_sale_at} title={t("Vendas")} letter="V" />
                                  <SignalDot on={!!r.first_proposal_at} title={t("Propostas")} letter="P" />
                                </div>
                              </TableCell>
                              <TableCell className={cn("text-right", stuck ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                                {fmtLastActive(r.hours_since_active)}
                              </TableCell>
                              <TableCell className="text-right">
                                <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </AdminShell>
  );
}

function FilterTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 font-medium transition-colors",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function FunnelBar({ funnel, total, loading }: { funnel: Record<Level, number>; total: number; loading?: boolean }) {
  const { t } = useLanguage();
  // Progression order: none -> minimum -> medium -> advanced.
  const order: Level[] = ["none", "minimum", "medium", "advanced"];
  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {!loading && total > 0 &&
          order.map((k) =>
            funnel[k] > 0 ? (
              <div
                key={k}
                className={LEVEL_META[k].bar}
                style={{ width: `${(funnel[k] / total) * 100}%` }}
                title={`${t(LEVEL_META[k].label)}: ${funnel[k]}`}
              />
            ) : null,
          )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {order.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", LEVEL_META[k].bar)} />
            {t(LEVEL_META[k].label)}
            <span className="font-medium text-foreground tabular-nums">{loading ? "·" : funnel[k]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function SignalDot({ on, title, letter }: { on: boolean; title: string; letter: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
        on ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground/50",
      )}
    >
      {letter}
    </span>
  );
}
