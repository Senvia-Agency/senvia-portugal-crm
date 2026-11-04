import { MousePointerClick } from "lucide-react";
import { usePaidTrafficStats } from "@/hooks/usePaidTrafficStats";
import { useDashboardPeriod, formatPeriodLabel } from "@/stores/useDashboardPeriod";
import { formatCurrency } from "@/lib/format";
import { MetricTile } from "./MetricTile";
import { useLanguage } from "@/i18n";

// One tile of the strip: the leads paid traffic brought, then how many closed.
// The revenue joins the line only when there is any.
export function PaidTrafficCard() {
  const { t } = useLanguage();
  const { from, to } = useDashboardPeriod();
  const { data, isLoading } = usePaidTrafficStats();
  const revenue = data?.revenue ?? 0;
  const subtitle = isLoading ? undefined : [
    `${data?.converted ?? 0} fechados · ${data?.rate ?? 0}%`,
    revenue > 0 ? formatCurrency(revenue) : null,
  ].filter(Boolean).join(" · ");

  return (
    <MetricTile
      icon={MousePointerClick}
      title={t("Tráfego pago")}
      value={isLoading ? "…" : data?.total ?? 0}
      subtitle={subtitle}
      module="marketing"
      to="/leads"
      hint={`Leads de tráfego pago que entraram em ${formatPeriodLabel(from, to)}, e quantas já fecharam.`}
    />
  );
}

/** The paid-traffic line inside the Leads tile, when the two share one tile. */
export function PaidTrafficLine() {
  const { data, isLoading } = usePaidTrafficStats();
  const { t } = useLanguage();
  if (isLoading || !data || data.total === 0) return null;
  return (
    <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
      <MousePointerClick className="h-3 w-3 shrink-0" aria-hidden="true" />
      {t("{{n}} de tráfego pago", { n: data.total })} · {t(data.converted === 1 ? "{{n}} fechado" : "{{n}} fechados", { n: data.converted })}
    </p>
  );
}
