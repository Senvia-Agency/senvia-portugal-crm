import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamFilter } from '@/hooks/useTeamFilter';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import type { Lead, LeadStatus, LeadTemperature, LeadTipologia } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { Json } from '@/integrations/supabase/types';
import { tr } from '@/i18n';

export function useLeads() {
  const { organization } = useAuth();
  const { effectiveUserIds, isFilteringAll } = useTeamFilter();
  
  return useQuery({
    queryKey: ['leads', organization?.id, effectiveUserIds],
    queryFn: async () => {
      if (!organization?.id) return [];
      
      let baseQuery = supabase
        .from('leads')
        .select('*')
        .eq('organization_id', organization.id)
        .is('archived_at', null)
        .order('created_at', { ascending: false });

      if (effectiveUserIds) {
        // Leads sem responsável só são visíveis para admins que veem tudo (sem filtro de membro)
        const filters = effectiveUserIds.map(id => `assigned_to.eq.${id}`);
        if (isFilteringAll) filters.push('assigned_to.is.null');
        baseQuery = baseQuery.or(filters.join(','));
      }

      // Fetch in chunks of 1000 to bypass PostgREST default row limit
      const chunkSize = 1000;
      let allData: Lead[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await baseQuery.range(from, from + chunkSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allData = allData.concat(data as Lead[]);
        if (data.length < chunkSize) break;
        from += chunkSize;
      }
      return allData;
    },
    enabled: !!organization?.id,
  });
}

export function useLeadById(leadId: string | null) {
  const { organization } = useAuth();
  return useQuery({
    queryKey: ['lead', leadId],
    queryFn: async () => {
      if (!organization?.id || !leadId) return null;
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('id', leadId)
        .eq('organization_id', organization.id)
        .single();
      if (error) throw error;
      return data as Lead;
    },
    enabled: !!organization?.id && !!leadId,
  });
}

export function useUpdateLeadStatus() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async ({ leadId, status }: { leadId: string; status: string }) => {
      const { data, error } = await supabase
        .from('leads')
        .update({ status })
        .eq('id', leadId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (error) => {
      toast({
        title: tr('Erro'),
        description: tr('Não foi possível atualizar o estado do lead.'),
        variant: 'destructive',
      });
      console.error('Error updating lead status:', error);
    },
  });
}

export function useUpdateLead() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async ({ leadId, updates }: { leadId: string; updates: Partial<Omit<Lead, 'custom_data'>> & { custom_data?: Json } }) => {
      const { data, error } = await supabase
        .from('leads')
        .update(updates)
        .eq('id', leadId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast({
        title: tr('Sucesso'),
        description: tr('Lead atualizado com sucesso.'),
      });
    },
    onError: (error) => {
      toast({
        title: tr('Erro'),
        description: tr('Não foi possível atualizar o lead.'),
        variant: 'destructive',
      });
      console.error('Error updating lead:', error);
    },
  });
}

export function useDeleteLead() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (leadId: string) => {
      const { error } = await supabase
        .from('leads')
        .delete()
        .eq('id', leadId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast({
        title: tr('Lead eliminado'),
        description: tr('O lead foi eliminado permanentemente (RGPD).'),
      });
    },
    onError: (error) => {
      toast({
        title: tr('Erro'),
        description: tr('Não foi possível eliminar o lead.'),
        variant: 'destructive',
      });
      console.error('Error deleting lead:', error);
    },
  });
}

export function useCreateLead() {
  const queryClient = useQueryClient();
  const { organization, user } = useAuth();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (leadData: {
      name: string;
      email: string;
      phone: string;
      source?: string;
      temperature?: LeadTemperature;
      value?: number;
      notes?: string;
      gdpr_consent: boolean;
      automation_enabled?: boolean;
      assigned_to?: string;
      tipologia?: LeadTipologia;
      consumo_anual?: number;
      company_nif?: string;
      company_name?: string;
      custom_data?: Record<string, unknown>;
    }) => {
      if (!organization?.id) throw new Error('Sem organização');

      let assignedTo = leadData.assigned_to || null;

      // Round-robin auto-assign if no assigned_to provided
      if (!assignedTo) {
        const { data: org } = await supabase
          .from('organizations')
          .select('sales_settings')
          .eq('id', organization.id)
          .single();

        const salesSettings = (org?.sales_settings as any) || {};
        if (salesSettings.auto_assign_leads) {
          const nowIso = new Date().toISOString();
          let membersQuery = supabase
            .from('organization_members')
            .select('user_id')
            .eq('organization_id', organization.id)
            .eq('is_active', true)
            .or(`paused_until.is.null,paused_until.lt.${nowIso}`);
          if (salesSettings.exclude_admins_from_assignment) {
            membersQuery = membersQuery.neq('role', 'admin');
          }
          const { data: members } = await membersQuery.order('joined_at', { ascending: true });

          if (members && members.length > 0) {
            const currentIndex = salesSettings.round_robin_index || 0;
            const safeIndex = currentIndex % members.length;
            assignedTo = members[safeIndex].user_id;
            const nextIndex = (safeIndex + 1) % members.length;

            await supabase
              .from('organizations')
              .update({
                sales_settings: { ...salesSettings, round_robin_index: nextIndex },
              })
              .eq('id', organization.id);
          }
        }
      }

      // Se ainda sem responsável, atribuir ao utilizador que está a criar
      if (!assignedTo && user?.id) {
        assignedTo = user.id;
      }

      const { custom_data, ...rest } = leadData;
      const { data, error } = await supabase
        .from('leads')
        .insert({
          ...rest,
          custom_data: custom_data as Json | undefined,
          assigned_to: assignedTo,
          organization_id: organization.id,
          status: 'new',
        })
        .select()
        .maybeSingle();

      if (error) throw error;
      if (data) return data;

      // The de-duplication trigger updated an existing lead with the same
      // email instead of inserting a new one — return that lead.
      const dupEmail = (rest.email ?? '').trim();
      if (dupEmail) {
        const { data: existing } = await supabase
          .from('leads')
          .select()
          .eq('organization_id', organization.id)
          .ilike('email', dupEmail)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existing) return existing;
      }
      throw new Error('Não foi possível criar o lead.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast({
        title: tr('Lead criado'),
        description: tr('O lead foi adicionado com sucesso.'),
      });
    },
    onError: (error: any) => {
      const msg = error?.message || error?.details || JSON.stringify(error);
      toast({
        title: tr('Erro ao criar lead'),
        description: msg?.includes('row-level security')
          ? tr('Erro de permissão. Tente sair e entrar novamente.')
          : tr('Não foi possível criar o lead.'),
        variant: 'destructive',
      });
      console.error('Error creating lead:', { message: msg, code: error?.code, details: error?.details, hint: error?.hint });
    },
  });
}

