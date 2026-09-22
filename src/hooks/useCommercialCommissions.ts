import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { fetchSplitsBySale } from '@/hooks/useCommissionSplits';
import { useTeamMembers } from '@/hooks/useTeam';
import { startOfMonth, endOfMonth, startOfDay, endOfDay, parseISO, format } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { toast } from 'sonner';
import { isTelecomCommissionEarned, telecomTeamCommission, TELECOM_EARNED_STATUSES, telecomCommissionDate, telecomCommissionInPeriod } from '@/lib/telecom-finance';
import { buildSaleTypeIds, saleMatchesCommissionFilters, type CommissionFilters } from '@/lib/commission-filters';
import { useServicosProducts } from '@/hooks/useServicosProducts';

export interface CommissionItem {
  kind: 'direct' | 'recurring';
  id: string;            // saleId (direct) or stripe record id (recurring)
  label: string;         // client / sale label
  date: string | null;
  amount: number;        // commission amount
  saleValue: number | null; // sale total value (direct sales); null for recurring
  paid: boolean;
  proportional?: boolean; // true when amount is proportional to partial payment
  expectedMonth?: boolean;
}

export interface CommercialCommission {
  userId: string;
  name: string;
  items: CommissionItem[];
  total: number;
  totalPending: number;
  totalPaid: number;
  pendingSaleIds: string[];
  pendingRecordIds: string[];
}

export interface CommercialCommissionsData {
  commercials: CommercialCommission[];
  total: number;
  totalPending: number;
}

export interface OrganizationCommissionSale {
  id: string;
  code: string | null;
  clientName: string;
  date: string | null;
  telecomStatus: string;
  deferred: boolean;
  amount: number;
}

/**
 * Unified per-commercial commissions for a month: direct-sale commissions
 * (sales.comissao) + recurring Stripe commissions (stripe_commission_records),
 * each carrying a paid/pending flag. Commercial resolved as
 * client.assigned_to → lead.assigned_to → sales.created_by.
 */
