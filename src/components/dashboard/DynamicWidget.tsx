import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";
import { useWidgetData } from "@/hooks/useWidgetData";
import { WidgetType, NicheType, WIDGET_DEFINITIONS, getWidgetTitle } from "@/lib/dashboard-templates";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { 
  Area, 
  AreaChart, 
  Bar, 
  BarChart, 
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Tooltip,
} from "recharts";

interface DynamicWidgetProps {
  widgetType: WidgetType;
  niche?: NicheType;
  className?: string;
}

const CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

export function DynamicWidget({ widgetType, niche = 'generic', className }: DynamicWidgetProps) {
  const data = useWidgetData(widgetType);
  const definition = WIDGET_DEFINITIONS[widgetType];
  const title = getWidgetTitle(widgetType, niche);
  const Icon = definition?.icon;

  const chart = useMemo(() => {
    if (!definition || !data.chartData || data.chartData.length === 0) {
      if (data.progress !== undefined) {
        return (
          <div className="mt-2">
            <Progress value={data.progress} className="h-2" />
          </div>
        );
      }
      return null;
    }

    switch (definition.chartType) {
      case 'area':
        return (
          <ResponsiveContainer width="100%" height={60}>
            <AreaChart data={data.chartData}>
              <defs>
                <linearGradient id={`gradient-${widgetType}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fill={`url(#gradient-${widgetType})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        );

      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={60}>
            <BarChart data={data.chartData}>
              <Bar 
                dataKey="value" 
                fill="hsl(var(--primary))" 
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        );

      case 'donut':
      case 'pie':
        return (
          <div className="flex items-center gap-3">
            <ResponsiveContainer width={70} height={70} className="flex-shrink-0">
              <PieChart>
                <Pie
                  data={data.chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={definition.chartType === 'donut' ? 18 : 0}
                  outerRadius={30}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {data.chartData.map((_, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={CHART_COLORS[index % CHART_COLORS.length]} 
                    />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value: number, name: string) => [`${value} leads`, name]}
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            
            <div className="flex flex-col gap-1 text-xs min-w-0 flex-1">
              {data.chartData.slice(0, 4).map((item, index) => (
                <div key={item.name} className="flex items-center gap-1.5">
                  <div 
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                  />
                  <span className="text-muted-foreground truncate flex-1">
                    {item.name}
                  </span>
                  <span className="font-medium text-foreground flex-shrink-0">
                    {item.value}
                  </span>
                </div>
              ))}
              {data.chartData.length > 4 && (
                <span className="text-muted-foreground text-[10px]">
                  +{data.chartData.length - 4} mais
                </span>
              )}
            </div>
          </div>
        );

      case 'progress':
        return (
          <div className="mt-2">
            <Progress value={data.progress || 0} className="h-2" />
          </div>
        );

      default:
        return null;
    }
  }, [definition, data.chartData, data.progress, widgetType]);

  if (data.isLoading) {
    return (
      <div className={cn(
        "rounded-xl border bg-card p-4 flex flex-col justify-between min-h-[140px]",
        className
      )}>
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-12 w-full mt-2" />
      </div>
    );
  }

  return (
    <div className={cn(
      "dashboard-metric rounded-xl border bg-card p-4 flex flex-col justify-between min-h-[140px] transition-all hover:shadow-md",
      className
    )}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
            {Icon && <Icon className="dashboard-metric-icon h-4 w-4 flex-shrink-0" />}
            <span className="truncate">{title}</span>
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="dashboard-metric-value text-2xl font-bold text-foreground">{data.value}</span>
            {data.trend && (
              <span className={cn(
                "flex items-center text-xs font-medium",
                data.trend.isPositive ? "text-success" : "text-destructive"
              )}>
                {data.trend.isPositive ? (
                  <TrendingUp className="h-3 w-3 mr-0.5" />
                ) : (
                  <TrendingDown className="h-3 w-3 mr-0.5" />
                )}
                {data.trend.value}%
              </span>
            )}
          </div>
          {data.subtitle && (
            <p className="text-xs text-muted-foreground mt-1 truncate">{data.subtitle}</p>
          )}
        </div>
      </div>
      {chart && (
        <div className="mt-3 -mx-1">
          {chart}
        </div>
      )}
    </div>
  );
}
