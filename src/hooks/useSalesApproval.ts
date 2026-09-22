import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { isTelecomCommissionEarned, telecomTeamCommission, TELECOM_EARNED_STATUSES } from '@/lib/telecom-finance';

export interface PendingApprovalSale {
  id: string;
  code: string | null;
  total_value: number;
  comissao: number | null;
  status: string;
  sale_date: string | null;
  activation_date: string | null;
  created_at: string;
  client_id: string | null;
  lead_id: string | null;
  notes: string | null;
  client_name: string | null;
  commercial_id: string | null;
  commercial_name: string | null;
}

/**
 * Sales waiting for admin approval (status pending / in_progress).
 * Resolves the "commercial" via the linked client.assigned_to (or lead.assigned_to)
 * and their profile name, the way useLiveCommissions does it.
 */
export function usePendingApprovalSales() {
  const { organization } = useAuth();
  const organizationId = organization?.id;

  return useQuery({
    queryKey: ['sales-pending-approval', organizationId],
    queryFn: async (): Promise<PendingApprovalSale[]> => {
      if (!organizationId) return [];

      const { data: sales, error } = await supabase
        .from('sales')
        .select('id, code, total_value, comissao, status, sale_date, activation_date, created_at, client_id, lead_id, notes')
        .eq('organization_id', organizationId)
        .in('status', ['pending', 'in_progress'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      if (!sales || sales.length === 0) return [];

      const clientIds = [...new Set(sales.map(s => s.client_id).filter(Boolean))] as string[];
      const leadIds = [...new Set(sales.map(s => s.lead_id).filter(Boolean))] as string[];

      const [clientsRes, leadsRes] = await Promise.all([
        clientIds.length > 0
          ? supabase.from('crm_clients').select('id, name, company, assigned_to').in('id', clientIds)
          : Promise.resolve({ data: [] as any[], error: null }),
        leadIds.length > 0
          ? supabase.from('leads').select('id, name, assigned_to').in('id', leadIds)
          : Promise.resolve({ data: [] as any[], error: null }),
      ]);

      const clientMap = new Map((clientsRes.data || []).map((c: any) => [c.id, c]));
      const leadMap = new Map((leadsRes.data || []).map((l: any) => [l.id, l]));

      const userIds = new Set<string>();
      for (const s of sales) {
        const c = s.client_id ? clientMap.get(s.client_id) : null;
        const l = s.lead_id ? leadMap.get(s.lead_id) : null;
        const uid = (c?.assigned_to as string | null) || (l?.assigned_to as string | null);
        if (uid) userIds.add(uid);
      }

      const profileMap = new Map<string, string>();
      if (userIds.size > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', Array.from(userIds));
        for (const p of profiles || []) {
          profileMap.set(p.id as string, (p.full_name as string) || '');
        }
      }

      return sales.map(s => {
        const c = s.client_id ? clientMap.get(s.client_id) : null;
        const l = s.lead_id ? leadMap.get(s.lead_id) : null;
        const commercialId = (c?.assigned_to as string | null) || (l?.assigned_to as string | null) || null;
        return {
          id: s.id,
          code: s.code,
          total_value: s.total_value,
          comissao: s.comissao,
          status: s.status,
          sale_date: s.sale_date,
          activation_date: s.activation_date,
          created_at: s.created_at,
          client_id: s.client_id,
          lead_id: s.lead_id,
          notes: s.notes,
          client_name: (c?.name as string) || (c?.company as string) || (l?.name as string) || null,
          commercial_id: commercialId,
          commercial_name: commercialId ? (profileMap.get(commercialId) || null) : null,
        };
      });
    },
    enabled: !!organizationId,
  });
}

/**
 * Approve a sale: mark it delivered and record who/when. Triggers the
 * existing commission pipeline (useLiveCommissions counts delivered sales).
 */
export function useApproveSale() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (saleId: string) => {
      const { error } = await supabase
        .from('sales')
        .update({
          status: 'delivered',
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', saleId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-pending-approval'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['my-commissions'] });
      queryClient.invalidateQueries({ queryKey: ['commissions-live'] });
      toast({
        title: 'Instalação confirmada',
        description: 'A comissão passou a confirmada na vista do comercial.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Erro ao confirmar',
        description: error?.message || 'Não foi possível confirmar a instalação.',
        variant: 'destructive',
      });
    },
  });
}

/**
 * Revert an approval: send the sale back to in_progress and clear the
 * audit fields. Useful when an admin marked something by mistake.
 */