export function useCommercialCommissions(selectedMonth: string, effectiveUserIds?: string[] | null, financeOptions?: { dateRange?: DateRange; commissionFilters?: CommissionFilters }) {
  const { organization } = useAuth();
  const { data: members } = useTeamMembers();
  const organizationId = organization?.id;
  const isTelecom = organization?.niche === 'telecom';
  const { catalog } = useServicosProducts();
  const saleTypeIds = buildSaleTypeIds(catalog ?? []);

  return useQuery<CommercialCommissionsData>({
    queryKey: ['commercial-commissions', organizationId, selectedMonth, members?.length, effectiveUserIds, financeOptions, catalog, isTelecom ? TELECOM_EARNED_STATUSES : null, 'payment-month-v1'],
    queryFn: async () => {
      const empty: CommercialCommissionsData = { commercials: [], total: 0, totalPending: 0 };
      if (!organizationId || !selectedMonth) return empty;

      const monthStart = startOfMonth(new Date(selectedMonth));
      const monthEnd = endOfMonth(monthStart);
      const monthStartStr = format(monthStart, 'yyyy-MM-dd');
      const monthEndStr = format(monthEnd, 'yyyy-MM-dd');

      // --- Direct commissions (delivered/fulfilled sales with commission) ---
      // `as any`: the generated Supabase types in this repo are stale (they
      // predate telecom_status and half a dozen other live columns), and a
      // column they don't know poisons the whole query's type — the same trap
      // that once took the product catalog down.
      const { data: sales, error: salesErr } = await (supabase as any)
        .from('sales')
        .select('id, code, comissao, org_commission, total_value, client_id, lead_id, created_by, seller_id, sale_date, activation_date, commission_paid_at, payment_status, has_recurring, telecom_status, servicos_details, commission_payment_month_offset, commission_expected_date')
        .eq('organization_id', organizationId)
        .in('status', ['delivered', 'fulfilled']);
      if (salesErr) throw salesErr;

      const commissionSales = (sales || []).filter((s: any) => Number(s.comissao || 0) > 0);

      // For recurring sales, fetch existing stripe_commission_records so we
      // can skip the direct commission — the recurring one already covers it.
      const recurringSaleIds = commissionSales
        .filter((s: any) => s.has_recurring)
        .map((s: any) => s.id) as string[];
      const existingRecurringIds = new Set<string>();
      if (recurringSaleIds.length > 0) {
        const { data: recs } = await (supabase as any)
          .from('stripe_commission_records')
          .select('sale_id')
          .in('sale_id', recurringSaleIds);
        for (const r of (recs || []) as any[]) {
          existingRecurringIds.add(r.sale_id);
        }
      }

      const allIds = commissionSales.map((s: any) => s.id);
      const { data: allPays } = allIds.length
        ? await supabase.from('sale_payments').select('sale_id, amount, status, payment_date').in('sale_id', allIds)
        : { data: [] as any[] };

      // --- Direct commissions: proportional to payments received in the month ---
      // A sale with 150€ total and 37.50€ commission that's 50€-paid in June
      // contributes (50/150) × 37.50€ = 12.50€ to June. Subsequent payments in
      // later months contribute their share to those months. One item per
      // (sale, month) keeps React keys and selection unique in the UI.
      const monthKey = format(monthStart, 'yyyy-MM');
      const monthItems: { sale: any; amount: number; date: string; monthKey: string; proportional: boolean }[] = [];
      for (const s of commissionSales) {
        // Skip recurring sales already covered by stripe_commission_records.
        if (s.has_recurring && existingRecurringIds.has(s.id)) continue;

        const tv = Number(s.total_value) || 0;
        const comissao = Number(s.comissao || 0);
        if (comissao <= 0) continue;

        // Telecom is paid by the OPERATOR, not by the client: the commission
        // is earned the moment the line is installed, and there is no client
        // payment to wait for. Tying it to sale_payments (as every other
        // vertical does) left installed sales showing 0 € forever.
        if (isTelecom) {
          if (!isTelecomCommissionEarned(s) || !saleMatchesCommissionFilters(s, financeOptions?.commissionFilters, saleTypeIds)) continue;
          const ref = telecomCommissionDate(s);
          if (!ref) continue;
          const period = financeOptions ? financeOptions.dateRange : { from: monthStart, to: monthEnd };
          if (telecomCommissionInPeriod(s, period)) {
            monthItems.push({ sale: s, amount: comissao, date: ref, monthKey, proportional: false });
          }
          continue;
        }

        const salePays = (allPays as any[]).filter(
          (p: any) => p.sale_id === s.id && p.status === 'paid' && p.payment_date,
        );

        if (salePays.length === 0) {
          // Fallback: payment_status='paid' but no payment rows. Show full
          // commission in the sale month (preserves legacy behavior for
          // sales marked paid without recorded payment rows).
          if (s.payment_status === 'paid') {
            const saleRef = s.activation_date || s.sale_date;
            if (saleRef) {
              const sd = new Date(saleRef);
              if (sd >= monthStart && sd <= monthEnd) {
                monthItems.push({ sale: s, amount: comissao, date: saleRef, monthKey, proportional: false });
              }
            }
          }
          continue;
        }

        if (tv <= 0) continue;
        const ratio = comissao / tv;

        // Sum payments received in the current month only — payments in
        // other months are recognized in their own month view.
        let paidThisMonth = 0;
        let lastPayDate: string | null = null;
        for (const p of salePays) {
          const pd = p.payment_date as string;
          const payDate = new Date(pd);
          if (payDate < monthStart || payDate > monthEnd) continue;
          const amt = Number(p.amount || 0);
          if (amt <= 0) continue;
          paidThisMonth += amt;
          if (!lastPayDate || pd > lastPayDate) lastPayDate = pd;
        }
        if (paidThisMonth <= 0) continue;

        monthItems.push({
          sale: s,
          amount: paidThisMonth * ratio,
          date: lastPayDate || s.activation_date || s.sale_date,
          monthKey,
          proportional: paidThisMonth < tv,
        });
      }

      const clientIds = [...new Set(monthItems.map((mi) => mi.sale.client_id).filter(Boolean))] as string[];
      const leadIds = [...new Set(monthItems.map((mi) => mi.sale.lead_id).filter(Boolean))] as string[];
      const [clientsRes, leadsRes] = await Promise.all([
        clientIds.length
          ? supabase.from('crm_clients').select('id, name, company, assigned_to').in('id', clientIds)
          : Promise.resolve({ data: [] as any[] }),
        leadIds.length
          ? supabase.from('leads').select('id, name, assigned_to').in('id', leadIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const clientMap = new Map<string, any>((clientsRes.data || []).map((c: any) => [c.id, c]));
      const leadMap = new Map<string, any>((leadsRes.data || []).map((l: any) => [l.id, l]));

      const getCommercial = (s: any): string => {
        // An explicit assignment wins over everything: a sale typed in by one
        // person and handed to another belongs to the person it was handed to,
        // whoever the client happens to be assigned to.
        if (s.seller_id) return s.seller_id as string;
        if (s.client_id && clientMap.get(s.client_id)?.assigned_to) return clientMap.get(s.client_id).assigned_to;
        if (s.lead_id && leadMap.get(s.lead_id)?.assigned_to) return leadMap.get(s.lead_id).assigned_to;
        return (s.created_by as string) || 'unassigned';
      };
      const getClientName = (s: any): string => {
        if (s.client_id) { const c = clientMap.get(s.client_id); if (c) return c.name || c.company || 'Cliente'; }
        if (s.lead_id) { const l = leadMap.get(s.lead_id); if (l) return l.name || 'Lead'; }
        return (s.code as string) || 'Venda';
      };

      // --- Recurring commissions (Stripe) ---
      // PENDING = outstanding debt: must show EVERY month until paid, so never
      // filter it by created_at (a June commission left unpaid still shows in July).
      // PAID = historical: keep it scoped to the month it landed in.
      const [pendingRecsRes, paidRecsRes] = await Promise.all([
        (supabase as any)
          .from('stripe_commission_records')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('status', 'pending')
          // Carry forward, not backward: a pending commission shows from its month
          // onwards (created on/before the period end), never in an earlier month.
          .lte('created_at', `${monthEndStr}T23:59:59`),
        (supabase as any)
          .from('stripe_commission_records')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('status', 'paid')
          .gte('created_at', `${monthStartStr}T00:00:00`)
          .lte('created_at', `${monthEndStr}T23:59:59`),
      ]);
      if (pendingRecsRes.error) throw pendingRecsRes.error;
      if (paidRecsRes.error) throw paidRecsRes.error;
      const recs = [...(pendingRecsRes.data || []), ...(paidRecsRes.data || [])] as any[];
      const recOrgIds = [...new Set(recs.map(r => r.client_org_id).filter(Boolean))] as string[];
      const orgsRes = recOrgIds.length
        ? await supabase.from('organizations').select('id, name').in('id', recOrgIds)
        : { data: [] as any[] };
      const orgMap = new Map((orgsRes.data || []).map((o: any) => [o.id, o.name]));

      // Friendly label for recurring records via their linked sale's client
      // (manual renewals have no tenant org, so the org name would be wrong).
      const recSaleIds = [...new Set(recs.map(r => r.sale_id).filter(Boolean))] as string[];
      const recSalesRes = recSaleIds.length
        ? await supabase.from('sales').select('id, client_id, lead_id, code').in('id', recSaleIds)
        : { data: [] as any[] };
      const recSales = (recSalesRes.data as any[]) || [];
      const recCIds = [...new Set(recSales.map(s => s.client_id).filter(Boolean))] as string[];
      const recLIds = [...new Set(recSales.map(s => s.lead_id).filter(Boolean))] as string[];
      const [recCRes, recLRes] = await Promise.all([
        recCIds.length ? supabase.from('crm_clients').select('id, name, company').in('id', recCIds) : Promise.resolve({ data: [] as any[] }),
        recLIds.length ? supabase.from('leads').select('id, name').in('id', recLIds) : Promise.resolve({ data: [] as any[] }),
      ]);
      const recCMap = new Map((recCRes.data || []).map((c: any) => [c.id, c.name || c.company]));
      const recLMap = new Map((recLRes.data || []).map((l: any) => [l.id, l.name]));
      const recSaleLabel = new Map<string, string>(
        recSales.map((s: any) => [s.id, recCMap.get(s.client_id) || recLMap.get(s.lead_id) || s.code || 'Subscrição']),
      );

      const memberName = (userId: string) => {
        if (userId === 'unassigned') return 'Sem Comercial';
        const m = members?.find((m: any) => m.user_id === userId);
        return m?.full_name || 'Desconhecido';
      };

      const byUser = new Map<string, CommercialCommission>();
      const ensure = (userId: string): CommercialCommission => {
        let e = byUser.get(userId);
        if (!e) {
          e = { userId, name: memberName(userId), items: [], total: 0, totalPending: 0, totalPaid: 0, pendingSaleIds: [], pendingRecordIds: [] };
          byUser.set(userId, e);
        }
        return e;
      };

      // A sale can pay several people (sale_commission_splits). Where splits
      // exist the commission is divided by them; sales without splits keep the
      // single-commercial behaviour resolved by getCommercial().
      const splitsBySale = await fetchSplitsBySale(monthItems.map((mi) => mi.sale.id as string));

      for (const mi of monthItems) {
        const s = mi.sale;
        const paid = !!s.commission_paid_at;
        const splits = splitsBySale.get(s.id);

        // mi.amount can already be a fraction of the commission (proportional to
        // the payments received this month), so each share keeps that fraction.
        const saleCommission = Number(s.comissao || 0);
        const factor = saleCommission > 0 ? mi.amount / saleCommission : 0;

        const shares = splits && splits.length > 0
          ? splits.map((sp) => ({ userId: sp.user_id, amount: sp.amount * factor }))
          : [{ userId: getCommercial(s), amount: isTelecom ? telecomTeamCommission(s) : mi.amount }];

        for (const share of shares) {
          if (!share.userId) continue;
          const e = ensure(share.userId);
          e.items.push({
            kind: 'direct',
            id: s.id,
            label: getClientName(s),
            date: mi.date,
            amount: share.amount,
            saleValue: Number(s.total_value || 0),
            paid,
            proportional: mi.proportional,
            expectedMonth: isTelecom && Number(s.commission_payment_month_offset || 0) > 0,
          });
          e.total += share.amount;
          if (paid) e.totalPaid += share.amount;
          else { e.totalPending += share.amount; e.pendingSaleIds.push(s.id); }
        }
      }
      for (const r of recs) {
        const e = ensure((r.user_id as string) || 'unassigned');
        const amount = Number(r.commission_amount || 0);
        const paid = r.status === 'paid';
        e.items.push({ kind: 'recurring', id: r.id, label: recSaleLabel.get(r.sale_id) || orgMap.get(r.client_org_id) || 'Subscrição', date: r.created_at, amount, saleValue: Number(r.amount || 0), paid });
        e.total += amount;
        if (paid) e.totalPaid += amount; else { e.totalPending += amount; e.pendingRecordIds.push(r.id); }
      }

      let commercials = Array.from(byUser.values());
      if (effectiveUserIds && effectiveUserIds.length > 0) {
        commercials = commercials.filter(c => effectiveUserIds.includes(c.userId));
      }
      commercials.forEach(c => c.items.sort((a, b) => (b.date || '').localeCompare(a.date || '')));
      commercials.sort((a, b) => b.totalPending - a.totalPending || b.total - a.total);

      const total = commercials.reduce((s, c) => s + c.total, 0);
      const totalPending = commercials.reduce((s, c) => s + c.totalPending, 0);
      return { commercials, total, totalPending };
    },
    enabled: !!organizationId && !!selectedMonth,
  });
}

/**
 * Org-wide commission total for a date range (for the Resumo "Comissões" card):
 * direct-sale commissions (delivered/fulfilled, by activation/sale date) +
 * pending recurring commissions (by created_at). When no range is given,
 * returns the all-time total.
 */
export function useTeamCommissionTotal(dateRange?: DateRange, commissionFilters?: CommissionFilters) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const isTelecom = organization?.niche === 'telecom';
  const { catalog } = useServicosProducts();
  const saleTypeIds = buildSaleTypeIds(catalog ?? []);
  const fromKey = dateRange?.from ? dateRange.from.toISOString() : 'all';
  const toKey = dateRange?.to ? dateRange.to.toISOString() : 'none';

  return useQuery<{ total: number; count: number; orgTotal: number; grossTotal: number; paidTotal: number; organizationSales: OrganizationCommissionSale[] }>({
    queryKey: ['team-commission-total', orgId, fromKey, toKey, commissionFilters, catalog, isTelecom ? TELECOM_EARNED_STATUSES : null, 'payment-month-v1'],
    queryFn: async () => {
      if (!orgId) return { total: 0, count: 0, orgTotal: 0, grossTotal: 0, paidTotal: 0, organizationSales: [] };

      const inRange = (dateStr?: string | null) => {
        if (!dateRange?.from) return true;
        if (!dateStr) return false;
        const d = parseISO(dateStr);
        if (d < startOfDay(dateRange.from)) return false;
        if (dateRange.to && d > endOfDay(dateRange.to)) return false;
        return true;
      };

      const { data: sales, error: salesError } = await (supabase as any)
        .from('sales')
        .select('id, code, comissao, org_commission, total_value, sale_date, activation_date, payment_status, telecom_status, commission_paid_at, seller_id, created_by, servicos_details, commission_payment_month_offset, commission_expected_date, client:crm_clients(name), lead:leads(name)')
        .eq('organization_id', orgId)
        .in('status', ['delivered', 'fulfilled']);
      if (salesError) throw salesError;

      // Only count commissions on RECEIVED sales (concluded AND fully paid).
      const candidates = ((sales || []) as any[]).filter(
        (s) => (isTelecom ? telecomCommissionInPeriod(s, dateRange) : inRange(s.activation_date || s.sale_date))
          && (isTelecom ? isTelecomCommissionEarned(s) && saleMatchesCommissionFilters(s, commissionFilters, saleTypeIds) : Number(s.comissao || 0) > 0),
      );
      const candIds = candidates.map((s) => s.id);
      const { data: candPays } = candIds.length
        ? await supabase.from('sale_payments').select('sale_id, amount, status').in('sale_id', candIds)
        : { data: [] as any[] };
      const paidSum = new Map<string, number>();
      for (const p of (candPays as any[]) || []) {
        if (p.status === 'paid') paidSum.set(p.sale_id, (paidSum.get(p.sale_id) || 0) + Number(p.amount || 0));
      }

      let total = 0;
      let count = 0;
      // Telecom only: what the operators pay in gross, and what is left for the
      // organization once each seller has taken his own rate.
      let orgTotal = 0;
      let grossTotal = 0;
      // Telecom only: the slice of `total` already marked as paid to the
      // team ("Marcar como paga" stamps commission_paid_at on the sale).
      let paidTotal = 0;
      const organizationSales: OrganizationCommissionSale[] = [];
      for (const s of candidates) {
        // Telecom is paid by the OPERATOR: the commission is earned the moment
        // the line is installed, and there is no client payment to prorate
        // against. Waiting for one left every installed sale at 0 €.
        // sales.comissao is the operator's GROSS; org_commission is the slice no
        // seller took. What the team actually earns is the difference.
        if (isTelecom) {
          if (isTelecomCommissionEarned(s)) {
            const gross = Number(s.comissao || 0);
            const org = Number(s.org_commission || 0);
            grossTotal += gross;
            orgTotal += org;
            organizationSales.push({
              id: s.id,
              code: s.code,
              clientName: s.client?.name || s.lead?.name || '—',
              date: telecomCommissionDate(s),
              deferred: Number(s.commission_payment_month_offset || 0) > 0,
              telecomStatus: s.telecom_status,
              amount: org,
            });
            total += Math.max(gross - org, 0);
            if (s.commission_paid_at) paidTotal += Math.max(gross - org, 0);
            count += 1;
          }
          continue;
        }

        // Commission is earned proportionally to what the client has paid:
        // a sale 80€-paid of 150€ contributes 80/150 of its commission.
        const tv = Number(s.total_value) || 0;
        const fullyPaid = s.payment_status === 'paid' || (tv > 0 && (paidSum.get(s.id) || 0) >= tv - 0.01);
        const fraction = fullyPaid ? 1 : (tv > 0 ? Math.min(1, (paidSum.get(s.id) || 0) / tv) : 0);
        if (fraction > 0) { total += Number(s.comissao || 0) * fraction; count += 1; }
      }

      // Pending recurring commissions are outstanding debt until paid. They carry
      // FORWARD — counted from their month onwards (created on/before the period
      // end) — but never backward into a month before the debt existed.
      const periodEnd = dateRange?.to
        ? endOfDay(dateRange.to)
        : dateRange?.from ? endOfDay(dateRange.from) : null;
      const { data: recs } = await (supabase as any)
        .from('stripe_commission_records')
        .select('commission_amount, status, created_at')
        .eq('organization_id', orgId)
        .eq('status', 'pending');
      for (const r of (recs || []) as any[]) {
        if (!periodEnd || parseISO(r.created_at) <= periodEnd) total += Number(r.commission_amount || 0);
      }

      organizationSales.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.code || '').localeCompare(a.code || ''));
      return { total, count, orgTotal, grossTotal, paidTotal, organizationSales };
    },
    enabled: !!orgId,
  });
}

