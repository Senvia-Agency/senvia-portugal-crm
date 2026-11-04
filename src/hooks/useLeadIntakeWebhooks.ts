import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { tr } from '@/i18n';

export interface LeadIntakeWebhook {
  id: string;
  organization_id: string;
  name: string;
  token: string;
  is_active: boolean;
  is_system: boolean;
  assigned_user_ids: string[];
  rotate_enabled: boolean;
  round_robin_index: number;
  notify_all_admins: boolean;
  created_at: string;
  updated_at: string;
}

// Generates a random hex token (same scheme as the legacy dedicated webhook)
export function generateWebhookToken(): string {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function useLeadIntakeWebhooks() {
  const { organization } = useAuth();

  return useQuery({
    queryKey: ['lead-intake-webhooks', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];

      const { data, error } = await supabase
        .from('lead_intake_webhooks' as any)
        .select('*')
        .eq('organization_id', organization.id)
        .order('is_system', { ascending: false })
        .order('created_at', { ascending: true });

      if (error) throw error;
      return (data || []) as unknown as LeadIntakeWebhook[];
    },
    enabled: !!organization?.id,
  });
}

export function useCreateLeadIntakeWebhook() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      name,
      assigned_user_ids,
      rotate_enabled,
    }: {
      name: string;
      assigned_user_ids: string[];
      rotate_enabled: boolean;
    }) => {
      if (!organization?.id) throw new Error(tr('Organização não encontrada'));

      const { error } = await supabase.from('lead_intake_webhooks' as any).insert({
        organization_id: organization.id,
        name,
        token: generateWebhookToken(),
        is_active: true,
        is_system: false,
        assigned_user_ids,
        rotate_enabled,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-intake-webhooks'] });
      toast({ title: tr('Webhook criado'), description: tr('O webhook de entrada foi criado com sucesso.') });
    },
    onError: () => {
      toast({ title: tr('Erro'), description: tr('Não foi possível criar o webhook.'), variant: 'destructive' });
    },
  });
}

export function useUpdateLeadIntakeWebhook() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: string;
      name?: string;
      is_active?: boolean;
      assigned_user_ids?: string[];
      rotate_enabled?: boolean;
      notify_all_admins?: boolean;
    }) => {
      const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.is_active !== undefined) payload.is_active = updates.is_active;
      if (updates.assigned_user_ids !== undefined) payload.assigned_user_ids = updates.assigned_user_ids;
      if (updates.rotate_enabled !== undefined) payload.rotate_enabled = updates.rotate_enabled;
      if (updates.notify_all_admins !== undefined) payload.notify_all_admins = updates.notify_all_admins;

      const { error } = await supabase
        .from('lead_intake_webhooks' as any)
        .update(payload)
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-intake-webhooks'] });
    },
    onError: () => {
      toast({ title: tr('Erro'), description: tr('Não foi possível atualizar o webhook.'), variant: 'destructive' });
    },
  });
}

export function useDeleteLeadIntakeWebhook() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('lead_intake_webhooks' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-intake-webhooks'] });
      toast({ title: tr('Webhook eliminado') });
    },
    onError: () => {
      toast({ title: tr('Erro'), description: tr('Não foi possível eliminar o webhook.'), variant: 'destructive' });
    },
  });
}