export function useUnapproveSale() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (saleId: string) => {
      const { error } = await supabase
        .from('sales')
        .update({ status: 'in_progress', approved_by: null, approved_at: null })
        .eq('id', saleId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-pending-approval'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['my-commissions'] });
      queryClient.invalidateQueries({ queryKey: ['commissions-live'] });
      toast({
        title: 'Aprovação revertida',
        description: 'A venda voltou para "Em curso".',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Erro ao reverter',
        description: error?.message || 'Não foi possível reverter a aprovação.',
        variant: 'destructive',
      });
    },
  });
}

export interface MyCommissionSale {
  commission_payment_month_offset?: number;
  commission_expected_date?: string | null;
  /** Telecom commission is earned by lifecycle, independently of client receipts. */
  earned_by_operator?: boolean;
  id: string;
  code: string | null;
  status: string;
  total_value: number;
  comissao: number | null;
  sale_date: string | null;
  activation_date: string | null;
  created_at: string;
  approved_at: string | null;
  client_name: string | null;
  /** True when the sale is fully paid (sum of paid parcels >= total, or payment_status paid). */
  is_paid: boolean;
  /** Amount the client has actually paid so far (sum of paid parcels). Used to
   *  apportion commission proportionally between confirmed and pending. */
  paid_amount: number;
  /** 'direct' = one-off/initial sale; 'recurring' = a recurring renewal commission. */
  kind: 'direct' | 'recurring';
}

/**
 * The current user's personal sales: those whose client OR lead is assigned
 * to them, OR that they created. Returned for both admins and salespeople so
 * an admin who also works deals sees only their own here (the team view lives
 * in CommissionsWidget / Aprovar Instalações).
 */
