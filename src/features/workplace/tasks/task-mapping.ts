import { z } from 'zod';
import { taskSchema, type WorkTask } from './model';
const rowSchema = z.object({
  id: z.string().uuid(), title: z.string(), description: z.string().nullable(), assigned_to: z.string().nullable(),
  participant_ids: z.array(z.string()).default([]),
  due_at: z.string().nullable(), done_at: z.string().nullable(), created_at: z.string().nullable(),
  source_channel_id: z.string().nullable(), contact_phone: z.string().nullable(), contact_name: z.string().nullable(),
  workplace_status: z.enum(['todo', 'doing', 'done']), priority: z.enum(['low', 'normal', 'high']), workplace_version: z.number().int().nonnegative(),
});
export function parseSharedTasks(input: unknown): WorkTask[] {
  return z.array(rowSchema).parse(input).map(row => ({
    id: row.id, title: row.title, description: row.description ?? '', assignedTo: row.assigned_to ?? '',
    dueAt: row.due_at ? new Date(row.due_at).toISOString() : null, status: row.done_at ? 'done' : row.workplace_status,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date(0).toISOString(),
    participantIds: row.participant_ids, priority: row.priority, version: row.workplace_version,
    source: row.source_channel_id || row.contact_phone ? 'inbox' : 'workplace', contactName: row.contact_name, phone: row.contact_phone,
  }));
}
export function taskEditableFields(task: WorkTask) {
  const parsed = taskSchema.parse(task);
  return { title: parsed.title, description: parsed.description || null, assigned_to: parsed.assignedTo || null,
    participant_ids: [...new Set(parsed.participantIds ?? [])], due_at: parsed.dueAt, workplace_status: parsed.status, priority: parsed.priority };
}
