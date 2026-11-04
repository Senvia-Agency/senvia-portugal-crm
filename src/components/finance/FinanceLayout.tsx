import { useMemo, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { ArrowRight, Wallet, type LucideIcon } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FinanceStats } from "@/types/finance";
import { dateLocale, useLanguage } from "@/i18n";

/** One number of a finance summary line; clicking it opens what it counts. */
export function Figure({ label, value, hint, tone, onClick, loading }: {
  label: string; value: string; hint?: ReactNode; tone?: string; onClick?: () => void; loading?: boolean;
}) {
  return (
    <button type="button" onClick={onClick}
      className="group min-w-0 rounded-xl border border-border/70 bg-card px-4 py-2.5 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <p className="flex items-center justify-between gap-2 truncate text-xs font-medium text-muted-foreground">
        {label}<ArrowRight className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      </p>
      {loading ? <Skeleton className="mt-1 h-6 w-24" /> : <p className={cn("truncate text-lg font-semibold tabular-nums", tone)}>{value}</p>}
      {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
    </button>
  );
}

/** A white card with a small title line, like the other pages' panels. */
export function Panel({ title, icon: Icon, action, children, className }: {
  title: string; icon: LucideIcon; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-xl border bg-card p-4 shadow-sm", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4 text-primary" aria-hidden="true" />{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The finance page's sections as one row of pills; a badge flags what needs attention. */
export function FinanceTabNav<T extends string>({ tabs, current, onSelect, badges }: {
  tabs: readonly { key: T; label: string; icon: LucideIcon }[];
  current: T;
  onSelect: (tab: T) => void;
  badges?: Partial<Record<T, number>>;
}) {
  const { t } = useLanguage();
  return (
    <nav role="tablist" aria-label={t("Secções do financeiro")}
      className="-mx-1 flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-border bg-card p-1 shadow-sm sm:mx-0 sm:w-fit">
      {tabs.map(({ key, label, icon: Icon }) => {
        const selected = current === key;
        const badge = badges?.[key] ?? 0;
        return (
          <button key={key} type="button" role="tab" aria-selected={selected} onClick={() => onSelect(key)}
            className={cn("flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors",
              selected ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/30" : "text-foreground/75 hover:bg-muted hover:text-foreground")}>
            <Icon className="h-4 w-4" aria-hidden="true" />{t(label)}
            {badge > 0 && (
              <span className="rounded-full bg-destructive px-1.5 text-[10px] font-semibold leading-4 text-destructive-foreground">{badge}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

/** Money in, money out and what is still expected, day by day over the period. */
export function CashflowPanel({ trend, loading }: { trend: FinanceStats["cashflowTrend"]; loading: boolean }) {
  const { t, language } = useLanguage();
  const chartData = useMemo(() => trend.map((point) => ({
    ...point,
    label: format(parseISO(point.date), "dd MMM", { locale: dateLocale() }),
  })), [trend, language]);
  return (
    <Panel title={t("Fluxo de caixa")} icon={Wallet}
      action={<span className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />{t("Recebido")}</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" />{t("Despesas")}</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" />{t("Previsto")}</span>
      </span>}>
      {loading ? <Skeleton className="h-[220px] w-full" /> : chartData.length === 0 ? (
        <div className="grid h-[220px] place-items-center text-sm text-muted-foreground">{t("Sem movimentos neste período.")}</div>
      ) : (
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 6, right: 6, left: -14, bottom: 0 }}>
              <defs>
                <linearGradient id="financeReceivedFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.22} /><stop offset="100%" stopColor="#10b981" stopOpacity={0.02} /></linearGradient>
                <linearGradient id="financeExpenseFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f43f5e" stopOpacity={0.18} /><stop offset="100%" stopColor="#f43f5e" stopOpacity={0.02} /></linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 5" className="stroke-border" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={16} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(n) => `€${n}`} width={48} />
              <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={{ borderRadius: 10, border: "1px solid hsl(var(--border))", background: "hsl(var(--background))" }} />
              <Area type="monotone" dataKey="received" name={t("Recebido")} stroke="#059669" strokeWidth={2} fill="url(#financeReceivedFill)" />
              <Area type="monotone" dataKey="expenses" name={t("Despesas")} stroke="#e11d48" strokeWidth={2} fill="url(#financeExpenseFill)" />
              <Area type="monotone" dataKey="scheduled" name={t("Previsto")} stroke="#2563eb" strokeWidth={2} strokeDasharray="4 3" fill="none" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}
