import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { tr } from '@/i18n';
import type { InternalRequest, RequestType, RequestStatus } from '@/types/internal-requests';

interface Filters {
  type?: RequestType;
  status?: RequestStatus;
}

export function useInternalRequests(filters?: Filters) {
  const { session, organization } = useAuth();
  const organizationId = organization?.id;
  const queryClient = useQueryClient();

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['internal-requests', organizationId, filters],
    queryFn: async () => {
      if (!organizationId) return [];
      let query = supabase
        .from('internal_requests')
        .select('*')
        .eq('organization_id', organizationId)
        .order('submitted_at', { ascending: false });

      if (filters?.type) query = query.eq('request_type', filters.type);
      if (filters?.status) query = query.eq('status', filters.status);

      const { data, error } = await query;
      if (error) throw error;

      // Fetch submitter names
      const userIds = [...new Set((data || []).map(r => r.submitted_by))];
      let profilesMap: Record<string, { full_name: string; avatar_url: string | null }> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url')
          .in('id', userIds);
        if (profiles) {
          profilesMap = Object.fromEntries(profiles.map(p => [p.id, { full_name: p.full_name, avatar_url: p.avatar_url }]));
        }
      }

      return (data || []).map(r => ({
        ...r,
        submitter: profilesMap[r.submitted_by] || undefined,
      })) as InternalRequest[];
    },
    enabled: !!organizationId && !!session,
  });

  // Pending count for the whole organization, independent of the active status filter.
  const { data: pendingCount = 0 } = useQuery({
    queryKey: ['internal-requests-pending-count', organizationId],
    queryFn: async () => {
      if (!organizationId) return 0;
      const { count, error } = await supabase
        .from('internal_requests')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('status', 'pending');
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!organizationId && !!session,
  });

  const submitRequest = useMutation({
    mutationFn: async (input: {
      request_type: RequestType;
      title: string;
      description?: string;
      amount?: number;
      expense_date?: string;
      period_start?: string;
      period_end?: string;
      file_url?: string;
    }) => {
      if (!organizationId || !session?.user.id) throw new Error('Sem sessão');
      const { error } = await supabase.from('internal_requests').insert({
        organization_id: organizationId,
        submitted_by: session.user.id,
        ...input,
      });
      if (error) throw error;
      return input;
    },
    onSuccess: (_, input) => {
      toast.success(tr('Pedido submetido com sucesso'));
      queryClient.invalidateQueries({ queryKey: ['internal-requests'] });
      queryClient.invalidateQueries({ queryKey: ['internal-requests-pending-count'] });
      // Notify finance email silently
      supabase.functions.invoke('notify-finance-request', {
        body: {
          organization_id: organizationId,
          title: input.title,
          request_type: input.request_type,
        },
      }).catch(() => {});
    },
    onError: () => toast.error(tr('Erro ao submeter pedido')),
  });

  const reviewRequest = useMutation({
    mutationFn: async (input: {
      id: string;
      status: 'approved' | 'rejected' | 'paid';
      review_notes?: string;
      payment_reference?: string;
    }) => {
      if (!session?.user.id) throw new Error('Sem sessão');
      const updateData: Record<string, unknown> = {
        status: input.status,
        reviewed_by: session.user.id,
        reviewed_at: new Date().toISOString(),
        review_notes: input.review_notes || null,
      };
      if (input.status === 'paid') {
        updateData.paid_at = new Date().toISOString();
        updateData.payment_reference = input.payment_reference || null;
      }
      const { error } = await supabase
        .from('internal_requests')
        .update(updateData)
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      const labels = { approved: 'Pedido aprovado', rejected: 'Pedido rejeitado', paid: 'Pedido marcado como pago' };
      toast.success(tr(labels[vars.status]));
      queryClient.invalidateQueries({ queryKey: ['internal-requests'] });
      queryClient.invalidateQueries({ queryKey: ['internal-requests-pending-count'] });
      // Notify submitter via email
      if (['approved', 'rejected', 'paid'].includes(vars.status)) {
        supabase.functions.invoke('notify-request-status', {
          body: {
            request_id: vars.id,
            organization_id: organizationId,
            new_status: vars.status,
            review_notes: vars.review_notes,
          },
        }).catch(() => {});
      }
    },
    onError: () => toast.error(tr('Erro ao processar pedido')),
  });

  const deleteRequest = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('internal_requests').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(tr('Pedido eliminado'));
      queryClient.invalidateQueries({ queryKey: ['internal-requests'] });
      queryClient.invalidateQueries({ queryKey: ['internal-requests-pending-count'] });
    },
    onError: () => toast.error(tr('Erro ao eliminar pedido')),
  });

  const uploadFile = async (file: File): Promise<string> => {
    if (!session?.user.id) throw new Error('Sem sessão');
    const ext = file.name.split('.').pop();
    const path = `${session.user.id}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('internal-requests').upload(path, file);
    if (error) throw error;
    const { data } = supabase.storage.from('internal-requests').getPublicUrl(path);
    return data.publicUrl;
  };

  return {
    requests,
    isLoading,
    submitRequest,
    reviewRequest,
    deleteRequest,
    uploadFile,
    pendingCount,
  };
}
