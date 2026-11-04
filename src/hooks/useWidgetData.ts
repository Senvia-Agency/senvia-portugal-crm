import { useMemo } from "react";
import { useFilteredLeads } from "@/hooks/useFilteredLeads";
import { usePaidTrafficFilter } from "@/contexts/PaidTrafficFilterContext";
import { useSales } from "@/hooks/useSales";
import { useProposals } from "@/hooks/useProposals";
import { useCalendarEvents } from "@/hooks/useCalendarEvents";
import { useClients } from "@/hooks/useClients";
import { useEcommerceStats } from "@/hooks/ecommerce/useEcommerceStats";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { WidgetType } from "@/lib/dashboard-templates";
import { startOfDay, startOfMonth, startOfWeek, endOfWeek, isToday, isThisWeek, subDays, format } from "date-fns";
import { formatOperationalUnits, operationalUnitsForSale, sumOperationalSaleUnits } from "@/lib/sale-units";
import { formatCurrency } from "@/lib/format";
import { useCommercialCommissions } from "@/hooks/useCommercialCommissions";
import { useDashboardPeriod } from "@/stores/useDashboardPeriod";
import { tr, useLanguage } from "@/i18n";

export interface WidgetData {
  value: string;
  subtitle?: string;
  /** Change against the 7 days before, in units (not a percentage). */
  trend?: {
    value: number;
    isPositive: boolean;
  };
  chartData?: Array<{ name: string; value: number }>;
  /** Top lines shown under the number (e.g. leads per origin). */
  breakdown?: Array<{ name: string; value: number }>;
  progress?: number;
  isLoading: boolean;
}

