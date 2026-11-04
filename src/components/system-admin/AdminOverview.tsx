import { useMemo } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { Euro, CreditCard, Sparkles, AlertTriangle, TrendingUp, TrendingDown, Clock, CreditCard as CardIcon, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { OrgStripeData } from "@/components/system-admin/OrganizationsTable";
import { classifyOrg, BUCKET_META, type OrgBucket } from "@/components/system-admin/orgStatus";
import type { OrgFilter } from "@/components/system-admin/OrganizationsTable";
import { useLanguage, intlLocale } from "@/i18n";

const ORDER: OrgBucket[] = ["paying", "trial", "overdue", "blocked", "expired", "canceled", "exempt"];

export interface OverviewOrg {
  id: string;
  plan: string | null;
  trial_ends_at: string | null;
  billing_exempt: boolean | null;
  created_at: string | null;
  first_paid_at: string | null;
  current_period_end: string | null;
  payment_failed_at: string | null;
}

interface AdminOverviewProps {
  organizations: OverviewOrg[];
  stripeStats?: { mrr: number; paying_count: number; total_subscriptions: number; org_stats: OrgStripeData[] } | null;
  loading?: boolean;
  /** Focus the organizations list on a bucket. Renders the attention strip,
   *  and makes each metric card click through to what it counts. */
  onFocus?: (filter: OrgFilter) => void;
  /** Sidebar mode (dashboard, xl and up): the overview becomes a flex column
   *  that fills its container; cards shrink, chart and status stack, and the
   *  chart is the one elastic block — it takes whatever height is left, so
   *  the column fits the viewport without scrolling. */
  sidebar?: boolean;
}

function inMonth(date: string | null | undefined, ref: Date): boolean {
  if (!date) return false;
  const d = new Date(date);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

function capMonth(d: Date): string {
  const s = d.toLocaleDateString(intlLocale(), { month: "short" }).replace(".", "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function AdminOverview({ organizations, stripeStats, loading, onFocus, sidebar }: AdminOverviewProps) {
  // A fresh Date() on every render invalidated the memo below on every render.
  // Minute precision is plenty for "days until trial ends".
  const now = useMemo(() => new Date(), []);
  const { t, language } = useLanguage();

  const stripeMap = useMemo(() => {
    const m = new Map<string, OrgStripeData>();
    (stripeStats?.org_stats || []).forEach((s) => m.set(s.org_id, s));
    return m;
  }, [stripeStats]);

  const { buckets, trialExpiringSoon, monthly, newPayingThisMonth, newPayingLastMonth, newOrgsDelta, mrrAddedThisMonth } = useMemo(() => {
    const counts: Record<OrgBucket, number> = { paying: 0, trial: 0, overdue: 0, blocked: 0, expired: 0, canceled: 0, exempt: 0 };
    let trialExpiringSoon = 0;

    for (const o of organizations) {
      const b = classifyOrg(o, stripeMap.get(o.id)?.stripe_status, now);
      counts[b]++;
      if (b === "trial" && o.trial_ends_at) {
        const days = (new Date(o.trial_ends_at).getTime() - now.getTime()) / 86400000;
        if (days <= 3) trialExpiringSoon++;
      }
    }

    // New orgs per month, last 6 months.
    const monthly: { label: string; value: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth();
      const value = organizations.filter((o) => {
        if (!o.created_at) return false;
        const c = new Date(o.created_at);
        return c.getFullYear() === y && c.getMonth() === m;
      }).length;
      monthly.push({ label: capMonth(d), value });
    }

    // Movement, so the numbers stop reading as a printed report.
    const thisMonth = now;
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    let newPayingThisMonth = 0;
    let newPayingLastMonth = 0;
    let mrrAddedThisMonth = 0;
    for (const o of organizations) {
      if (inMonth(o.first_paid_at, thisMonth)) {
        newPayingThisMonth++;
        mrrAddedThisMonth += stripeMap.get(o.id)?.stripe_amount ?? 0;
      } else if (inMonth(o.first_paid_at, lastMonth)) {
        newPayingLastMonth++;
      }
    }
    const newOrgsDelta = (monthly[5]?.value ?? 0) - (monthly[4]?.value ?? 0);

    return { buckets: counts, trialExpiringSoon, monthly, newPayingThisMonth, newPayingLastMonth, newOrgsDelta, mrrAddedThisMonth };
  }, [organizations, stripeMap, now, language]);

  const mrr = stripeStats?.mrr ?? 0;
  const arr = mrr * 12;
  const activeTotal = buckets.paying + buckets.trial + buckets.overdue + buckets.blocked;
  const payingPct = activeTotal > 0 ? Math.round((buckets.paying / activeTotal) * 100) : 0;
  const barTotal = buckets.paying + buckets.trial + buckets.overdue + buckets.blocked + buckets.expired + buckets.canceled;
  const chartHeight = 220;

  const attention = onFocus
    ? [
        trialExpiringSoon > 0 && {
          key: "trial" as const,
          icon: Clock,
          label: t(trialExpiringSoon === 1 ? "{{n}} trial expira em ≤3 dias" : "{{n}} trials expiram em ≤3 dias", { n: trialExpiringSoon }),
          tone: "amber",
        },
        buckets.overdue + buckets.blocked > 0 && {
          key: "overdue" as const,
          icon: CardIcon,
          label: t("{{n}} com pagamento em falha", { n: buckets.overdue + buckets.blocked }),
          tone: "red",
        },
        buckets.expired > 0 && {
          key: "expired" as const,
          icon: AlertTriangle,
          label: t(buckets.expired === 1 ? "{{n}} trial expirado por converter" : "{{n}} trials expirados por converter", { n: buckets.expired }),
          tone: "amber",
        },
      ].filter(Boolean as unknown as (v: unknown) => boolean)
    : [];

  return (
    <div className={cn("space-y-6", sidebar && "xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:gap-3 xl:space-y-0")}>
      {/* What needs you today. Absent when nothing does. */}
      {!loading && attention.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(attention as { key: "trial" | "overdue" | "expired"; icon: typeof Clock; label: string; tone: string }[]).map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => onFocus?.(a.key)}
              className={cn(
                "group inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                a.tone === "red"
                  ? "border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10"
                  : "border-amber-500/30 bg-amber-500/5 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400",
              )}
            >
              <a.icon className="h-3.5 w-3.5 shrink-0" />
              {a.label}
              <ArrowRight className="h-3.5 w-3.5 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
            </button>
          ))}
        </div>
      )}

      {/* Metric cards */}
      <div className={cn("grid grid-cols-2 gap-4 lg:grid-cols-4", sidebar && "xl:grid-cols-2 xl:gap-3")}>
        {/* Each card opens the list filtered to exactly what it counted —
            a number nobody can act on is only half the information. MRR
            comes from the paying accounts, so it points there. */}
        <MetricCard
          label="MRR"
          value={`€${mrr.toLocaleString("pt-PT")}`}
          subtitle={`≈ €${arr.toLocaleString("pt-PT")} ARR`}
          delta={mrrAddedThisMonth > 0 ? { value: `+€${mrrAddedThisMonth.toLocaleString("pt-PT")}`, up: true, note: t("novos este mês") } : undefined}
          icon={<Euro className="h-4 w-4" />}
          loading={loading}
          compact={sidebar}
          onClick={onFocus && buckets.paying > 0 ? () => onFocus("paying") : undefined}
        />
        <MetricCard
          label={t("Clientes a pagar")}
          value={buckets.paying}
          subtitle={activeTotal > 0 ? t("{{pct}}% das contas ativas", { pct: payingPct }) : t("sem contas ativas")}
          delta={
            newPayingThisMonth > 0 || newPayingLastMonth > 0
              ? {
                  value: `${newPayingThisMonth >= newPayingLastMonth ? "+" : ""}${newPayingThisMonth - newPayingLastMonth}`,
                  up: newPayingThisMonth >= newPayingLastMonth,
                  note: t("{{now}} este mês vs {{before}}", { now: newPayingThisMonth, before: newPayingLastMonth }),
                }
              : undefined
          }
          icon={<CreditCard className="h-4 w-4" />}
          tone="success"
          loading={loading}
          compact={sidebar}
          onClick={onFocus && buckets.paying > 0 ? () => onFocus("paying") : undefined}
        />
        <MetricCard
          label={t("Em trial")}
          value={buckets.trial}
          subtitle={trialExpiringSoon > 0 ? t("{{n}} expiram em ≤3 dias", { n: trialExpiringSoon }) : t("a converter")}
          icon={<Sparkles className="h-4 w-4" />}
          loading={loading}
          compact={sidebar}
          onClick={onFocus && buckets.trial > 0 ? () => onFocus("trial") : undefined}
        />
        <MetricCard
          label={t("Trials expirados")}
          value={buckets.expired}
          subtitle={t("nunca converteram")}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={buckets.expired > 0 ? "danger" : "default"}
          loading={loading}
          compact={sidebar}
          onClick={onFocus && buckets.expired > 0 ? () => onFocus("expired") : undefined}
        />
      </div>

      {/* Chart + subscription status */}
      <div className={cn("grid gap-4 lg:grid-cols-3", sidebar && "xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:gap-3")}>
        <Card className={cn("lg:col-span-2", sidebar && "xl:flex xl:min-h-0 xl:flex-1 xl:flex-col")}>
          <CardHeader className={cn("pb-2", sidebar && "xl:px-4 xl:pt-4")}>
            <CardTitle className="text-sm">{t("Novas empresas por mês")}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {t("Últimos 6 meses")}
              {!loading && newOrgsDelta !== 0 && (
                <span className={cn("ml-1.5 font-medium", newOrgsDelta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                  {newOrgsDelta > 0 ? "+" : ""}{t("{{n}} vs mês anterior", { n: newOrgsDelta })}
                </span>
              )}
            </p>
          </CardHeader>
          <CardContent className={cn(sidebar && "xl:min-h-0 xl:flex-1 xl:px-4 xl:pb-4")}>
            {loading ? (
              <Skeleton className={cn("w-full", sidebar && "xl:h-full")} style={{ height: sidebar ? undefined : chartHeight }} />
            ) : (
              // Fixed 220px pushed the sidebar below the fold on a laptop; as a
              // sidebar the chart fills whatever height the column has left.
              <div className={cn(sidebar && "xl:h-full xl:min-h-[80px]")} style={{ height: sidebar ? undefined : chartHeight }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} className="stroke-border" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                  <YAxis allowDecimals={false} width={32} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                  <Tooltip
                    cursor={{ className: "fill-muted" }}
                    contentStyle={{
                      borderRadius: 10,
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--card))",
                      color: "hsl(var(--card-foreground))",
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "hsl(var(--card-foreground))", fontWeight: 600 }}
                    formatter={(v: number) => [`${v}`, t("Novas")]}
                  />
                  <Bar dataKey="value" className="fill-primary" radius={[6, 6, 0, 0]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className={cn(sidebar && "xl:shrink-0")}>
          <CardHeader className={cn("pb-2", sidebar && "xl:px-4 xl:pt-4")}>
            <CardTitle className="text-sm">{t("Estado das subscrições")}</CardTitle>
            <p className="text-xs text-muted-foreground">{t("Distribuição atual")}</p>
          </CardHeader>
          <CardContent className={cn(sidebar && "xl:px-4 xl:pb-4")}>
            {loading ? (
              <div className="space-y-4">
                <Skeleton className="h-2.5 w-full rounded-full" />
                <div className="grid grid-cols-2 gap-3">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
                </div>
              </div>
            ) : (
              <>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  {barTotal > 0 &&
                    ORDER.filter((k) => k !== "exempt").map((k) =>
                      buckets[k] > 0 ? (
                        <div
                          key={k}
                          className={BUCKET_META[k].dot}
                          style={{ width: `${(buckets[k] / barTotal) * 100}%` }}
                          title={`${t(BUCKET_META[k].label)}: ${buckets[k]}`}
                        />
                      ) : null,
                    )}
                </div>
                <div className={cn("mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5", sidebar && "xl:mt-3 xl:gap-y-1.5")}>
                  {ORDER.map((k) => (
                    <div key={k} className="flex items-center gap-2 text-sm">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", BUCKET_META[k].dot)} />
                      <span className="flex-1 text-muted-foreground">{t(BUCKET_META[k].label)}</span>
                      <span className="font-medium tabular-nums text-foreground">{buckets[k]}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({
  label, value, subtitle, icon, tone = "default", loading, delta, onClick, compact,
}: {
  label: string;
  value: React.ReactNode;
  subtitle?: string;
  icon?: React.ReactNode;
  tone?: "default" | "success" | "danger";
  loading?: boolean;
  delta?: { value: string; up: boolean; note?: string };
  /** Absent when the card counts nothing — then it stays a plain box. */
  onClick?: () => void;
  /** Narrow-column variant: less padding, smaller number (xl and up). */
  compact?: boolean;
}) {
  const toneClass = tone === "success" ? "text-emerald-600 dark:text-emerald-400" : tone === "danger" ? "text-destructive" : "text-foreground";
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn(
        "rounded-xl border bg-card p-5 text-left",
        compact && "xl:p-4",
        onClick && "group cursor-pointer transition-colors hover:border-primary/40 hover:bg-accent/40",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        {icon ? (
          <span className="text-muted-foreground/50">{icon}</span>
        ) : null}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-9 w-24" />
      ) : (
        <div className={cn("mt-2 text-3xl font-semibold tracking-tight tabular-nums", compact && "xl:mt-1 xl:text-2xl", toneClass)}>{value}</div>
      )}
      {!loading && delta && (
        <div className="mt-1.5 flex items-center gap-1 text-xs">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium",
              delta.up ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
            )}
          >
            {delta.up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {delta.value}
          </span>
          {delta.note && <span className="text-muted-foreground">{delta.note}</span>}
        </div>
      )}
      {subtitle && !loading && (
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          {subtitle}
          {onClick && (
            <ArrowRight className="h-3 w-3 shrink-0 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
          )}
        </div>
      )}
    </Wrapper>
  );
}
