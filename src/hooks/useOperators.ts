import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export type OperatorKind = 'telecom' | 'energia';
export type CommissionBasis = 'per_sale' | 'monthly_volume';
export type VolumeScope = 'per_seller' | 'org_total';

export interface Operator {
  id: string;
  organization_id: string;
  name: string;
  kind: OperatorKind;
  commission_basis: CommissionBasis | null;
  volume_scope: VolumeScope | null;
  commission_payment_month_offset: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OperatorInput {
  name: string;
  kind: OperatorKind;
  commission_basis?: CommissionBasis | null;
  volume_scope?: VolumeScope | null;
}

export function useOperators() {
  const { organization } = useAuth();
  const organizationId = organization?.id;

  return useQuery({
    queryKey: ['operators', organizationId],
    queryFn: async (): Promise<Operator[]> => {
      if (!organizationId) return [];
      const { data, error } = await (supabase as any)
        .from('operators')
        .select('*')
        .eq('organization_id', organizationId)
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Operator[];
    },
    enabled: !!organizationId,
  });
}

export function useCreateOperator() {
  const { organization } = useAuth();
  const organizationId = organization?.id;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: OperatorInput) => {
      if (!organizationId) throw new Error('Sem organização');
      const { error } = await (supabase as any)
        .from('operators')
        .insert([{
          organization_id: organizationId,
          name: input.name.trim(),
          kind: input.kind,
          // Both kinds can use a fixed commission basis now — an energia
          // operator with commission_basis null means "use Matriz de
          // Comissões instead" (see ProductCommissionFields).
          commission_basis: input.commission_basis ?? null,
          volume_scope: input.commission_basis === 'monthly_volume' ? input.volume_scope ?? null : null,
        }]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operators', organizationId] });
      toast.success('Operadora criada');
    },
    onError: (error: any) => {
      toast.error(error?.code === '23505' ? 'Já existe uma operadora com este nome' : 'Erro ao criar operadora');
    },
  });
}

export function useUpdateOperator() {
  const { organization } = useAuth();
  const organizationId = organization?.id;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...input }: OperatorInput & { id: string }) => {
      const { error } = await (supabase as any)
        .from('operators')
        .update({
          name: input.name.trim(),
          kind: input.kind,
          commission_basis: input.commission_basis ?? null,
          volume_scope: input.commission_basis === 'monthly_volume' ? input.volume_scope ?? null : null,
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operators', organizationId] });
      toast.success('Operadora atualizada');
    },
    onError: () => toast.error('Erro ao atualizar operadora'),
  });
}

export function useDeleteOperator() {
  const { organization } = useAuth();
  const organizationId = organization?.id;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('operators').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operators', organizationId] });
      toast.success('Operadora eliminada');
    },
    onError: () => toast.error('Erro ao eliminar operadora'),
  });
}
