import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartConfig } from "@/components/ui/chart";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { intlLocale, useLanguage } from "@/i18n";

type SingleBarDatum = { name: string; value: number };
type GroupedBarDatum = {
  name: string;
  objetivo: number;
  ativos: number;
  pendentes: number;
};

type ChartDatum = SingleBarDatum | GroupedBarDatum;

interface MiniBarChartProps {
  data: SingleBarDatum[] | GroupedBarDatum[];
  color?: string;
  height?: number;
  showLabels?: boolean;
  mode?: "single" | "grouped";
  variant?: "default" | "portal";
  showYAxis?: boolean;
  showGrid?: boolean;
  showLegend?: boolean;
  formatAsCurrency?: boolean;
}

const metricColors: Record<string, string> = {
  objetivo: "hsl(var(--primary))",
  ativos: "hsl(var(--success))",
  pendentes: "hsl(var(--warning))",
};

const metricLabels: Record<string, string> = {
  objetivo: "Objetivo",
  ativos: "Ativos",
  pendentes: "Pendentes",
};

// Built per call so the numbers follow the chosen language.
const numberFormatter = () => new Intl.NumberFormat(intlLocale(), {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const currencyFormatter = () => new Intl.NumberFormat(intlLocale(), {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function getMetricColor(name: string, fallback: string) {
  return metricColors[name.trim().toLowerCase()] ?? fallback;
}

function getRoundedChartMax(data: ChartDatum[], mode: "single" | "grouped") {
  const highestValue = Math.max(
    ...data.map((item) =>
      mode === "grouped"
        ? Math.max(
            (item as GroupedBarDatum).objetivo,
            (item as GroupedBarDatum).ativos,
            (item as GroupedBarDatum).pendentes,
          )
        : (item as SingleBarDatum).value,
    ),
    0,
  );

  if (highestValue <= 0) return 4;
  if (highestValue <= 10) return Math.ceil((highestValue * 1.15) / 2) * 2;

  // Pick a "nice" step based on the value range
  const niceSteps = [5, 10, 20, 25, 50, 100, 250, 500, 1000, 2000, 2500, 5000, 10000, 25000, 50000, 100000];
  const withHeadroom = highestValue * 1.3;

  // Find the smallest nice step that produces 4-8 ticks
  let bestStep = niceSteps[niceSteps.length - 1];
  for (const step of niceSteps) {
    const candidate = Math.ceil(withHeadroom / step) * step;
    const ticks = candidate / step;
    if (ticks >= 3 && ticks <= 8) {
      bestStep = step;
      break;
    }
  }

  return Math.ceil(withHeadroom / bestStep) * bestStep;
}

function formatGroupedLabel(label: string) {
  if (label.length <= 14) return label;

  const parts = label.split(" ").filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0];
    const lastInitial = parts[parts.length - 1]?.[0];
    return `${first} ${lastInitial}.`;
  }

  return `${label.slice(0, 12)}…`;
}

export function MiniBarChart({
  data,
  color = "hsl(var(--primary))",
  height = 60,
  showLabels = false,
  mode = "single",
  variant = "default",
  showYAxis = false,
  showGrid = false,
  showLegend = false,
  formatAsCurrency = false,
}: MiniBarChartProps) {
  const { t } = useLanguage();
  if (!data || data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {t("Sem dados")}
      </div>
    );
  }

  const isGrouped = mode === "grouped";
  const isPortalVariant = variant === "portal";
  const yAxisMax = getRoundedChartMax(data as ChartDatum[], mode);
  const shouldShowYAxis = showYAxis || isPortalVariant;
  const shouldShowGrid = showGrid || isPortalVariant || isGrouped;
  const shouldShowLegend = showLegend && isGrouped;
  const bottomMargin = isGrouped ? (isPortalVariant ? 94 : 72) : showLabels ? 28 : 8;
  const chartConfig: ChartConfig = isGrouped
    ? {
        objetivo: { label: t("Objetivo"), color: metricColors.objetivo },
        ativos: { label: t("Ativos"), color: metricColors.ativos },
        pendentes: { label: t("Pendentes"), color: metricColors.pendentes },
      }
    : {
        value: { label: t("Valor"), color },
      };

  return (
    <ChartContainer config={chartConfig} className="w-full aspect-auto" style={{ height }}>
      <BarChart
        data={data}
        margin={{ top: 8, right: isPortalVariant ? 8 : 4, left: shouldShowYAxis ? 4 : 0, bottom: bottomMargin }}
        barGap={isGrouped ? (isPortalVariant ? 8 : 4) : 0}
        barCategoryGap={isGrouped ? (isPortalVariant ? "34%" : "28%") : isPortalVariant ? "46%" : "40%"}
      >
        {shouldShowGrid && (
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray={isPortalVariant ? "2 6" : "3 3"} />
        )}

        <ChartTooltip
          cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.18 }}
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(value, name, item) => {
                const label = isGrouped
                  ? t(metricLabels[String(name).toLowerCase()] ?? String(name))
                  : String(item.payload?.name ?? name ?? t("Valor"));

                return (
                  <div className="flex min-w-[10rem] items-center justify-between gap-6">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono font-medium tabular-nums text-foreground">
                      {formatAsCurrency ? currencyFormatter().format(Number(value)) : numberFormatter().format(Number(value))}
                    </span>
                  </div>
                );
              }}
            />
          }
        />

        {shouldShowYAxis && (
          <YAxis
            axisLine={false}
            tickLine={false}
            width={isPortalVariant ? 48 : 42}
            domain={[0, yAxisMax]}
            tickCount={5}
            tickFormatter={(value: number) => formatAsCurrency ? currencyFormatter().format(value) : numberFormatter().format(value)}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          />
        )}

        {(showLabels || isGrouped) && (
          <XAxis
            dataKey="name"
            axisLine={false}
            tickLine={false}
            interval={0}
            height={isGrouped ? (isPortalVariant ? 78 : 64) : 24}
            angle={isGrouped ? -38 : 0}
            textAnchor={isGrouped ? "end" : "middle"}
            tickMargin={isGrouped ? 10 : 8}
            tickFormatter={isGrouped && isPortalVariant ? formatGroupedLabel : undefined}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          />
        )}

        {shouldShowLegend && <ChartLegend verticalAlign="top" content={<ChartLegendContent />} />}

        {isGrouped ? (
          <>
            <Bar dataKey="objetivo" name="Objetivo" fill={metricColors.objetivo} radius={[999, 999, 0, 0]} maxBarSize={12} />
            <Bar dataKey="ativos" name="Ativos" fill={metricColors.ativos} radius={[999, 999, 0, 0]} maxBarSize={12} />
            <Bar dataKey="pendentes" name="Pendentes" fill={metricColors.pendentes} radius={[999, 999, 0, 0]} maxBarSize={12} />
          </>
        ) : (
          <Bar dataKey="value" radius={[999, 999, 0, 0]} maxBarSize={isPortalVariant ? 28 : 56}>
            {(data as SingleBarDatum[]).map((entry) => (
              <Cell key={entry.name} fill={getMetricColor(entry.name, color)} />
            ))}
          </Bar>
        )}
      </BarChart>
    </ChartContainer>
  );
}
