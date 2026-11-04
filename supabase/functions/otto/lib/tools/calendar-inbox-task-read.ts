import { filterAccessibleRecords } from "../record-scope.ts";
import type { Tool } from "../types.ts";
import {
  INBOX_TASK_COLUMNS,
  calendarInboxTaskRow,
} from "./calendar-inbox-task-helpers.ts";
import {
  CALENDAR_INBOX_DATABASE_ERROR,
  calendarInboxUuid,
} from "./calendar-inbox-shared.ts";

export const calendarInboxTaskReadTools: Tool[] = [{
  name: "list_inbox_tasks",
  module: "inbox",
  description: "Listar tarefas reais da Inbox acessíveis neste canal e no âmbito own/team/all. Exclui sugestões ainda não aceites.",
  parameters: {
    type: "object",
    properties: {
      state: { type: "string", enum: ["open", "completed", "all"] },
      source_channel_id: { type: "string" },
    },
    required: [],
    additionalProperties: false,
  },
  permission: { module: "inbox", subarea: "tasks", action: "view" },
  execute: async (args, ctx) => {
    const state = args.state === undefined ? "open" : args.state;
    const channelId = args.source_channel_id === undefined
      ? null
      : calendarInboxUuid(args.source_channel_id);
    if ((state !== "open" && state !== "completed" && state !== "all")
      || (args.source_channel_id !== undefined && !channelId)) {
      return { error: "Filtro de tarefas inválido", reason_code: "invalid_task_filter" };
    }
    let query = ctx.supabaseUser.from("inbox_tasks").select(INBOX_TASK_COLUMNS)
      .eq("organization_id", ctx.orgId).eq("suggested", false)
      .order("due_at", { ascending: true, nullsFirst: false }).limit(200);
    if (state === "open") query = query.is("done_at", null);
    if (state === "completed") query = query.not("done_at", "is", null);
    if (channelId) query = query.eq("source_channel_id", channelId);
    const { data, error } = await query;
    const rows: unknown = data;
    if (error || !Array.isArray(rows)) return CALENDAR_INBOX_DATABASE_ERROR;
    const parsed = rows.map(calendarInboxTaskRow);
    if (parsed.some((task) => task === null)) return CALENDAR_INBOX_DATABASE_ERROR;
    const tasks = filterAccessibleRecords(ctx, parsed.filter((task) => task !== null));
    return { tasks, count: tasks.length, scope: ctx.dataScope };
  },
}];
