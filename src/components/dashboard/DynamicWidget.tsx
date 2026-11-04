import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";
import { useWidgetData } from "@/hooks/useWidgetData";
import { WidgetType, NicheType, WIDGET_DEFINITIONS, getWidgetTitle } from "@/lib/dashboard-templates";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricTile } from "./MetricTile";
import { PaidTrafficLine } from "./PaidTrafficCard";
import { useLanguage } from "@/i18n";

interface DynamicWidgetProps {
  widgetType: WidgetType;
  niche?: NicheType;
  /** Leads tile only: also carry the paid-traffic line (its own tile is then left out). */
  withPaidTraffic?: boolean;
  className?: string;
}

const CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

// Which module a number comes from, so its icon wears that module's colour.
const WIDGET_MODULES: Partial<Record<WidgetType, string>> = {
  leads_total: 'leads', leads_trend: 'leads', leads_by_source: 'leads', leads_social: 'leads', leads_direct: 'leads',
  conversion_rate: 'leads',
  proposals_open: 'proposals', proposals_accepted: 'proposals', pending_quotes: 'proposals',
  sales_delivered: 'sales', sales_active: 'sales', pending_installations: 'sales', treatments_completed: 'sales',
  active_projects: 'sales', completed_projects: 'sales', orders_today: 'sales', revenue_today: 'sales', deals_closing: 'sales',
  active_customers: 'clients', patients_in_treatment: 'clients',
  monthly_commissions: 'finance',
  appointments_today: 'calendar', visits_this_week: 'calendar',
};

// Where a click on the number takes you: the page that lists what it counts.
const WIDGET_LINKS: Partial<Record<WidgetType, string>> = {
  leads_total: '/leads', leads_trend: '/leads', leads_by_source: '/leads', leads_social: '/leads', leads_direct: '/leads',
  conversion_rate: '/leads',
  proposals_open: '/proposals', proposals_accepted: '/proposals', pending_quotes: '/proposals', deals_closing: '/proposals',
  sales_delivered: '/sales', sales_active: '/sales', pending_installations: '/sales', treatments_completed: '/sales',
  active_projects: '/sales', completed_projects: '/sales',
  active_customers: '/clients', patients_in_treatment: '/clients', active_listings: '/clients',
  monthly_commissions: '/financeiro?tab=comissoes',
  appointments_today: '/calendar', visits_this_week: '/calendar',
};

export function DynamicWidget({ widgetType, niche = 'generic', withPaidTraffic = false, className }: DynamicWidgetProps) {
  const data = useWidgetData(widgetType);
  const definition = WIDGET_DEFINITIONS[widgetType];
  const { t } = useLanguage();
  const title = t(getWidgetTitle(widgetType, niche));

  if (data.isLoading) {
    return (
      <div className={cn("min-w-0 space-y-1.5 rounded-xl border bg-card px-3 py-3", className)}>
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-6 w-14" />
        <Skeleton className="h-3 w-20" />
      </div>
    );
  }

  // The change in plain numbers ("+12"): a percentage over a small week reads as 1300%.
  const trend = data.trend && data.trend.value !== 0 && (
    <span title={t("Face aos 7 dias anteriores")}
      className={cn("flex items-center text-xs font-medium", data.trend.isPositive ? "text-success" : "text-destructive")}>
      {data.trend.isPositive ? <TrendingUp className="mr-0.5 h-3 w-3" /> : <TrendingDown className="mr-0.5 h-3 w-3" />}
      {data.trend.isPositive ? '+' : '−'}{data.trend.value}
    </span>
  );

  // At this size only a breakdown adds to the number (its top three). Trend
  // lines, single bars and progress bars repeated it and made tiles uneven.
  const chartData = data.breakdown ?? ((definition?.chartType === 'donut' || definition?.chartType === 'pie') ? data.chartData ?? [] : []);
  const extra = chartData.length > 0 && (
    <div className="mt-1.5 space-y-0.5 text-[11px]">
      {chartData.slice(0, 3).map((item, index) => (
        <div key={item.name} className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{t(item.name)}</span>
          <span className="shrink-0 font-medium tabular-nums">{item.value}</span>
        </div>
      ))}
    </div>
  );

  return (
    <MetricTile
      icon={definition?.icon}
      title={title}
      value={data.value}
      trend={trend}
      subtitle={data.subtitle}
      module={WIDGET_MODULES[widgetType]}
      to={WIDGET_LINKS[widgetType]}
      className={className}
    >
      {extra}
      {withPaidTraffic && <PaidTrafficLine />}
    </MetricTile>
  );
}