export function useMyCommissions() {
  const { user, organization } = useAuth();
  const organizationId = organization?.id;
  const userId = user?.id;
  const isTelecom = organization?.niche === 'telecom';

  return useQuery({
    queryKey: ['my-commissions', organizationId, userId, isTelecom ? TELECOM_EARNED_STATUSES : null, 'payment-month-v1'],
    queryFn: async (): Promise<MyCommissionSale[]> => {
      if (!organizationId || !userId) return [];

      const [clientsRes, leadsRes] = await Promise.all([
        supabase
          .from('crm_clients')
          .select('id, name, company')
          .eq('organization_id', organizationId)
          .eq('assigned_to', userId),
        supabase
          .from('leads')
          .select('id, name')
          .eq('organization_id', organizationId)
          .eq('assigned_to', userId),
      ]);
      const clients = clientsRes.data || [];
      const leads = leadsRes.data || [];
      const clientNameMap = new Map<string, string | null>(
        clients.map((c: any) => [c.id as string, (c.name as string) || (c.company as string) || null])
      );
      const leadNameMap = new Map<string, string | null>(
        leads.map((l: any) => [l.id as string, (l.name as string) || null])
      );

      // A sale belongs to whoever it is ASSIGNED to, not whoever typed it in:
      // an admin often enters a sale on someone else's behalf. seller_id is
      // that assignment; created_by is only the fallback for sales made before
      // it existed, and must not claim a sale that was handed to someone else.
      const filters: string[] = [`seller_id.eq.${userId}`, `and(seller_id.is.null,created_by.eq.${userId})`];
      if (clients.length > 0) filters.push(`client_id.in.(${clients.map(c => c.id).join(',')})`);
      if (leads.length > 0) filters.push(`lead_id.in.(${leads.map(l => l.id).join(',')})`);

      const { data: sales, error } = await (supabase as any)
        .from('sales')
        .select('id, code, status, telecom_status, total_value, comissao, org_commission, sale_date, activation_date, created_at, approved_at, client_id, lead_id, payment_status, created_by, seller_id, commission_payment_month_offset, commission_expected_date')
        .eq('organization_id', organizationId)
        .or(filters.join(','))
        .order('created_at', { ascending: false });
      if (error) throw error;
      if (!sales) return [];

      // Determine which sales are fully paid (commission only counts when the
      // sale is concluded AND paid). Sum the paid parcels per sale.
      const saleIds = sales.map((s: any) => s.id);
      const { data: pays } = saleIds.length > 0
        ? await supabase.from('sale_payments').select('sale_id, amount, status').in('sale_id', saleIds)
        : { data: [] as any[] };
      const paidSum = new Map<string, number>();
      for (const p of (pays as any[]) || []) {
        if (p.status === 'paid') paidSum.set(p.sale_id, (paidSum.get(p.sale_id) || 0) + Number(p.amount || 0));
      }

      // What THIS person earns on each sale. sales.comissao is the operator's
      // gross — showing it here would tell a salesperson he made 210€ on a
      // sale that pays him 180€. The frozen split rows are his actual pay.
      //
      // Fetched for EVERYONE, not just this user, to tell two different cases
      // apart: a sale nobody has a split on (an org with no commission rules —
      // fall back to the sale's own figure) versus a sale whose splits pay
      // someone ELSE. The second is the common one — a sale typed in by one
      // person and assigned to another — and treating it like the first showed
      // the typist his colleague's commission as if it were his own.
      const { data: allSplits } = saleIds.length > 0
        ? await (supabase as any)
            .from('sale_commission_splits')
            .select('sale_id, user_id, amount')
            .in('sale_id', saleIds)
        : { data: [] as any[] };
      const saleHasSplits = new Set<string>(((allSplits as any[]) || []).map((sp) => sp.sale_id));
      const mySplits = ((allSplits as any[]) || []).filter((sp) => sp.user_id === userId);
      const myAmountBySale = new Map<string, number>();
      for (const sp of (mySplits as any[]) || []) {
        myAmountBySale.set(sp.sale_id, (myAmountBySale.get(sp.sale_id) || 0) + Number(sp.amount || 0));
      }

      // Resolve client/lead names for ALL returned sales — not only those whose
      // client/lead is assigned to the user (e.g. sales the user created, whose
      // client may be unassigned or assigned to someone else).
      const saleClientIds = [...new Set(sales.map((s: any) => s.client_id).filter(Boolean))] as string[];
      const saleLeadIds = [...new Set(sales.map((s: any) => s.lead_id).filter(Boolean))] as string[];
      const [moreClientsRes, moreLeadsRes] = await Promise.all([
        saleClientIds.length > 0
          ? supabase.from('crm_clients').select('id, name, company').in('id', saleClientIds)
          : Promise.resolve({ data: [] as any[] }),
        saleLeadIds.length > 0
          ? supabase.from('leads').select('id, name').in('id', saleLeadIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      for (const c of (moreClientsRes.data as any[]) || []) {
        if (!clientNameMap.has(c.id)) clientNameMap.set(c.id, (c.name as string) || (c.company as string) || null);
      }
      for (const l of (moreLeadsRes.data as any[]) || []) {
        if (!leadNameMap.has(l.id)) leadNameMap.set(l.id, (l.name as string) || null);
      }

      const nameOfSale = (s: any): string | null =>
        (s.client_id && clientNameMap.get(s.client_id)) ||
        (s.lead_id && leadNameMap.get(s.lead_id)) ||
        null;

      const directResults: MyCommissionSale[] = sales.map((s: any) => {
        const paid = paidSum.get(s.id) || 0;
        const tv = Number(s.total_value) || 0;
        const fullyPaid = (tv > 0 && paid >= tv - 0.01) || s.payment_status === 'paid';
        return {
          id: s.id,
          code: s.code,
          status: s.status,
          total_value: s.total_value,
          // His own share once the sale pays anybody; the sale's own figure
          // only when it carries no split rules at all. A sale that pays
          // someone else contributes 0 to HIS commissions, not its gross.
          comissao: saleHasSplits.has(s.id) ? (myAmountBySale.get(s.id) ?? 0) : (isTelecom ? telecomTeamCommission(s) : s.comissao),
          earned_by_operator: isTelecom && isTelecomCommissionEarned(s),
          commission_payment_month_offset: s.commission_payment_month_offset,
          commission_expected_date: s.commission_expected_date,
          sale_date: s.sale_date,
          activation_date: s.activation_date,
          created_at: s.created_at,
          approved_at: s.approved_at,
          client_name: nameOfSale(s),
          is_paid: fullyPaid,
          // A sale flagged paid via payment_status (no parcels) counts as fully received.
          paid_amount: fullyPaid ? tv : paid,
          kind: 'direct',
        };
      });

      // Recurring commissions (Stripe + manual renewals) attributed to this user.
      // These are always "earned" (the client already paid the renewal).
      const saleClientName = new Map<string, string | null>(
        (sales as any[]).map((s) => [s.id as string, nameOfSale(s)]),
      );
      const { data: recRecords } = await supabase
        .from('stripe_commission_records' as any)
        .select('id, sale_id, amount, commission_amount, plan, created_at')
        .eq('organization_id', organizationId)
        .eq('user_id', userId);
      const recurringResults: MyCommissionSale[] = ((recRecords as any[]) || []).map((r) => ({
        id: r.id,
        code: 'Recorrente',
        status: 'delivered',
        total_value: Number(r.amount || 0),
        comissao: Number(r.commission_amount || 0),
        sale_date: r.created_at,
        activation_date: r.created_at,
        created_at: r.created_at,
        approved_at: r.created_at,
        client_name: (r.sale_id && saleClientName.get(r.sale_id)) || r.plan || 'Subscrição',
        is_paid: true,
        paid_amount: Number(r.amount || 0),
        kind: 'recurring',
      }));

      return [...directResults, ...recurringResults].sort((a, b) =>
        (b.sale_date || b.created_at || '').localeCompare(a.sale_date || a.created_at || ''),
      );
    },
    enabled: !!organizationId && !!userId,
  });
}
