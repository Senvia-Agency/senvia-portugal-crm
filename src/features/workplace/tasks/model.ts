import { z } from 'zod';
import type { InboxTask } from '@/hooks/useInboxTasks';

export const statuses = ['todo', 'doing', 'done'] as const;
export const priorities = ['low', 'normal', 'high'] as const;
export const statusLabels = { todo: 'Por fazer', doing: 'Em curso', done: 'Concluídas' } as const;
export const priorityLabels = { low: 'Baixa', normal: 'Normal', high: 'Alta' } as const;
export const taskSchema = z.object({
  id: z.string(), title: z.string().trim().min(1).max(200), description: z.string().max(10000),
  status: z.enum(statuses), priority: z.enum(priorities), assignedTo: z.string(),
  participantIds: z.array(z.string()).optional(),
  dueAt: z.string().datetime().nullable(), createdAt: z.string().datetime(), source: z.enum(['local', 'inbox', 'workplace']), version: z.number().int().nonnegative().optional(),
  contactName: z.string().nullable(), phone: z.string().nullable(),
});
export type WorkTask = z.infer<typeof taskSchema>;
export type TaskStatus = WorkTask['status'];
export type TaskScope = 'mine' | 'team' | 'overdue' | 'done';
export const taskListSchema = z.array(taskSchema);

export function mergeTasks(inbox: readonly InboxTask[], local: readonly WorkTask[]): WorkTask[] {
  const byId = new Map<string, WorkTask>();
  for (const t of inbox) byId.set(t.id, {
    id: t.id, title: t.title, description: t.description ?? '', status: t.done_at ? 'done' : 'todo',
    priority: 'normal', assignedTo: t.assigned_to ?? t.created_by ?? '', dueAt: t.due_at,
    createdAt: t.created_at, source: 'inbox', contactName: t.contact_name, phone: t.contact_phone,
  });
  for (const t of local) byId.set(t.id, t);
  return [...byId.values()].sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'));
}
export function filterTasks(tasks: readonly WorkTask[], filter: { scope: TaskScope; userId: string; query: string; now: number }): WorkTask[] {
  return tasks.filter(t => {
    const matches = `${t.title} ${t.description} ${t.contactName ?? ''}`.toLocaleLowerCase('pt').includes(filter.query.toLocaleLowerCase('pt'));
    if (!matches) return false;
    if (filter.scope === 'done') return t.status === 'done';
    if (filter.scope === 'overdue') return t.status !== 'done' && !!t.dueAt && Date.parse(t.dueAt) < filter.now;
    if (filter.scope === 'mine') return (t.assignedTo === filter.userId || t.participantIds?.includes(filter.userId)) && t.status !== 'done';
    return true;
  });
}
export function emptyTask(userId: string): WorkTask {
  return { id: crypto.randomUUID(), title: '', description: '', status: 'todo', priority: 'normal', assignedTo: userId,
    dueAt: null, createdAt: new Date().toISOString(), source: 'workplace', version: 0, contactName: null, phone: null };
}

export function taskStorageKey(orgId: string, userId: string) { return `senvia-workplace-tasks-v1:${orgId}:${userId}`; }