export function usePayCommercialCommissions() {
  const queryClient = useQueryClient();
  const { organization, session } = useAuth();

  return useMutation({
    mutationFn: async ({ fullName, bankAccountId, saleIds, recordIds, total }: {
      fullName: string;
      bankAccountId: string | null;
      saleIds: string[];
      recordIds: string[];
      total: number;
    }) => {
      const orgId = organization?.id;
      if (!orgId) throw new Error('No organization');
      const nowIso = new Date().toISOString();

      if (saleIds.length) {
        const { error } = await (supabase as any).from('sales')
          .update({ commission_paid_at: nowIso, commission_bank_account_id: bankAccountId })
          .in('id', saleIds);
        if (error) throw error;
      }
      if (recordIds.length) {
        const { error } = await (supabase as any).from('stripe_commission_records')
          .update({ status: 'paid', paid_at: nowIso, bank_account_id: bankAccountId })
          .in('id', recordIds);
        if (error) throw error;
      }
      if (total > 0) {
        // Use a "Comissões" expense category if one exists (best-effort).
        const { data: cat } = await (supabase as any).from('expense_categories')
          .select('id').eq('organization_id', orgId).ilike('name', 'comiss%').limit(1).maybeSingle();
        const { error: expErr } = await (supabase as any).from('expenses').insert({
          organization_id: orgId,
          category_id: cat?.id ?? null,
          description: `Comissão paga — ${fullName}`,
          amount: total,
          expense_date: nowIso.split('T')[0],
          is_recurring: false,
          notes: `Comissão paga a ${fullName}`,
          created_by: session?.user?.id || null,
          bank_account_id: bankAccountId,
        });
        if (expErr) throw expErr;
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['commercial-commissions'] }),
        queryClient.invalidateQueries({ queryKey: ['stripe-commissions'] }),
        queryClient.invalidateQueries({ queryKey: ['team-commissions'] }),
        queryClient.invalidateQueries({ queryKey: ['expenses'] }),
        queryClient.invalidateQueries({ queryKey: ['expenses-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['finance-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['team-commission-total'] }),
        queryClient.invalidateQueries({ queryKey: ['my-commissions'] }),
      ]);
      toast.success('Comissões marcadas como pagas e registadas como despesa!');
    },
    onError: () => toast.error('Erro ao pagar comissões'),
  });
}

/**
 * Mark a single commission item as paid without recording an expense — for
 * cases where payment happened externally (bank transfer, cash) and the user
 * just needs the flag flipped so the item stops showing as pending.
 */
export function useMarkCommissionPaid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, id }: { kind: 'direct' | 'recurring'; id: string }) => {
      const nowIso = new Date().toISOString();
      if (kind === 'direct') {
        const { error } = await (supabase as any).from('sales')
          .update({ commission_paid_at: nowIso })
          .eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('stripe_commission_records')
          .update({ status: 'paid', paid_at: nowIso })
          .eq('id', id);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['commercial-commissions'] });
      await queryClient.invalidateQueries({ queryKey: ['team-commission-total'] });
      toast.success('Comissão marcada como paga.');
    },
    onError: () => toast.error('Erro ao marcar comissão'),
  });
}
