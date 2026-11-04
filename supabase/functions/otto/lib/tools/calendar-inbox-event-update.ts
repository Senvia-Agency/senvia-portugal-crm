import type { Tool } from "../types.ts";
import {
  CALENDAR_EVENT_COLUMNS,
  calendarInboxCanUseLead,
  calendarInboxEventRow,
  calendarInboxEventStatus,
  calendarInboxEventType,
  calendarInboxLoadEvent,
  calendarInboxReminder,
  calendarInboxValidRange,
} from "./calendar-inbox-event-helpers.ts";
import {
  CALENDAR_INBOX_DATABASE_ERROR,
  calendarInboxHasOwn,
  calendarInboxIsoInstant,
  calendarInboxResource,
  calendarInboxText,
  calendarInboxUuid,
} from "./calendar-inbox-shared.ts";

const INVALID_UPDATE = {
  error: "Alteração de evento inválida",
  reason_code: "invalid_event_update",
  _instruction: "Confirma o ID e apenas os campos a alterar; datas exigem timezone explícito.",
} as const;

function nullableText(value: unknown, maximumLength: number): string | null | undefined {
  if (value === null || value === "") return null;
  return calendarInboxText(value, maximumLength) ?? undefined;
}

function nullableLink(value: unknown): string | null | undefined {
  const text = nullableText(value, 2048);
  if (text === null || text === undefined) return text;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? text : undefined;
  } catch {
    return undefined;
  }
}

export const calendarEventUpdateTools: Tool[] = [{
  name: "update_calendar_event",
  module: "calendar",
  description: "Editar apenas campos explícitos de um evento nativo da Agenda dentro do âmbito autorizado.",
  parameters: {
    type: "object",
    properties: {
      event_id: { type: "string" },
      title: { type: "string", maxLength: 200 },
      event_type: { type: "string", enum: ["meeting", "call", "task", "follow_up"] },
      start_time: { type: "string" },
      end_time: { type: ["string", "null"] },
      all_day: { type: "boolean" },
      description: { type: ["string", "null"], maxLength: 5000 },
      lead_id: { type: ["string", "null"] },
      reminder_minutes: { type: ["integer", "null"], enum: [15, 30, 60, 1440, null] },
      meeting_link: { type: ["string", "null"] },
      status: { type: "string", enum: ["pending", "completed", "cancelled"] },
    },
    required: ["event_id"],
    additionalProperties: false,
  },
  permission: { module: "calendar", subarea: "events", action: "edit" },
  isWrite: true,
  confirmation: { kind: "immediate" },
  execute: async (args, ctx) => {
    const eventId = calendarInboxUuid(args.event_id);
    if (!eventId) return INVALID_UPDATE;
    const current = await calendarInboxLoadEvent(ctx, eventId);
    if (!current) return { error: "Evento não encontrado", reason_code: "event_not_found" };
    const values: Readonly<Record<string, unknown>> = args;
    const updates: Record<string, unknown> = {};
    if (calendarInboxHasOwn(values, "title")) {
      const title = calendarInboxText(args.title, 200);
      if (!title) return INVALID_UPDATE;
      updates.title = title;
    }
    if (calendarInboxHasOwn(values, "event_type")) {
      const type = calendarInboxEventType(args.event_type);
      if (!type) return INVALID_UPDATE;
      updates.event_type = type;
    }
    const start = calendarInboxHasOwn(values, "start_time")
      ? calendarInboxIsoInstant(args.start_time)
      : current.start_time;
    const end = calendarInboxHasOwn(values, "end_time")
      ? args.end_time === null ? null : calendarInboxIsoInstant(args.end_time)
      : current.end_time;
    const invalidEnd = calendarInboxHasOwn(values, "end_time")
      && args.end_time !== null && end === null;
    if (!start || invalidEnd || !calendarInboxValidRange(start, end)) return INVALID_UPDATE;
    if (calendarInboxHasOwn(values, "start_time")) updates.start_time = start;
    if (calendarInboxHasOwn(values, "end_time")) updates.end_time = end;
    if (calendarInboxHasOwn(values, "description")) {
      const description = nullableText(args.description, 5000);
      if (description === undefined) return INVALID_UPDATE;
      updates.description = description;
    }
    if (calendarInboxHasOwn(values, "meeting_link")) {
      const link = nullableLink(args.meeting_link);
      if (link === undefined) return INVALID_UPDATE;
      updates.meeting_link = link;
    }
    if (calendarInboxHasOwn(values, "all_day")) {
      if (typeof args.all_day !== "boolean") return INVALID_UPDATE;
      updates.all_day = args.all_day;
    }
    if (calendarInboxHasOwn(values, "status")) {
      const status = calendarInboxEventStatus(args.status);
      if (!status) return INVALID_UPDATE;
      updates.status = status;
    }
    if (calendarInboxHasOwn(values, "reminder_minutes")) {
      const reminder = calendarInboxReminder(args.reminder_minutes);
      if (reminder === undefined) return INVALID_UPDATE;
      updates.reminder_minutes = reminder;
      updates.reminder_sent = false;
    }
    if (calendarInboxHasOwn(values, "lead_id")) {
      const leadId = args.lead_id === null ? null : calendarInboxUuid(args.lead_id);
      if (leadId === null && args.lead_id !== null) return INVALID_UPDATE;
      if (!await calendarInboxCanUseLead(ctx, leadId)) {
        return { error: "Lead fora do âmbito", reason_code: "record_scope_denied" };
      }
      updates.lead_id = leadId;
    }
    if (Object.keys(updates).length === 0) return INVALID_UPDATE;
    const { data, error } = await ctx.supabaseAdmin.from("calendar_events").update(updates)
      .eq("organization_id", ctx.orgId).eq("id", eventId)
      .eq("user_id", current.user_id).eq("updated_at", current.updated_at)
      .select(CALENDAR_EVENT_COLUMNS).maybeSingle();
    if (error || data === null) return CALENDAR_INBOX_DATABASE_ERROR;
    const event = calendarInboxEventRow(data);
    if (!event || event.organization_id !== ctx.orgId) return CALENDAR_INBOX_DATABASE_ERROR;
    return {
      success: true,
      operation: "updated",
      ...calendarInboxResource("calendar_event", event.id, "/calendar"),
      event,
    };
  },
}];