export function useWidgetData(widgetType: WidgetType): WidgetData {
  const { data: leads = [], isLoading: leadsLoading } = useFilteredLeads();
  const { filterKey } = usePaidTrafficFilter();
  const { data: allSales = [], isLoading: salesLoading } = useSales();
  const { data: allProposals = [], isLoading: proposalsLoading } = useProposals();
  const { data: events = [], isLoading: eventsLoading } = useCalendarEvents();
  const { data: allClients = [], isLoading: clientsLoading } = useClients();
  const ecommerceStats = useEcommerceStats();
  const { data: stages = [] } = usePipelineStages();
  // The computed lines are in the chosen language: recompute when it changes.
  const { language } = useLanguage();
  // Commissions are counted exactly as in Financeiro → Comissões, for the Painel's period.
  const { from, to } = useDashboardPeriod();
  const commissionMonth = useMemo(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'), []);
  const { data: commissions, isLoading: commissionsLoading } = useCommercialCommissions(
    widgetType === 'monthly_commissions' ? commissionMonth : '',
    null,
    { dateRange: from ? { from, to: to ?? undefined } : undefined },
  );

  const filteredLeadIds = useMemo(() => new Set(leads.map((l) => l.id)), [leads]);

  const sales = useMemo(() => {
    if (filterKey === "all") return allSales;
    return allSales.filter((s) => s.lead_id != null && filteredLeadIds.has(s.lead_id));
  }, [allSales, filterKey, filteredLeadIds]);

  const proposals = useMemo(() => {
    if (filterKey === "all") return allProposals;
    return allProposals.filter((p) => p.lead_id != null && filteredLeadIds.has(p.lead_id));
  }, [allProposals, filterKey, filteredLeadIds]);

  const clients = useMemo(() => {
    if (filterKey === "all") return allClients;
    return allClients.filter((c) => c.lead_id != null && filteredLeadIds.has(c.lead_id));
  }, [allClients, filterKey, filteredLeadIds]);

  return useMemo(() => {
    const today = startOfDay(new Date());
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });

    // Calculate lead trends (last 7 days)
    const calculateLeadTrend = () => {
      const last7Days = leads.filter(l => 
        new Date(l.created_at || '') >= subDays(today, 7)
      ).length;
      const prev7Days = leads.filter(l => {
        const date = new Date(l.created_at || '');
        return date >= subDays(today, 14) && date < subDays(today, 7);
      }).length;
      
      const change = last7Days - prev7Days;
      return { value: Math.abs(change), isPositive: change >= 0 };
    };

    // Generate chart data for last 7 days
    const generateLast7DaysChart = <T extends { created_at?: string | null }>(
      items: T[],
      weight: (item: T) => number = () => 1,
    ) => {
      const data: Array<{ name: string; value: number }> = [];
      for (let i = 6; i >= 0; i--) {
        const date = subDays(today, i);
        const dayItems = items.filter(item => {
          const itemDate = new Date(item.created_at || '');
          return format(itemDate, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd');
        });
        data.push({
          name: format(date, 'EEE'),
          value: dayItems.reduce((sum, item) => sum + weight(item), 0),
        });
      }
      return data;
    };

    switch (widgetType) {
      case 'leads_total': {
        const trend = calculateLeadTrend();
        const thisWeek = leads.filter(l => {
          const date = new Date(l.created_at || '');
          return date >= weekStart && date <= weekEnd;
        }).length;
        const bySource = leads.reduce((acc, lead) => {
          const source = lead.source || 'Direto';
          acc[source] = (acc[source] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        return {
          value: leads.length.toString(),
          subtitle: tr('{{n}} esta semana', { n: thisWeek }),
          trend,
          chartData: generateLast7DaysChart(leads),
          breakdown: Object.entries(bySource).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
          isLoading: leadsLoading,
        };
      }

      case 'leads_trend': {
        const thisWeek = leads.filter(l => {
          const date = new Date(l.created_at || '');
          return date >= weekStart && date <= weekEnd;
        }).length;
        const trend = calculateLeadTrend();
        return {
          value: thisWeek.toString(),
          subtitle: tr('esta semana'),
          trend,
          chartData: generateLast7DaysChart(leads),
          isLoading: leadsLoading,
        };
      }

      case 'leads_by_source': {
        const sourceGroups = leads.reduce((acc, lead) => {
          const source = lead.source || 'Direto';
          acc[source] = (acc[source] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        const chartData = Object.entries(sourceGroups).map(([name, value]) => ({
          name,
          value,
        }));

        return {
          value: Object.keys(sourceGroups).length.toString(),
          subtitle: tr('canais ativos'),
          chartData,
          isLoading: leadsLoading,
        };
      }

      case 'leads_social': {
        const SOCIAL_SOURCES = ['instagram', 'facebook', 'linkedin', 'tiktok', 'twitter', 'youtube', 'social'];
        const socialLeads = leads.filter(l => {
          const source = (l.source || '').toLowerCase();
          return SOCIAL_SOURCES.some(s => source.includes(s));
        });

        // Calculate trend for social leads
        const last7Days = socialLeads.filter(l => 
          new Date(l.created_at || '') >= subDays(today, 7)
        ).length;
        const prev7Days = socialLeads.filter(l => {
          const date = new Date(l.created_at || '');
          return date >= subDays(today, 14) && date < subDays(today, 7);
        }).length;
        
        const socialTrend = { value: Math.abs(last7Days - prev7Days), isPositive: last7Days >= prev7Days };

        const sourceGroups = socialLeads.reduce((acc, lead) => {
          const source = lead.source || 'Redes Sociais';
          acc[source] = (acc[source] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        const chartData = Object.entries(sourceGroups).map(([name, value]) => ({
          name,
          value,
        }));

        return {
          value: socialLeads.length.toString(),
          subtitle: tr('via redes sociais'),
          trend: socialTrend,
          chartData,
          isLoading: leadsLoading,
        };
      }

      case 'leads_direct': {
        const SOCIAL_SOURCES = ['instagram', 'facebook', 'linkedin', 'tiktok', 'twitter', 'youtube', 'social'];
        const directLeads = leads.filter(l => {
          const source = (l.source || '').toLowerCase();
          // Direto = sem fonte OU não é rede social
          return !source || !SOCIAL_SOURCES.some(s => source.includes(s));
        });

        // Calculate trend for direct leads
        const directLast7Days = directLeads.filter(l => 
          new Date(l.created_at || '') >= subDays(today, 7)
        ).length;
        const directPrev7Days = directLeads.filter(l => {
          const date = new Date(l.created_at || '');
          return date >= subDays(today, 14) && date < subDays(today, 7);
        }).length;
        
        const directTrend = { value: Math.abs(directLast7Days - directPrev7Days), isPositive: directLast7Days >= directPrev7Days };

        const sourceGroups = directLeads.reduce((acc, lead) => {
          const source = lead.source || 'Direto';
          acc[source] = (acc[source] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        const chartData = Object.entries(sourceGroups).map(([name, value]) => ({
          name,
          value,
        }));

        return {
          value: directLeads.length.toString(),
          subtitle: tr('canais diretos'),
          trend: directTrend,
          chartData,
          isLoading: leadsLoading,
        };
      }

      case 'conversion_rate': {
        // Use dynamic pipeline stages to find "won" leads
        const wonKey = stages.find(s => s.is_final_positive)?.key;
        const convertedLeads = leads.filter(l => {
          if (wonKey && l.status === wonKey) return true;
          const status = l.status?.toLowerCase() || '';
          return status === 'won' || status === 'converted' || status.includes('ganho') || status.includes('fechado');
        }).length;
        const rate = leads.length > 0 
          ? Math.round((convertedLeads / leads.length) * 100) 
          : 0;

        return {
          value: `${rate}%`,
          subtitle: tr('{{converted}} de {{total}} leads', { converted: convertedLeads, total: leads.length }),
          progress: rate,
          isLoading: leadsLoading,
        };
      }

      case 'sales_delivered': {
        const delivered = sales.filter(s => s.status === 'delivered');
        const totalValue = delivered.reduce((sum, s) => sum + (s.total_value || 0), 0);
        const underWay = sales.filter(s => s.status === 'in_progress' || s.status === 'fulfilled').length;

        return {
          value: delivered.length.toString(),
          subtitle: [formatCurrency(totalValue), underWay > 0 ? tr('{{n}} em curso', { n: underWay }) : null].filter(Boolean).join(' · '),
          chartData: generateLast7DaysChart(delivered, operationalUnitsForSale),
          isLoading: salesLoading,
        };
      }

      case 'sales_active': {
        const active = sales.filter(s => 
          s.status === 'in_progress' || s.status === 'fulfilled'
        );
        const totalValue = active.reduce((sum, s) => sum + (s.total_value || 0), 0);

        return {
          value: active.length.toString(),
          subtitle: tr('{{value}} em curso', { value: formatCurrency(totalValue) }),
          chartData: generateLast7DaysChart(active, operationalUnitsForSale),
          isLoading: salesLoading,
        };
      }

      case 'proposals_open': {
        const open = proposals.filter(p => 
          p.status === 'draft' || p.status === 'sent' || p.status === 'negotiating'
        );
        const totalValue = open.reduce((sum, p) => sum + (p.total_value || 0), 0);

        return {
          value: open.length.toString(),
          subtitle: tr('{{value}} pendente', { value: formatCurrency(totalValue) }),
          isLoading: proposalsLoading,
        };
      }

      case 'proposals_accepted': {
        const accepted = proposals.filter(p => p.status === 'accepted');
        const totalValue = accepted.reduce((sum, p) => sum + (p.total_value || 0), 0);

        return {
          value: accepted.length.toString(),
          subtitle: tr('{{value}} aceite', { value: formatCurrency(totalValue) }),
          isLoading: proposalsLoading,
        };
      }

      case 'appointments_today': {
        const todayEvents = events.filter(e => isToday(new Date(e.start_time)));
        const completedToday = todayEvents.filter(e => e.status === 'completed').length;

        return {
          value: todayEvents.length.toString(),
          subtitle: tr('{{n}} concluídas', { n: completedToday }),
          progress: todayEvents.length > 0 
            ? Math.round((completedToday / todayEvents.length) * 100) 
            : 0,
          isLoading: eventsLoading,
        };
      }

      case 'patients_in_treatment':
      case 'active_customers': {
        const activeClients = clients.filter(c => c.status === 'active');
        return {
          value: activeClients.length.toString(),
          subtitle: tr('clientes ativos'),
          chartData: generateLast7DaysChart(clients),
          isLoading: clientsLoading,
        };
      }

      case 'treatments_completed':
      case 'completed_projects': {
        const completed = sales.filter(s => s.status === 'delivered' || s.status === 'fulfilled');
        return {
          value: formatOperationalUnits(sumOperationalSaleUnits(completed)),
          subtitle: tr('este mês'),
          chartData: generateLast7DaysChart(completed, operationalUnitsForSale),
          isLoading: salesLoading,
        };
      }

      case 'active_projects': {
        const active = sales.filter(s => 
          s.status === 'in_progress' || s.status === 'fulfilled'
        );
        return {
          value: formatOperationalUnits(sumOperationalSaleUnits(active)),
          subtitle: tr('em execução'),
          chartData: generateLast7DaysChart(active, operationalUnitsForSale),
          isLoading: salesLoading,
        };
      }

      case 'pending_quotes': {
        const pending = proposals.filter(p => 
          p.status === 'draft' || p.status === 'sent'
        );
        return {
          value: formatOperationalUnits(sumOperationalSaleUnits(pending)),
          subtitle: tr('à espera de resposta'),
          isLoading: proposalsLoading,
        };
      }

      case 'visits_this_week': {
        const weekEvents = events.filter(e => isThisWeek(new Date(e.start_time), { weekStartsOn: 1 }));
        return {
          value: weekEvents.length.toString(),
          subtitle: tr('agendadas'),
          chartData: weekEvents.slice(0, 7).map(e => ({
            name: format(new Date(e.start_time), 'EEE'),
            value: 1,
          })),
          isLoading: eventsLoading,
        };
      }

      case 'active_listings': {
        // Use products or a specific field for listings
        return {
          value: clients.filter(c => c.status === 'active').length.toString(),
          subtitle: tr('disponíveis'),
          isLoading: clientsLoading,
        };
      }

      case 'deals_closing': {
        const closing = proposals.filter(p => p.status === 'sent');
        return {
          value: closing.length.toString(),
          subtitle: tr('em negociação'),
          isLoading: proposalsLoading,
        };
      }

      case 'pending_installations': {
        const pending = sales.filter(s => s.status === 'in_progress');
        return {
          value: pending.length.toString(),
          subtitle: tr('à espera de instalação'),
          isLoading: salesLoading,
        };
      }

      case 'monthly_commissions': {
        // It used to add up the month's sale values; now the team's commissions.
        const toPay = commissions?.totalPending ?? 0;
        return {
          value: formatCurrency(commissions?.total ?? 0),
          subtitle: toPay > 0.005 ? tr('{{value}} por pagar', { value: formatCurrency(toPay) }) : tr('tudo pago'),
          isLoading: commissionsLoading,
        };
      }

      case 'orders_today': {
        return {
          value: ecommerceStats.data?.total_orders?.toString() || '0',
          subtitle: tr('encomendas totais'),
          isLoading: ecommerceStats.isLoading,
        };
      }

      case 'revenue_today': {
        return {
          value: formatCurrency(ecommerceStats.data?.total_revenue || 0),
          subtitle: tr('faturação total'),
          isLoading: ecommerceStats.isLoading,
        };
      }

      case 'low_stock_products': {
        return {
          value: ecommerceStats.data?.low_stock_products?.toString() || '0',
          subtitle: tr('produtos com stock baixo'),
          isLoading: ecommerceStats.isLoading,
        };
      }

      default:
        return {
          value: '0',
          subtitle: tr('dados indisponíveis'),
          isLoading: false,
        };
    }
  }, [widgetType, leads, sales, proposals, events, clients, ecommerceStats, leadsLoading, salesLoading, proposalsLoading, eventsLoading, clientsLoading, filterKey, commissions, commissionsLoading, language]);
}
