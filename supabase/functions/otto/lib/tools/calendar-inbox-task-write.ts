import type { Tool } from "../types.ts";
import { calendarInboxCanAssignUser } from "./calendar-inbox-event-helpers.ts";
import {
  INBOX_TASK_COLUMNS,
  calendarInboxLoadConversation,
  calendarInboxLoadTask,
  calendarInboxTaskRow,
} from "./calendar-inbox-task-helpers.ts";
import {
  CALENDAR_INBOX_DATABASE_ERROR,
  calendarInboxHasOwn,
  calendarInboxIsoInstant,
  calendarInboxResource,
  calendarInboxText,
  calendarInboxUuid,
} from "./calendar-inbox-shared.ts";

const INVALID_TASK = {
  error: "Tarefa de Inbox inválida",
  reason_code: "invalid_inbox_task",
  _instruction: "Confirma a conversa, o título e qualquer data com timezone explícito.",
} as const;

function taskText(value: unknown, maximumLength: number): string | null | undefined {
  if (value === null || value === "") return null;
  return calendarInboxText(value, maximumLength) ?? undefined;
}

export const calendarInboxTaskWriteTools: Tool[] = [
  {
    name: "create_inbox_task",
    module: "inbox",
    description: "Criar uma tarefa nativa ligada a uma conversa WhatsApp acessível. A tarefa fica editável na Inbox.",
    parameters: {
      type: "object",
      properties: {
        conversation_id: { type: "string" },
        title: { type: "string", maxLength: 160 },
        description: { type: ["string", "null"], maxLength: 5000 },
        due_at: { type: ["string", "null"], description: "ISO 8601 com timezone" },
        assigned_to: { type: ["string", "null"] },
      },
      required: ["conversation_id", "title"],
      additionalProperties: false,
    },
    permission: { module: "inbox", subarea: "tasks", action: "create" },
    isWrite: true,
    confirmation: { kind: "immediate" },
    execute: async (args, ctx) => {
      const conversationId = calendarInboxUuid(args.conversation_id);
      const title = calendarInboxText(args.title, 160);
      const description = args.description === undefined ? null : taskText(args.description, 5000);
      const dueAt = args.due_at === undefined || args.due_at === null
        ? null
        : calendarInboxIsoInstant(args.due_at);
      const assignedTo = args.assigned_to === undefined
        ? ctx.userId
        : args.assigned_to === null ? null : calendarInboxUuid(args.assigned_to);
      const invalidDueAt = args.due_at !== undefined && args.due_at !== null && dueAt === null;
      if (!conversationId || !title || description === undefined || invalidDueAt
        || assignedTo === null && args.assigned_to !== null) return INVALID_TASK;
      const binding = await calendarInboxLoadConversation(ctx, conversationId);
      if (!binding) return { error: "Conversa indisponível", reason_code: "conversation_scope_denied" };
      if (assignedTo && !await calendarInboxCanAssignUser(ctx, assignedTo)) {
        return { error: "Responsável fora do âmbito", reason_code: "user_scope_denied" };
      }
      const { data, error } = await ctx.supabaseUser.from("inbox_tasks").insert({
        organization_id: ctx.orgId,
        created_by: ctx.userId,
        assigned_to: assignedTo,
        conversation_id: null,
        source_channel_id: binding.channelId,
        contact_phone: binding.contactPhone,
        contact_name: binding.contactName,
        lead_id: binding.leadId,
        client_id: binding.clientId,
        title,
        description,
        due_at: dueAt,
        suggested: false,
      }).select(INBOX_TASK_COLUMNS).single();
      if (error) return CALENDAR_INBOX_DATABASE_ERROR;
      const task = calendarInboxTaskRow(data);
      if (!task || task.organization_id !== ctx.orgId) return CALENDAR_INBOX_DATABASE_ERROR;
      return {
        success: true,
        operation: "created",
        ...calendarInboxResource("inbox_task", task.id, "/inbox"),
        task,
      };
    },
  },
  {
    name: "update_inbox_task",
    module: "inbox",
    description: "Editar título, descrição, prazo ou responsável de uma tarefa real da Inbox.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        title: { type: "string", maxLength: 160 },
        description: { type: ["string", "null"], maxLength: 5000 },
        due_at: { type: ["string", "null"] },
        assigned_to: { type: ["string", "null"] },
      },
      required: ["task_id"],
      additionalProperties: false,
    },
    permission: { module: "inbox", subarea: "tasks", action: "edit" },
    isWrite: true,
    confirmation: { kind: "immediate" },
    execute: async (args, ctx) => {
      const taskId = calendarInboxUuid(args.task_id);
      const current = taskId ? await calendarInboxLoadTask(ctx, taskId) : null;
      if (!current) {
        return { error: "Tarefa não encontrada", reason_code: "task_not_found" };
      }
      const values: Readonly<Record<string, unknown>> = args;
      const updates: Record<string, unknown> = {};
      if (calendarInboxHasOwn(values, "title")) {
        const title = calendarInboxText(args.title, 160);
        if (!title) return INVALID_TASK;
        updates.title = title;
      }
      if (calendarInboxHasOwn(values, "description")) {
        const description = taskText(args.description, 5000);
        if (description === undefined) return INVALID_TASK;
        updates.description = description;
      }
      if (calendarInboxHasOwn(values, "due_at")) {
        const dueAt = args.due_at === null ? null : calendarInboxIsoInstant(args.due_at);
        if (dueAt === undefined || dueAt === null && args.due_at !== null) return INVALID_TASK;
        updates.due_at = dueAt;
        updates.reminder_sent = false;
      }
      if (calendarInboxHasOwn(values, "assigned_to")) {
        const assignedTo = args.assigned_to === null ? null : calendarInboxUuid(args.assigned_to);
        if (assignedTo === null && args.assigned_to !== null) return INVALID_TASK;
        if (assignedTo && !await calendarInboxCanAssignUser(ctx, assignedTo)) {
          return { error: "Responsável fora do âmbito", reason_code: "user_scope_denied" };
        }
        updates.assigned_to = assignedTo;
      }
      if (Object.keys(updates).length === 0) return INVALID_TASK;
      let mutation = ctx.supabaseUser.from("inbox_tasks").update(updates)
        .eq("organization_id", ctx.orgId).eq("id", current.id);
      mutation = current.assigned_to
        ? mutation.eq("assigned_to", current.assigned_to)
        : mutation.is("assigned_to", null);
      const { data, error } = await mutation.select(INBOX_TASK_COLUMNS).maybeSingle();
      if (error || data === null) return CALENDAR_INBOX_DATABASE_ERROR;
      const task = calendarInboxTaskRow(data);
      if (!task || task.organization_id !== ctx.orgId) return CALENDAR_INBOX_DATABASE_ERROR;
      return {
        success: true,
        operation: "updated",
        ...calendarInboxResource("inbox_task", task.id, "/inbox"),
        task,
      };
    },
  },
  {
    name: "complete_inbox_task",
    module: "inbox",
    description: "Concluir ou reabrir uma tarefa real da Inbox.",
    parameters: {
      type: "object",
      properties: { task_id: { type: "string" }, completed: { type: "boolean" } },
      required: ["task_id", "completed"],
      additionalProperties: false,
    },
    permission: { module: "inbox", subarea: "tasks", action: "edit" },
    isWrite: true,
    confirmation: { kind: "immediate" },
    execute: async (args, ctx) => {
      const taskId = calendarInboxUuid(args.task_id);
      const current = taskId ? await calendarInboxLoadTask(ctx, taskId) : null;
      if (!current || typeof args.completed !== "boolean") {
        return INVALID_TASK;
      }
      let mutation = ctx.supabaseUser.from("inbox_tasks")
        .update({ done_at: args.completed ? new Date().toISOString() : null })
        .eq("organization_id", ctx.orgId).eq("id", current.id);
      mutation = current.assigned_to
        ? mutation.eq("assigned_to", current.assigned_to)
        : mutation.is("assigned_to", null);
      const { data, error } = await mutation.select(INBOX_TASK_COLUMNS).maybeSingle();
      if (error || data === null) return CALENDAR_INBOX_DATABASE_ERROR;
      const task = calendarInboxTaskRow(data);
      if (!task || task.organization_id !== ctx.orgId) return CALENDAR_INBOX_DATABASE_ERROR;
      return {
        success: true,
        operation: args.completed ? "completed" : "reopened",
        ...calendarInboxResource("inbox_task", task.id, "/inbox"),
        task,
      };
    },
  },
];
