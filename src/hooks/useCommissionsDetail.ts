import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDashboardPeriod } from "@/stores/useDashboardPeriod";
import { telecomCommissionInPeriod } from '@/lib/telecom-finance';
import { format } from "date-fns";

export interface CommissionSaleDetail {
  saleId: string;
  saleCode: string | null;
  saleDate: string;
  totalValue: number;
  commissionRate: number;
  commissionValue: number;
  createdBy: string;
  fullName: string;
}

export interface CommissionByUser {
  userId: string;
  fullName: string;
  sales: CommissionSaleDetail[];
  totalSales: number;
  totalCommission: number;
}

interface SalesSettings {
  commissions_enabled?: boolean;
  commission_percentage?: number | null;
}

export function useCommissionsDetail() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const isTelecom = organization?.niche === 'telecom';
  const { from, to } = useDashboardPeriod();

  const salesSettings = (organization?.sales_settings as SalesSettings) || {};
  const commissionsEnabled = !!salesSettings.commissions_enabled;
  const globalRate = salesSettings.commission_percentage || null;

  // Honra o intervalo do dashboard. Sem período, abre de ponta a ponta — as
  // datas entram numa expressão `or(...)` do PostgREST, por isso é preciso um
  // valor em vez de omitir o limite.
  const monthStart = from ? format(from, "yyyy-MM-dd") : "1900-01-01";
  const monthEnd = to ? format(to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

  return useQuery({
    queryKey: ["commissions-detail", orgId, commissionsEnabled, monthStart, monthEnd, isTelecom],
    queryFn: async (): Promise<{ byUser: CommissionByUser[]; grandTotal: number }> => {
      if (!orgId || !commissionsEnabled) return { byUser: [], grandTotal: 0 };

      // Attribute a sale to a month by activation_date when set, else sale_date
      // (same rule as the other commission views). Fetch sales whose activation
      // OR sale date falls in the month, then keep the ones whose effective date
      // (activation || sale) is in range.
      let salesQuery = supabase
        .from("sales")
        .select("id, code, sale_date, activation_date, scheduled_install_date, total_value, created_by")
        .eq("organization_id", orgId)
        .in("status", ["fulfilled", "delivered"]);
      if (!isTelecom) salesQuery = salesQuery.or(
        `and(activation_date.gte.${monthStart},activation_date.lte.${monthEnd}),and(sale_date.gte.${monthStart},sale_date.lte.${monthEnd})`,
      );
      const { data: salesRaw, error: salesError } = await salesQuery;

      if (salesError) throw salesError;

      const sales = (salesRaw || []).filter((s) => {
        if (isTelecom) return telecomCommissionInPeriod(s, { from: new Date(`${monthStart}T00:00:00`), to: new Date(`${monthEnd}T00:00:00`) });
        const ref = s.activation_date || s.sale_date;
        return ref != null && ref >= monthStart && ref <= monthEnd;
      });

      const { data: members, error: membersError } = await supabase
        .from("organization_members")
        .select("user_id, commission_rate")
        .eq("organization_id", orgId)
        .eq("is_active", true);

      if (membersError) throw membersError;

      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("organization_id", orgId);

      if (profilesError) throw profilesError;

      const profileMap = new Map(profiles?.map(p => [p.id, p.full_name]) || []);
      const memberRateMap = new Map(members?.map(m => [m.user_id, Number(m.commission_rate || 0)]) || []);

      const grouped = new Map<string, CommissionSaleDetail[]>();

      for (const sale of sales || []) {
        if (!sale.created_by) continue;
        const rate = globalRate && globalRate > 0 ? globalRate : (memberRateMap.get(sale.created_by) || 0);
        const commissionValue = Number(sale.total_value || 0) * (rate / 100);

        const detail: CommissionSaleDetail = {
          saleId: sale.id,
          saleCode: sale.code,
          saleDate: sale.sale_date,
          totalValue: Number(sale.total_value || 0),
          commissionRate: rate,
          commissionValue,
          createdBy: sale.created_by,
          fullName: profileMap.get(sale.created_by) || "Desconhecido",
        };

        const existing = grouped.get(sale.created_by) || [];
        existing.push(detail);
        grouped.set(sale.created_by, existing);
      }

      let grandTotal = 0;
      const byUser: CommissionByUser[] = [];

      for (const [userId, userSales] of grouped) {
        const totalCommission = userSales.reduce((sum, s) => sum + s.commissionValue, 0);
        const totalSales = userSales.reduce((sum, s) => sum + s.totalValue, 0);
        grandTotal += totalCommission;

        byUser.push({
          userId,
          fullName: profileMap.get(userId) || "Desconhecido",
          sales: userSales.sort((a, b) => b.saleDate.localeCompare(a.saleDate)),
          totalSales,
          totalCommission,
        });
      }

      byUser.sort((a, b) => b.totalCommission - a.totalCommission);

      return { byUser, grandTotal };
    },
    enabled: !!orgId && commissionsEnabled,
  });
}
