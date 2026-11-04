import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { tr } from '@/i18n';

interface CreateTeamMemberParams {
  email: string;
  password: string;
  fullName: string;
  role: 'admin' | 'viewer' | 'salesperson';
  profileId?: string;
}

export interface TeamMember {
  id: string;
  full_name: string;
  avatar_url: string | null;
  email: string | null;
  phone: string | null;
  organization_id: string | null;
  role: 'admin' | 'viewer' | 'salesperson' | 'super_admin';
  user_id: string;
  is_banned: boolean;
  paused_until?: string | null;
  is_paused?: boolean;
  profile_id?: string | null;
  profile_name?: string | null;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: 'admin' | 'viewer' | 'salesperson';
  token: string;
  created_at: string;
  expires_at: string;
  status: string;
}

/**
 * Names by profile id, for attributing something (a sale, a commission) to
 * whoever it belongs to. useTeamMembers only lists currently ACTIVE members —
 * a sale made by someone since deactivated or banned would show "Desconhecido"
 * forever, which reads as data loss on an old record that is still correct.
 */
export function useProfileNames(ids: (string | null | undefined)[]) {
  const { organization } = useAuth();
  const uniqueIds = [...new Set(ids.filter((id): id is string => !!id))].sort();

  return useQuery({
    queryKey: ['profile-names', organization?.id, uniqueIds],
    queryFn: async (): Promise<Record<string, string>> => {
      if (uniqueIds.length === 0) return {};
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', uniqueIds);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((p) => [p.id, p.full_name || 'Desconhecido']));
    },
    enabled: !!organization?.id && uniqueIds.length > 0,
  });
}

export function useTeamMembers(includeInactive = false) {
  const { organization } = useAuth();

  return useQuery({
    queryKey: ['team-members', organization?.id, includeInactive],
    queryFn: async (): Promise<TeamMember[]> => {
      if (!organization?.id) return [];

      const { data, error } = await supabase.functions.invoke('get-team-members', {
        body: { organization_id: organization.id }
      });

      if (error) throw error;
      const members: TeamMember[] = data || [];
      return includeInactive ? members : members.filter(member => !member.is_banned);
    },
    enabled: !!organization?.id,
  });
}

export function usePendingInvites() {
  const { organization } = useAuth();

  return useQuery({
    queryKey: ['pending-invites', organization?.id],
    queryFn: async (): Promise<PendingInvite[]> => {
      if (!organization?.id) return [];

      const { data, error } = await supabase
        .from('organization_invites')
        .select('*')
        .eq('organization_id', organization.id)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as PendingInvite[];
    },
    enabled: !!organization?.id,
  });
}

export function useCreateInvite() {
  const { organization, user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ email, role }: { email: string; role: 'admin' | 'viewer' | 'salesperson' }) => {
      if (!organization?.id || !user?.id) {
        throw new Error(tr('Organização não encontrada'));
      }

      const { data, error } = await supabase
        .from('organization_invites')
        .insert({
          organization_id: organization.id,
          email: email.toLowerCase().trim(),
          role,
          invited_by: user.id,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          throw new Error(tr('Já existe um convite pendente para este email.'));
        }
        throw error;
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-invites'] });
      toast({
        title: tr('Convite criado'),
        description: tr('O link de convite foi gerado com sucesso.'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: tr('Erro ao criar convite'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

export function useCancelInvite() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase
        .from('organization_invites')
        .delete()
        .eq('id', inviteId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-invites'] });
      toast({
        title: tr('Convite cancelado'),
        description: tr('O convite foi removido com sucesso.'),
      });
    },
    onError: () => {
      toast({
        title: tr('Erro'),
        description: tr('Não foi possível cancelar o convite.'),
        variant: 'destructive',
      });
    },
  });
}

export function useResendInvite() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (inviteId: string) => {
      // Renovar data de expiração para +7 dias
      const newExpiry = new Date();
      newExpiry.setDate(newExpiry.getDate() + 7);
      
      const { data, error } = await supabase
        .from('organization_invites')
        .update({ expires_at: newExpiry.toISOString() })
        .eq('id', inviteId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['pending-invites'] });
      toast({
        title: tr('Convite renovado'),
        description: tr('O convite para {{email}} foi renovado por mais 7 dias.', { email: data.email }),
      });
    },
    onError: () => {
      toast({
        title: tr('Erro'),
        description: tr('Não foi possível renovar o convite.'),
        variant: 'destructive',
      });
    },
  });
}

export function useCreateTeamMember() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ email, password, fullName, role, profileId }: CreateTeamMemberParams) => {
      if (!organization?.id) throw new Error(tr('Organização não encontrada'));
      const { data, error } = await supabase.functions.invoke('create-team-member', {
        body: { 
          organization_id: organization.id,
          email: email.toLowerCase().trim(), 
          password, 
          full_name: fullName.trim(), 
          role,
          profile_id: profileId || null,
        }
      });

      if (error) {
        throw new Error(error.message || tr('Erro ao criar colaborador'));
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-members'] });
      toast({
        title: tr('Acesso criado'),
        description: tr('O novo colaborador foi adicionado com sucesso.'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: tr('Erro ao criar acesso'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
