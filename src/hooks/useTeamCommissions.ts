import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { fetchSplitsBySale } from '@/hooks/useCommissionSplits';
import { useTeamMembers } from '@/hooks/useTeam';
import { telecomCommissionDate } from '@/lib/telecom-finance';
import { startOfMonth, endOfMonth } from 'date-fns';

export interface TeamCommissionSale {
  saleId: string;
  saleCode: string | null;
  clientName: string | null;
  saleDate: string | null;
  activationDate: string | null;
  totalValue: number;
  comissao: number;
}

export interface TeamCommissionEntry {
  userId: string;
  name: string;
  totalCommission: number;
  salesCount: number;
  sales: TeamCommissionSale[];
}

export interface TeamCommissionsData {
  commercials: TeamCommissionEntry[];
  totalCommission: number;
  salesCount: number;
}

/**
 * Per-commercial commission breakdown for delivered/fulfilled sales in the
 * given month. Works the same for energy and telecom — both write to
 * `sales.comissao` (energy via the CPE engine, telecom via the
 * compute_sale_commission trigger). The "commercial" of a sale is resolved as:
 *   client.assigned_to  →  lead.assigned_to  →  sales.created_by
 *
 * @param selectedMonth yyyy-MM-dd (any date in the month works)
 * @param effectiveUserIds optional filter to a specific subset of commercials
 */
export function useTeamCommissions(selectedMonth: string, effectiveUserIds?: string[] | null) {
  const { organization } = useAuth();
  const { data: members } = useTeamMembers();
  const organizationId = organization?.id;
  const isTelecom = organization?.niche === 'telecom';

  return useQuery<TeamCommissionsData>({
    queryKey: ['team-commissions', organizationId, selectedMonth, members?.length, isTelecom],
    queryFn: async () => {
      const empty: TeamCommissionsData = { commercials: [], totalCommission: 0, salesCount: 0 };
      if (!organizationId || !selectedMonth) return empty;

      const monthStart = startOfMonth(new Date(selectedMonth));
      const monthEnd = endOfMonth(monthStart);

      const { data: sales, error } = await supabase
        .from('sales')
        .select('id, code, comissao, total_value, client_id, lead_id, created_by, sale_date, activation_date, scheduled_install_date')
        .eq('organization_id', organizationId)
        .in('status', ['delivered', 'fulfilled']);

      if (error) throw error;
      if (!sales || sales.length === 0) return empty;

      // Filter to the selected month using activation_date if set, else sale_date
      const inMonth = sales.filter(s => {
        const ref = isTelecom ? telecomCommissionDate(s) : s.activation_date || s.sale_date;
        if (!ref) return false;
        const d = new Date(ref);
        return d >= monthStart && d <= monthEnd;
      });

      if (inMonth.length === 0) return empty;

      // Resolve clients and leads to find the commercial for each sale
      const clientIds = [...new Set(inMonth.map(s => s.client_id).filter(Boolean))] as string[];
      const leadIds = [...new Set(inMonth.map(s => s.lead_id).filter(Boolean))] as string[];

      const [clientsRes, leadsRes] = await Promise.all([
        clientIds.length > 0
          ? supabase.from('crm_clients').select('id, name, company, assigned_to').in('id', clientIds)
          : Promise.resolve({ data: [] as any[] }),
        leadIds.length > 0
          ? supabase.from('leads').select('id, name, assigned_to').in('id', leadIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const clientMap = new Map<string, any>((clientsRes.data || []).map((c: any) => [c.id, c]));
      const leadMap = new Map<string, any>((leadsRes.data || []).map((l: any) => [l.id, l]));

      const getCommercial = (s: any): string | null => {
        if (s.client_id) {
          const c = clientMap.get(s.client_id);
          if (c?.assigned_to) return c.assigned_to as string;
        }
        if (s.lead_id) {
          const l = leadMap.get(s.lead_id);
          if (l?.assigned_to) return l.assigned_to as string;
        }
        return (s.created_by as string) || null;
      };

      const getClientName = (s: any): string | null => {
        if (s.client_id) {
          const c = clientMap.get(s.client_id);
          if (c) return (c.name as string) || (c.company as string) || null;
        }
        if (s.lead_id) {
          const l = leadMap.get(s.lead_id);
          if (l) return (l.name as string) || null;
        }
        return null;
      };

      const memberName = (userId: string) => {
        if (userId === 'unassigned') return 'Sem Comercial';
        const m = members?.find((m: any) => m.user_id === userId);
        return m?.full_name || 'Desconhecido';
      };

      // Sales can pay several people (sale_commission_splits). Without splits
      // the whole commission still goes to the resolved commercial.
      const splitsBySale = await fetchSplitsBySale(inMonth.map((s) => s.id as string));

      const byUser = new Map<string, TeamCommissionEntry>();
      for (const sale of inMonth) {
        const commission = Number(sale.comissao || 0);
        const splits = splitsBySale.get(sale.id);
        const shares = splits && splits.length > 0
          ? splits.map((sp) => ({ userId: sp.user_id, amount: sp.amount }))
          : [{ userId: getCommercial(sale) || 'unassigned', amount: commission }];

        for (const share of shares) {
          const userId = share.userId || 'unassigned';
          let entry = byUser.get(userId);
          if (!entry) {
            entry = { userId, name: memberName(userId), totalCommission: 0, salesCount: 0, sales: [] };
            byUser.set(userId, entry);
          }
          entry.totalCommission += share.amount;
          entry.salesCount += 1;
          entry.sales.push({
            saleId: sale.id,
            saleCode: (sale.code as string) || null,
            clientName: getClientName(sale),
            saleDate: sale.sale_date as string | null,
            activationDate: isTelecom ? telecomCommissionDate(sale) : sale.activation_date as string | null,
            totalValue: Number(sale.total_value || 0),
            comissao: share.amount,
          });
        }
      }

      let commercials = Array.from(byUser.values());
      if (effectiveUserIds && effectiveUserIds.length > 0) {
        commercials = commercials.filter(c => effectiveUserIds.includes(c.userId));
      }
      commercials.sort((a, b) => b.totalCommission - a.totalCommission);

      // Sort sales within each commercial by date desc
      for (const entry of commercials) {
        entry.sales.sort((a, b) => {
          const da = a.activationDate || a.saleDate || '';
          const db = b.activationDate || b.saleDate || '';
          return db.localeCompare(da);
        });
      }

      const totalCommission = commercials.reduce((sum, c) => sum + c.totalCommission, 0);
      const salesCount = commercials.reduce((sum, c) => sum + c.salesCount, 0);

      return { commercials, totalCommission, salesCount };
    },
    enabled: !!organizationId && !!selectedMonth,
  });
}
