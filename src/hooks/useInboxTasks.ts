import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Database } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

// Conversation tasks ("prometi e não esqueço"): follow-ups tied to a WhatsApp
// contact, with due-time push reminders (task-reminders edge function + pg_cron).

export interface InboxTask {
  id: string;
  organization_id: string;
  created_by: string | null; // null = sugerida pela IA
  assigned_to: string | null;
  conversation_id: number | null;
  contact_phone: string | null;
  contact_name: string | null;
  lead_id: string | null;
  client_id: string | null;
  title: string;
  description: string | null;
  due_at: string | null;
  done_at: string | null;
  created_at: string;
  // AI suggestion: true until a user accepts it (no reminders/badges meanwhile).
  suggested: boolean;
  source_message: string | null;
}

const tasksTable = () => supabase.from('inbox_tasks');

export function phoneSuffix(phone: string | null | undefined): string {
  return (phone || '').replace(/\D/g, '').slice(-9);
}

export function isTaskOverdue(t: Pick<InboxTask, 'due_at' | 'done_at'>): boolean {
  return !t.done_at && !!t.due_at && new Date(t.due_at).getTime() < Date.now();
}

// All OPEN tasks of the org — feeds the conversation-list badges, the "Minhas
// tarefas" popover and the dashboard widget from a single query.
export function useOpenInboxTasks(enabled = true) {
  const { organization } = useAuth();
  return useQuery({
    queryKey: ['inbox-tasks', organization?.id, 'open'],
    queryFn: async (): Promise<InboxTask[]> => {
      if (!organization?.id) return [];
      const { data, error } = await tasksTable()
        .select('*')
        .eq('organization_id', organization.id)
        .is('done_at', null)
        .eq('suggested', false) // suggestions only count once accepted
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as InboxTask[];
    },
    enabled: enabled && !!organization?.id,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}

// Open + recently-done tasks of ONE conversation/contact (matched by the last 9
// digits of the phone, like the rest of the inbox).
export function useConversationTasks(phone: string | null | undefined, channelId?: string) {
  const { organization } = useAuth();
  const suffix = phoneSuffix(phone);
  return useQuery({
    queryKey: ['inbox-tasks', organization?.id, 'conv', suffix, channelId ?? 'all'],
    queryFn: async (): Promise<InboxTask[]> => {
      if (!organization?.id || suffix.length < 9) return [];
      let query = tasksTable()
        .select('*')
        .eq('organization_id', organization.id)
        .eq('phone_key', suffix); // indexed; replaces unindexed LIKE '%suffix'
      if (channelId) query = query.or(`source_channel_id.is.null,source_channel_id.eq.${channelId}`);
      const { data, error } = await query
        .order('done_at', { ascending: true, nullsFirst: true })
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as InboxTask[];
    },
    enabled: !!organization?.id && suffix.length >= 9,
    staleTime: 15 * 1000,
    retry: false,
    // AI suggestions land seconds after a message — poll lightly so they show
    // up in the open panel without switching conversations.
    refetchInterval: 20 * 1000,
  });
}

export interface NewInboxTask {
  title: string;
  dueAt?: Date | null;
  assignedTo?: string | null;
  conversationId?: number | null;
  sourceChannelId?: string;
  contactPhone?: string | null;
  contactName?: string | null;
  leadId?: string | null;
  clientId?: string | null;
}

export function useCreateInboxTask() {
  const { organization, user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (t: NewInboxTask) => {
      if (!organization?.id || !user?.id) throw new Error('Organização não encontrada');
      const { error } = await tasksTable().insert({
        organization_id: organization.id,
        created_by: user.id,
        assigned_to: t.assignedTo ?? null,
        conversation_id: t.conversationId ?? null,
        source_channel_id: t.sourceChannelId ?? null,
        contact_phone: (t.contactPhone || '').replace(/\D/g, '') || null,
        contact_name: t.contactName ?? null,
        lead_id: t.leadId ?? null,
        client_id: t.clientId ?? null,
        title: t.title.trim(),
        due_at: t.dueAt ? t.dueAt.toISOString() : null,
      });
      if (error) throw error;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox-tasks', organization?.id] });
    },
  });
}

// Toggle done/undone — optimistic on every tasks cache (panel, badges, widget).
export function useToggleInboxTask() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  const key = ['inbox-tasks', organization?.id];
  return useMutation({
    mutationFn: async ({ id, done }: { id: string; done: boolean }) => {
      const { error } = await tasksTable()
        .update({ done_at: done ? new Date().toISOString() : null })
        .eq('id', id);
      if (error) throw error;
    },
    onMutate: async ({ id, done }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const snapshots = queryClient.getQueriesData<InboxTask[]>({ queryKey: key });
      queryClient.setQueriesData<InboxTask[]>({ queryKey: key }, (old) =>
        (old ?? []).map((t) => (t.id === id ? { ...t, done_at: done ? new Date().toISOString() : null } : t)),
      );
      return { snapshots };
    },
    onError: (_e, _v, ctx) => {
      for (const [k, data] of ctx?.snapshots ?? []) queryClient.setQueryData(k, data);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

// Snooze / reschedule / reassign / retitle. Changing due_at re-arms the reminder.
export function useUpdateInboxTask() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dueAt, assignedTo, title, description }: {
      id: string;
      dueAt?: Date | null;
      assignedTo?: string | null;
      title?: string;
      description?: string | null;
    }) => {
      const updates: Database['public']['Tables']['inbox_tasks']['Update'] = {};
      if (dueAt !== undefined) {
        updates.due_at = dueAt ? dueAt.toISOString() : null;
        updates.reminder_sent = false;
      }
      if (assignedTo !== undefined) updates.assigned_to = assignedTo;
      if (title !== undefined) updates.title = title.trim();
      if (description !== undefined) updates.description = description?.trim() || null;
      const { error } = await tasksTable().update(updates).eq('id', id);
      if (error) throw error;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox-tasks', organization?.id] });
    },
  });
}