export function useLeadStats() {
  const { data: leads } = useLeads();
  const { data: stages } = usePipelineStages();
  
  if (!leads) {
    return {
      total: 0,
      new: 0,
      conversionRate: 0,
      pipelineValue: 0,
    };
  }

  // Get dynamic final stage keys
  const wonKey = stages?.find(s => s.is_final_positive)?.key || 'won';
  const lostKey = stages?.find(s => s.is_final_negative)?.key || 'lost';
  const firstStageKey = stages?.[0]?.key || 'new';
  
  const total = leads.length;
  const newLeads = leads.filter(l => l.status === firstStageKey).length;
  const won = leads.filter(l => l.status === wonKey).length;
  const conversionRate = total > 0 ? Math.round((won / total) * 100) : 0;
  const pipelineValue = leads
    .filter(l => ![wonKey, lostKey].includes(l.status || ''))
    .reduce((sum, l) => sum + (l.value || 0), 0);
  
  return {
    total,
    new: newLeads,
    conversionRate,
    pipelineValue,
  };
}

// --- Arquivamento de leads --------------------------------------------------

// Leads arquivadas (vista "Ver arquivadas"). Só é buscada quando `enabled`.
export function useArchivedLeads(enabled: boolean) {
  const { organization } = useAuth();
  const { effectiveUserIds, isFilteringAll } = useTeamFilter();

  return useQuery({
    queryKey: ['leads-archived', organization?.id, effectiveUserIds],
    queryFn: async () => {
      if (!organization?.id) return [];

      let baseQuery = supabase
        .from('leads')
        .select('*')
        .eq('organization_id', organization.id)
        .not('archived_at', 'is', null)
        .order('archived_at', { ascending: false });

      if (effectiveUserIds) {
        const filters = effectiveUserIds.map(id => `assigned_to.eq.${id}`);
        if (isFilteringAll) filters.push('assigned_to.is.null');
        baseQuery = baseQuery.or(filters.join(','));
      }

      const chunkSize = 1000;
      let allData: Lead[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await baseQuery.range(from, from + chunkSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allData = allData.concat(data as Lead[]);
        if (data.length < chunkSize) break;
        from += chunkSize;
      }
      return allData;
    },
    enabled: enabled && !!organization?.id,
  });
}

function useInvalidateLeads() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['leads'] });
    queryClient.invalidateQueries({ queryKey: ['leads-archived'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
  };
}

export function useArchiveLeads() {
  const invalidate = useInvalidateLeads();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('leads')
        .update({ archived_at: new Date().toISOString() } as never)
        .in('id', ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (n) => {
      invalidate();
      toast({ title: tr('Leads arquivadas'), description: tr('{{n}} lead(s) arquivada(s). Podes restaurá-las em "Ver leads arquivadas".', { n }) });
    },
    onError: (error) => {
      toast({ title: tr('Erro'), description: tr('Não foi possível arquivar os leads.'), variant: 'destructive' });
      console.error('Error archiving leads:', error);
    },
  });
}

export function useUnarchiveLeads() {
  const invalidate = useInvalidateLeads();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('leads')
        .update({ archived_at: null } as never)
        .in('id', ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (n) => {
      invalidate();
      toast({ title: tr('Leads restauradas'), description: tr('{{n}} lead(s) restaurada(s).', { n }) });
    },
    onError: (error) => {
      toast({ title: tr('Erro'), description: tr('Não foi possível restaurar os leads.'), variant: 'destructive' });
      console.error('Error unarchiving leads:', error);
    },
  });
}

export function useArchiveLeadsByStage() {
  const invalidate = useInvalidateLeads();
  const { organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (stageKey: string) => {
      if (!organization?.id) throw new Error('Sem organização');
      const { data, error } = await supabase
        .from('leads')
        .update({ archived_at: new Date().toISOString() } as never)
        .eq('organization_id', organization.id)
        .eq('status', stageKey)
        .is('archived_at', null)
        .select('id');
      if (error) throw error;
      return data?.length ?? 0;
    },
    onSuccess: (n) => {
      invalidate();
      toast({ title: tr('Leads arquivadas'), description: tr('{{n}} lead(s) da etapa arquivada(s).', { n }) });
    },
    onError: (error) => {
      toast({ title: tr('Erro'), description: tr('Não foi possível arquivar a etapa.'), variant: 'destructive' });
      console.error('Error archiving by stage:', error);
    },
  });
}
