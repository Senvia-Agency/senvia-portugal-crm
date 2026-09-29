import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamFilter } from '@/hooks/useTeamFilter';
import { toast } from 'sonner';
import { isPerfect2GetherOrg } from '@/lib/perfect2gether';
import type { CrmClient, ClientStatus } from '@/types/clients';

export function useClients() {
  const { organization } = useAuth();
  const { effectiveUserIds } = useTeamFilter();
  const organizationId = organization?.id;

  return useQuery({
    queryKey: ['crm-clients', organizationId, effectiveUserIds],
    queryFn: async () => {
      if (!organizationId) return [];

      let query = supabase
        .from('crm_clients')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      // Filter by user IDs if applicable
      if (effectiveUserIds) {
        query = query.in('assigned_to', effectiveUserIds);
      }

      const { data, error } = await query;
      if (error) {
        console.error('Error fetching clients:', error);
        throw error;
      }

      return data as CrmClient[];
    },
    enabled: !!organizationId,
  });
}

export function useClient(clientId: string | null) {
  const { organization } = useAuth();
  const organizationId = organization?.id;

  return useQuery({
    queryKey: ['crm-client', clientId],
    queryFn: async () => {
      if (!clientId || !organizationId) return null;

      const { data, error } = await supabase
        .from('crm_clients')
        .select('*, lead:leads(*)')
        .eq('id', clientId)
        .single();

      if (error) {
        console.error('Error fetching client:', error);
        throw error;
      }

      return data as CrmClient;
    },
    enabled: !!clientId && !!organizationId,
  });
}

interface CreateClientData {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  nif?: string;
  company_nif?: string;
  company_address_same_as_client?: boolean;
  billing_target?: string;
  company_address_line1?: string;
  company_address_line2?: string;
  company_city?: string;
  company_postal_code?: string;
  company_country?: string;
  status?: ClientStatus;
  source?: string;
  notes?: string;
  lead_id?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  postal_code?: string;
  country?: string;
  assigned_to?: string;
  distrito?: string;
  conselho?: string;
  grupo_economico?: string;
}

export function useCreateClient() {
  const { organization } = useAuth();
  const organizationId = organization?.id;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateClientData) => {
      if (!organizationId) throw new Error('No organization');

      const { data: client, error } = await supabase
        .from('crm_clients')
        .insert({
          ...data,
          organization_id: organizationId,
          status: data.status || 'active',
        })
        .select()
        .single();

      if (error) throw error;
      return client;
    },
    onSuccess: (client) => {
      queryClient.invalidateQueries({ queryKey: ['crm-clients'] });
      toast.success('Cliente criado com sucesso');
      return client;
    },
    onError: (error) => {
      console.error('Error creating client:', error);
      toast.error('Erro ao criar cliente');
    },
  });
}

export function useUpdateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<CrmClient> & { id: string }) => {
      const { data, error } = await supabase
        .from('crm_clients')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['crm-clients'] });
      queryClient.invalidateQueries({ queryKey: ['crm-client', variables.id] });
      toast.success('Cliente atualizado');
    },
    onError: (error) => {
      console.error('Error updating client:', error);
      toast.error('Erro ao atualizar cliente');
    },
  });
}

export function useDeleteClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (clientId: string) => {
      const { error } = await supabase
        .from('crm_clients')
        .delete()
        .eq('id', clientId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-clients'] });
      toast.success('Cliente removido');
    },
    onError: (error) => {
      console.error('Error deleting client:', error);
      toast.error('Erro ao remover cliente');
    },
  });
}

export function useConvertLeadToClient() {
  const { organization } = useAuth();
  const organizationId = organization?.id;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (leadData: {
      lead_id: string;
      name: string;
      email?: string;
      phone?: string;
      company?: string;
      nif?: string;
      company_nif?: string;
      notes?: string;
    }) => {
      if (!organizationId) throw new Error('No organization');

      // First, fetch the lead to get the assigned_to and custom_data values
      const { data: lead } = await supabase
        .from('leads')
        .select('assigned_to, custom_data, company_name, company_nif')
        .eq('id', leadData.lead_id)
        .single();

      const { data, error } = await supabase
        .from('crm_clients')
        .insert({
          organization_id: organizationId,
          lead_id: leadData.lead_id,
          name: leadData.name,
          email: leadData.email,
          phone: leadData.phone,
          company: leadData.company || lead?.company_name || undefined,
          nif: leadData.nif,
          company_nif: leadData.company_nif || lead?.company_nif || undefined,
          notes: leadData.notes,
          source: 'lead',
          status: 'active',
          assigned_to: lead?.assigned_to || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Auto-create CPE for P2G if lead has CPE data
      const customData = lead?.custom_data as Record<string, unknown> | null;
      const cpeValue = customData?.cpe as string | undefined;
      if (cpeValue && isPerfect2GetherOrg(organizationId)) {
        await supabase.from('cpes').insert({
          client_id: data.id,
          organization_id: organizationId,
          equipment_type: 'Energia',
          serial_number: cpeValue,
          comercializador: '',
          status: 'active',
        });
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-clients'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast.success('Lead convertido em cliente');
    },
    onError: (error) => {
      console.error('Error converting lead:', error);
      toast.error('Erro ao converter lead');
    },
  });
}

export function useClientStats() {
  const { data: clients, isLoading } = useClients();

  const stats = {
    total: clients?.length || 0,
    active: clients?.filter(c => c.status === 'active').length || 0,
    vip: clients?.filter(c => c.status === 'vip').length || 0,
    inactive: clients?.filter(c => c.status === 'inactive').length || 0,
    totalValue: clients?.reduce((sum, c) => sum + (c.total_value || 0), 0) || 0,
    totalComissao: clients?.reduce((sum, c) => sum + (c.total_comissao || 0), 0) || 0,
    totalMwh: clients?.reduce((sum, c) => sum + (c.total_mwh || 0), 0) || 0,
    totalKwp: clients?.reduce((sum, c) => sum + (c.total_kwp || 0), 0) || 0,
  };

  return { stats, isLoading };
}
