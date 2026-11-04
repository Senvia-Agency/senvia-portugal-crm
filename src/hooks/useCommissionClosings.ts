import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { tr } from '@/i18n';

export interface CommissionClosingItem {
  id: string;
  closing_id: string;
  organization_id: string;
  user_id: string;
  total_consumo_mwh: number;
  volume_tier: string;
  total_commission: number; // net (gross − chargeback)
  total_chargeback: number;
  items_detail: any[];
  created_at: string;
}

export interface CommissionClosing {
  id: string;
  organization_id: string;
  month: string;
  closed_by: string;
  closed_at: string;
  total_commission: number; // net (gross − chargeback)
  total_chargeback: number;
  notes: string | null;
  created_at: string;
}

export function useCommissionClosings() {
  const { organization, user } = useAuth();
  const organizationId = organization?.id;
  const queryClient = useQueryClient();

  const { data: closings, isLoading } = useQuery({
    queryKey: ['commission-closings', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from('commission_closings')
        .select('*')
        .eq('organization_id', organizationId)
        .order('month', { ascending: false });
      if (error) throw error;
      return (data || []) as CommissionClosing[];
    },
    enabled: !!organizationId,
  });

  const getClosingForMonth = (month: string) => {
    return closings?.find(c => c.month === month) || null;
  };

  const { data: closingItems } = useQuery({
    queryKey: ['commission-closing-items', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from('commission_closing_items')
        .select('*')
        .eq('organization_id', organizationId);
      if (error) throw error;
      return (data || []) as CommissionClosingItem[];
    },
    enabled: !!organizationId,
  });

  const getItemsForClosing = (closingId: string) => {
    return closingItems?.filter(i => i.closing_id === closingId) || [];
  };

  const closeMonth = useMutation({
    mutationFn: async (params: {
      month: string;
      totalCommission: number; // net total
      totalChargeback?: number;
      notes?: string;
      items: Array<{
        user_id: string;
        total_consumo_mwh: number;
        volume_tier: string;
        total_commission: number; // net (gross − chargeback)
        total_chargeback?: number;
        items_detail: any[];
      }>;
    }) => {
      if (!organizationId || !user?.id) throw new Error('No org/user');

      // Insert closing
      const { data: closing, error: closingError } = await supabase
        .from('commission_closings')
        .insert({
          organization_id: organizationId,
          month: params.month,
          closed_by: user.id,
          total_commission: params.totalCommission,
          total_chargeback: params.totalChargeback ?? 0,
          notes: params.notes || null,
        } as any)
        .select()
        .single();
      if (closingError) throw closingError;

      // Insert items
      const itemsToInsert = params.items.map(item => ({
        closing_id: (closing as any).id,
        organization_id: organizationId,
        user_id: item.user_id,
        total_consumo_mwh: item.total_consumo_mwh,
        volume_tier: item.volume_tier,
        total_commission: item.total_commission,
        total_chargeback: item.total_chargeback ?? 0,
        items_detail: item.items_detail,
      }));

      const { error: itemsError } = await supabase
        .from('commission_closing_items')
        .insert(itemsToInsert as any);
      if (itemsError) throw itemsError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-closings', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['commission-closing-items', organizationId] });
      toast.success(tr('Mês fechado com sucesso'));
    },
    onError: (err: any) => {
      if (err?.message?.includes('unique') || err?.code === '23505') {
        toast.error(tr('Este mês já foi fechado'));
      } else {
        toast.error(tr('Erro ao fechar o mês'));
      }
    },
  });

  const deleteClosing = useMutation({
    mutationFn: async (closingId: string) => {
      const { error } = await supabase
        .from('commission_closings')
        .delete()
        .eq('id', closingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-closings', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['commission-closing-items', organizationId] });
      toast.success(tr('Fecho eliminado'));
    },
    onError: () => toast.error(tr('Erro ao eliminar fecho')),
  });

  return {
    closings: closings || [],
    closingItems: closingItems || [],
    isLoading,
    getClosingForMonth,
    getItemsForClosing,
    closeMonth,
    deleteClosing,
  };
}
