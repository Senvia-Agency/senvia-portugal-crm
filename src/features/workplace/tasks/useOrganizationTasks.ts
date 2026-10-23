import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { parseSharedTasks, taskEditableFields } from './task-mapping';
import type { WorkTask, TaskStatus } from './model';

const columns = 'id,title,description,assigned_to,participant_ids,due_at,done_at,created_at,source_channel_id,contact_phone,contact_name,workplace_status,priority,workplace_version';
export function useOrganizationTasks() {
  const { user, organization } = useAuth();
  const client = useQueryClient();
  const orgId = organization?.id;
  const userId = user?.id;
  const key = ['workplace-tasks', orgId, userId];
  const query = useQuery({
    queryKey: key, enabled: !!orgId && !!userId, staleTime: 15000, refetchInterval: 30000,
    queryFn: async () => {
      if (!orgId) return [];
      const tasks: WorkTask[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('inbox_tasks').select(columns).eq('organization_id', orgId)
          .eq('suggested', false).order('created_at', { ascending: false }).order('id').range(from, from + 999);
        if (error) throw error;
        tasks.push(...parseSharedTasks(data));
        if (data.length < 1000) return tasks;
      }
    },
  });
  useEffect(() => {
    if (!orgId || !userId) return;
    const channel = supabase.channel(`workplace-tasks:${orgId}:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inbox_tasks', filter: `organization_id=eq.${orgId}` }, () => {
        void client.invalidateQueries({ queryKey: ['workplace-tasks', orgId, userId] });
        void client.invalidateQueries({ queryKey: ['inbox-tasks', orgId] });
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [orgId, userId, client]);
  const mutation = useMutation({
    mutationFn: async (change: { task: WorkTask; statusOnly?: TaskStatus }) => {
      if (!orgId || !userId) throw new Error('Seleciona uma organização para guardar a tarefa.');
      const task = change.task;
      const { data: existing, error: readError } = await supabase.from('inbox_tasks').select('id,workplace_version,due_at,assigned_to,done_at')
        .eq('organization_id', orgId).eq('id', task.id).maybeSingle();
      if (readError) throw readError;
      if (existing) {
        const status = change.statusOnly ?? task.status;
        const patch = { ...(change.statusOnly ? { workplace_status: status } : taskEditableFields(task)),
          done_at: status === 'done' ? existing.done_at ?? new Date().toISOString() : null };
        const rearm = !change.statusOnly && (task.dueAt !== (existing.due_at ? new Date(existing.due_at).toISOString() : null) || (task.assignedTo || null) !== existing.assigned_to);
        const { data, error } = await supabase.from('inbox_tasks').update({ ...patch, ...(rearm ? { reminder_sent: false } : {}) })
          .eq('organization_id', orgId).eq('id', task.id).eq('workplace_version', task.version ?? 0).select(columns).maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('Esta tarefa mudou na equipa. O teu rascunho foi mantido; revê a versão atual antes de guardar.');
        return parseSharedTasks([data])[0];
      }
      if (task.source === 'inbox' || change.statusOnly) throw new Error('A tarefa já não está disponível ou não tens acesso.');
      const { data, error } = await supabase.from('inbox_tasks').insert({ ...taskEditableFields(task), id: task.id,
        organization_id: orgId, created_by: userId, suggested: false }).select(columns).single();
      if (error) throw error;
      return parseSharedTasks([data])[0];
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['workplace-tasks', orgId, userId] });
      void client.invalidateQueries({ queryKey: ['inbox-tasks', orgId] });
    },
  });
  const save = async (task: WorkTask) => {
    try { await mutation.mutateAsync({ task }); return true; }
    catch (error) { if (error instanceof Error || (typeof error === 'object' && error !== null && 'message' in error)) return false; throw error; }
  };
  const setStatus = (task: WorkTask, status: TaskStatus) => mutation.mutate({ task, statusOnly: status });
  const error = mutation.error;
  return { ...query, save, setStatus, saving: mutation.isPending,
    saveError: error && typeof error === 'object' && 'message' in error ? String(error.message) : null,
    scopeKey: orgId && userId ? `senvia-workplace-tasks-v1:${orgId}:${userId}` : null };
}