// Accept an AI suggestion: it becomes a real task assigned to the accepting
// user (reminder arms itself via due_at, which the suggestion already carries).
export function useAcceptSuggestedTask() {
  const { user, organization } = useAuth();
  const queryClient = useQueryClient();
  const key = ['inbox-tasks', organization?.id];
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await tasksTable()
        .update({ suggested: false, assigned_to: user?.id ?? null })
        .eq('id', id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const snapshots = queryClient.getQueriesData<InboxTask[]>({ queryKey: key });
      queryClient.setQueriesData<InboxTask[]>({ queryKey: key }, (old) =>
        (old ?? []).map((t) => (t.id === id ? { ...t, suggested: false, assigned_to: user?.id ?? null } : t)),
      );
      return { snapshots };
    },
    onError: (_e, _v, ctx) => {
      for (const [k, data] of ctx?.snapshots ?? []) queryClient.setQueryData(k, data);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

// ---- Per-org toggle for AI suggestions (messaging_channels.metadata) ----

export function useAiTasksEnabled(channelId?: string) {
  const { organization } = useAuth();
  return useQuery({
    queryKey: ['inbox-ai-tasks-enabled', organization?.id, channelId ?? 'org'],
    queryFn: async (): Promise<boolean> => {
      if (!organization?.id) return false;
      let query = supabase.from('messaging_channels').select('metadata_public')
        .eq('organization_id', organization.id).eq('channel_type', 'whatsapp').is('archived_at', null);
      if (channelId) query = query.eq('id', channelId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).some((channel) => {
        const metadata = channel.metadata_public;
        return !metadata || typeof metadata !== 'object' || Array.isArray(metadata)
          || metadata.ai_tasks_enabled !== false;
      });
    },
    enabled: !!organization?.id,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveAiTasksEnabled(channelId?: string) {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!organization?.id) throw new Error('Organização não encontrada');
      // Atomic JSON merge — won't clobber auto_reply or the channel's own config.
      // The RPC is admin-gated and raises for non-admins.
      const { error } = channelId
        ? await supabase.rpc('merge_messaging_channel_metadata_by_id', {
          p_channel_id: channelId, p_patch: { ai_tasks_enabled: enabled },
        })
        : await supabase.rpc('merge_messaging_channel_metadata', {
          p_org_id: organization.id, p_channel_type: 'whatsapp', p_patch: { ai_tasks_enabled: enabled },
        });
      if (error) throw error;
    },
    // Optimistic: the sparkles flips on click; rolls back if the server refuses.
    onMutate: async (enabled) => {
      const key = ['inbox-ai-tasks-enabled', organization?.id, channelId ?? 'org'];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<boolean>(key);
      queryClient.setQueryData(key, enabled);
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      queryClient.setQueryData(['inbox-ai-tasks-enabled', organization?.id, channelId ?? 'org'], ctx?.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox-ai-tasks-enabled', organization?.id] });
    },
  });
}

export function useDeleteInboxTask() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  const key = ['inbox-tasks', organization?.id];
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await tasksTable().delete().eq('id', id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const snapshots = queryClient.getQueriesData<InboxTask[]>({ queryKey: key });
      queryClient.setQueriesData<InboxTask[]>({ queryKey: key }, (old) =>
        (old ?? []).filter((t) => t.id !== id),
      );
      return { snapshots };
    },
    onError: (_e, _v, ctx) => {
      for (const [k, data] of ctx?.snapshots ?? []) queryClient.setQueryData(k, data);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
