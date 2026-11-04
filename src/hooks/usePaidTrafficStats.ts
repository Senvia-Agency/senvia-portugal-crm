import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { usePaidTrafficFilter } from "@/contexts/PaidTrafficFilterContext";
import { useDashboardPeriod } from "@/stores/useDashboardPeriod";
import { getTrafficMatcher, isPaidFilter } from "@/lib/paid-traffic";

// Filtro PostgREST: apanha qualquer source que contenha "ads", "pago", "paid"
// ou que seja uma das origens exactas conhecidas.
const PAID_FILTER = [
  "source.ilike.%ads%",
  "source.ilike.%pago%",
  "source.ilike.%paid%",
  "source.eq.Webhook Externo",
].join(",");

const FALLBACK_WON = ["won", "fechado", "ganho", "closed", "convertido"];

/**
 * Leads de tráfego pago que entraram no período do Painel, e quantas já
 * fecharam. Segue o filtro de data e de origem do Painel.
 */
export function usePaidTrafficStats() {
  const { organization } = useAuth();
  const { data: stages = [] } = usePipelineStages();
  const { filterKey } = usePaidTrafficFilter();
  const { from, to } = useDashboardPeriod();
  const fromStr = from ? format(from, "yyyy-MM-dd") : null;
  const toStr = to ? format(to, "yyyy-MM-dd") : null;
  const wonKeys = stages.filter((s) => s.is_final_positive).map((s) => s.key);

  return useQuery({
    // Ambas as pontas na chave: com só o início, dois períodos que começam no
    // mesmo dia partilhavam cache.
    queryKey: ["paid-traffic-conversions", organization?.id, wonKeys.join(","), fromStr, toStr, filterKey],
    queryFn: async () => {
      if (!organization?.id) return null;

      // With the filter on "all" this still counts paid traffic only. With one
      // platform chosen, fetch every lead and match that platform in memory.
      const usePaidRestFilter = filterKey === "all" || filterKey === "paid-all";

      let query = supabase
        .from("leads")
        .select("id, status, value, source, created_at")
        .eq("organization_id", organization.id)
        .is("archived_at", null);
      if (usePaidRestFilter) query = query.or(PAID_FILTER);
      // Só as leads que ENTRARAM no período; sem período, sem limites.
      if (fromStr) query = query.gte("created_at", `${fromStr}T00:00:00`);
      if (toStr) query = query.lte("created_at", `${toStr}T23:59:59`);

      const { data: leads, error } = await query;
      if (error) throw error;

      let list = leads ?? [];
      if (isPaidFilter(filterKey) && filterKey !== "paid-all") {
        const matcher = getTrafficMatcher(filterKey);
        list = list.filter((l) => matcher(l.source));
      }

      const total = list.length;
      const lowerWonKeys = wonKeys.map((k) => k.toLowerCase());
      const keys = lowerWonKeys.length > 0 ? lowerWonKeys : FALLBACK_WON;
      const converted = list.filter((l) => keys.includes((l.status ?? "").toLowerCase()));
      const revenue = converted.reduce((sum, l) => sum + (l.value ?? 0), 0);

      return {
        total,
        converted: converted.length,
        rate: total > 0 ? Math.round((converted.length / total) * 100) : 0,
        revenue,
      };
    },
    enabled: !!organization?.id && stages.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
