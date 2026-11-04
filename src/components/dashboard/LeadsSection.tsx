import { Users, Globe, Share2 } from "lucide-react";
import { MetricCardWithChart } from "./MetricCardWithChart";
import { MiniAreaChart } from "./MiniAreaChart";
import { MiniBarChart } from "./MiniBarChart";
import { MiniPieChart } from "./MiniPieChart";
import { useLanguage } from "@/i18n";

interface LeadsSectionProps {
  totalLeads: {
    count: number;
    trend: { value: number; name: string }[];
  };
  websiteLeads: {
    count: number;
    percentage: number;
    trend: { value: number; name: string }[];
  };
  socialLeads: {
    count: number;
    bySource: { name: string; value: number; color?: string }[];
  };
}

export function LeadsSection({
  totalLeads,
  websiteLeads,
  socialLeads,
}: LeadsSectionProps) {
  const { t } = useLanguage();
  return (
    <section>
      <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
        <Users className="h-5 w-5 text-primary" />
        {t("Entrada", { context: "incoming" })}
      </h2>
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        <MetricCardWithChart
          title={t("Total de Leads")}
          value={totalLeads.count.toString()}
          subtitle={t("Últimos 7 dias")}
          icon={<Users className="h-4 w-4" />}
          trend={
            totalLeads.trend.length > 1 ? {
              value: Math.round(
                ((totalLeads.trend[totalLeads.trend.length - 1]?.value || 0) - 
                 (totalLeads.trend[0]?.value || 0)) / 
                Math.max(totalLeads.trend[0]?.value || 1, 1) * 100
              ),
              isPositive: (totalLeads.trend[totalLeads.trend.length - 1]?.value || 0) >= 
                          (totalLeads.trend[0]?.value || 0),
            } : undefined
          }
          chart={
            <MiniAreaChart 
              data={totalLeads.trend} 
              color="hsl(var(--primary))"
            />
          }
        />
        
        <MetricCardWithChart
          title={t("Leads do Site")}
          value={websiteLeads.count.toString()}
          subtitle={t("{{n}}% do total", { n: websiteLeads.percentage })}
          icon={<Globe className="h-4 w-4" />}
          chart={
            <MiniBarChart 
              data={websiteLeads.trend} 
              color="hsl(var(--success))"
              showLabels
              height={70}
            />
          }
        />
        
        <MetricCardWithChart
          title={t("Leads das Redes Sociais")}
          value={socialLeads.count.toString()}
          subtitle={socialLeads.bySource.length > 0 
            ? socialLeads.bySource.map(s => s.name).join(', ')
            : t('Nenhuma fonte identificada')
          }
          icon={<Share2 className="h-4 w-4" />}
          chart={
            <div className="flex justify-center">
              <MiniPieChart 
                data={socialLeads.bySource.length > 0 
                  ? socialLeads.bySource 
                  : [{ name: t('Sem dados'), value: 1 }]
                } 
              />
            </div>
          }
        />
      </div>
    </section>
  );
}
