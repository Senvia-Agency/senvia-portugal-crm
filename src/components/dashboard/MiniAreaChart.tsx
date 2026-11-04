import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { useLanguage } from "@/i18n";

interface MiniAreaChartProps {
  data: { value: number }[];
  color?: string;
  height?: number;
}

export function MiniAreaChart({ data, color = "hsl(var(--primary))", height = 60 }: MiniAreaChartProps) {
  const { t } = useLanguage();
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
        {t("Sem dados")}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`gradient-${color.replace(/[^a-zA-Z0-9]/g, '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill={`url(#gradient-${color.replace(/[^a-zA-Z0-9]/g, '')})`}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
