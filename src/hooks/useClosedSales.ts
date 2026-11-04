import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useProfileNames } from "@/hooks/useTeam";

export interface ClosedSale {
  id: string;
  code: string | null;
  total_value: number | null;
  closedAt: string;
  seller: string | null;
  client: string | null;
}

const WEEK_MS = 7 * 24 * 3600 * 1000;

// The generated Supabase types lag behind the sales table (no seller_id), so the row is typed here.
interface SaleRow {
  id: string;
  code: string | null;
  total_value: number | null;
  approved_at: string | null;
  seller_id: string | null;
  created_by: string | null;
  client: { name?: string | null; company?: string | null } | null;
  lead: { name?: string | null } | null;
}

/**
 * Sales that became "Concluída" in the last 7 days, for the bell: who closed each
 * (the salesperson), for which client, and for how much. `unseen` counts those
 * after the last time the bell was opened on this device. Honours the organization
 * switch (Definições → Vendas → "Avisar a equipa…").
 */
export function useClosedSales() {
  const { organization } = useAuth();
  const { data: org } = useOrganization();
  const enabled = ((org as { sales_settings?: { notify_sale_closed?: boolean } | null } | undefined)?.sales_settings)?.notify_sale_closed !== false;
  const [seenAt, setSeenAt] = usePersistedState<number>("closed-sales-seen-v1", 0);

  const { data: sales = [] } = useQuery({
    queryKey: ["closed-sales", organization?.id],
    enabled: !!organization?.id && enabled,
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      const since = new Date(Date.now() - WEEK_MS).toISOString();
      const { data, error } = await (supabase.from("sales")
        .select("id, code, total_value, approved_at, seller_id, created_by, client:crm_clients(name, company), lead:leads(name)")
        .eq("organization_id", organization!.id).eq("status", "delivered").gte("approved_at", since)
        .order("approved_at", { ascending: false }).limit(8)) as unknown as { data: SaleRow[] | null; error: Error | null };
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: names = {} } = useProfileNames(sales.map(s => s.seller_id ?? s.created_by));
  const list: ClosedSale[] = useMemo(() => sales.map(s => {
    const who = s.seller_id ?? s.created_by;
    const client = s.client;
    const lead = s.lead;
    return {
      id: s.id, code: s.code, total_value: s.total_value, closedAt: s.approved_at ?? new Date(0).toISOString(),
      seller: who ? (names[who] ?? null) : null,
      client: client?.name || client?.company || lead?.name || null,
    };
  }), [sales, names]);

  const unseen = list.filter(s => new Date(s.closedAt).getTime() > seenAt).length;
  return { enabled, list, unseen, markSeen: () => setSeenAt(Date.now()) };
}
