import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';
import { isBdsOrganization, parseChargebackAmount } from '@/lib/bds-finance';
import { bdsFinanceSupabase } from '@/lib/bds-finance-client';

export type ChargebackStatus = 'pending' | 'reconciled' | 'dismissed';

export interface SaleChargeback {
  id: string;
  organization_id: string;
  sale_id: string | null;
  client_id: string | null;
  user_id: string;
  amount: number;
  reason: string;
  status: ChargebackStatus;
  created_at: string;
  updated_at: string;
  /** Joined for display. */
  sale?: { code: string | null; sale_date: string | null; client_id: string | null; total_value: number | null } | null;
  beneficiary_name?: string | null;
  client?: { name: string } | null;
}

export const CHARGEBACK_STATUS_LABELS: Record<ChargebackStatus, string> = {
  pending: 'Por confirmar',
  reconciled: 'Confirmado',
  dismissed: 'Descartado',
};

/**
 * Commission staged for clawback when a telecom sale is cancelled after
 * install. Written server-side by sync_sale_chargebacks(); this hook only
 * reads them and lets an admin confirm/dismiss once the operator's own
 * chargeback file settles the matter.
 */
export function useSaleChargebacks() {
  const { organization } = useAuth();
  const orgId = organization?.id;

  return useQuery({
    queryKey: ['sale-chargebacks', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<SaleChargeback[]> => {
      const { data, error } = await (supabase as any)
        .from('sale_chargebacks')
        .select('*, sale:sales(code, sale_date, client_id, total_value)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });
      if (error) throw error;

      let rows = (data ?? []) as unknown as SaleChargeback[];
      if (isBdsOrganization(organization?.name)) {
        const { data: manualRows, error: manualError } = await bdsFinanceSupabase
          .from('bds_manual_chargebacks')
          .select('*')
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false });
        if (manualError) throw manualError;
        const manualClientIds = [...new Set((manualRows ?? []).map((row) => row.client_id).filter((id): id is string => !!id))];
        const { data: manualClients, error: manualClientsError } = manualClientIds.length
          ? await supabase.from('crm_clients').select('id, name').in('id', manualClientIds)
          : { data: [], error: null };
        if (manualClientsError) throw manualClientsError;
        const clientNames = new Map((manualClients ?? []).map((client) => [client.id, client.name]));
        rows = [...rows, ...(manualRows ?? []).map((row) => ({ ...row, sale: null, client: row.client_id ? { name: clientNames.get(row.client_id) ?? 'Cliente' } : null }))]
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
      }
      const userIds = [...new Set(rows.map(r => r.user_id))];
      if (userIds.length === 0) return rows;

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);
      const nameById = new Map((profiles ?? []).map(p => [p.id, p.full_name]));

      return rows.map(r => ({ ...r, beneficiary_name: nameById.get(r.user_id) ?? null }));
    },
  });
}

export function useUpdateChargebackStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status, manual }: { id: string; status: ChargebackStatus; manual?: boolean }) => {
      if (manual) {
        const { error: manualError } = await bdsFinanceSupabase
          .from('bds_manual_chargebacks')
          .update({ status })
          .eq('id', id);
        if (manualError) throw manualError;
        return;
      }
      const { error } = await (supabase as any)
        .from('sale_chargebacks')
        .update({ status })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sale-chargebacks'] });
      toast.success('Chargeback atualizado');
    },
    onError: (error: Error) => {
      toast.error(`Erro ao atualizar chargeback: ${error.message}`);
    },
  });
}

export function useCreateManualChargeback() {
  const queryClient = useQueryClient();
  const { data: organization } = useOrganization();

  return useMutation({
    mutationFn: async ({ userId, amountText, clientId }: { userId: string; amountText: string; clientId: string | null }) => {
      if (!organization?.id || !isBdsOrganization(organization.name)) throw new Error('Chargeback manual disponível apenas para a BDS.');
      const amount = parseChargebackAmount(amountText);
      if (!amount) throw new Error('Indica um valor superior a 0 €.');
      if (!userId) throw new Error('Seleciona o comercial.');
      const { error } = await bdsFinanceSupabase
        .from('bds_manual_chargebacks')
        .insert({
          organization_id: organization.id,
          client_id: clientId || null,
          user_id: userId,
          amount,
          reason: 'manual',
          status: 'reconciled',
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sale-chargebacks'] });
      queryClient.invalidateQueries({ queryKey: ['commercial-commissions'] });
      queryClient.invalidateQueries({ queryKey: ['finance-stats'] });
      toast.success('Chargeback manual registado');
    },
    onError: (error: Error) => toast.error(error.message || 'Não foi possível registar o chargeback.'),
  });
}
