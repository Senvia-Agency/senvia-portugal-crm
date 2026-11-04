import type { Tool } from "../types.ts";
import {
  CALENDAR_EVENT_COLUMNS,
  calendarInboxCanAssignUser,
  calendarInboxCanUseLead,
  calendarInboxEventRow,
  calendarInboxEventType,
  calendarInboxReminder,
  calendarInboxValidRange,
} from "./calendar-inbox-event-helpers.ts";
import {
  CALENDAR_INBOX_DATABASE_ERROR,
  calendarInboxIsoInstant,
  calendarInboxResource,
  calendarInboxText,
  calendarInboxUuid,
} from "./calendar-inbox-shared.ts";

const INVALID_EVENT = {
  error: "Evento inválido",
  reason_code: "invalid_event",
  _instruction: "Pede título, tipo e data ISO 8601 com timezone. Não inventes datas, participantes ou ligações.",
} as const;

function optionalText(value: unknown, maximumLength: number): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  return calendarInboxText(value, maximumLength) ?? undefined;
}

function meetingLink(value: unknown): string | null | undefined {
  const text = optionalText(value, 2048);
  if (text === null || text === undefined) return text;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? text : undefined;
  } catch {
    return undefined;
  }
}

export const calendarEventCreateTools: Tool[] = [{
  name: "create_calendar_event",
  module: "calendar",
  description: "Criar um evento nativo na Agenda. Não inventa fim, timezone, lead, participante ou link em falta.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", maxLength: 200 },
      event_type: { type: "string", enum: ["meeting", "call", "task", "follow_up"] },
      start_time: { type: "string", description: "ISO 8601 com timezone" },
      end_time: { type: ["string", "null"], description: "ISO 8601 com timezone" },
      all_day: { type: "boolean" },
      description: { type: ["string", "null"], maxLength: 5000 },
      lead_id: { type: ["string", "null"] },
      user_id: { type: "string", description: "Omitido cria para o utilizador atual" },
      reminder_minutes: { type: ["integer", "null"], enum: [15, 30, 60, 1440, null] },
      meeting_link: { type: ["string", "null"] },
    },
    required: ["title", "event_type", "start_time"],
    additionalProperties: false,
  },
  permission: { module: "calendar", subarea: "events", action: "create" },
  isWrite: true,
  confirmation: { kind: "immediate" },
  execute: async (args, ctx) => {
    const title = calendarInboxText(args.title, 200);
    const eventType = calendarInboxEventType(args.event_type);
    const start = calendarInboxIsoInstant(args.start_time);
    const end = args.end_time === undefined || args.end_time === null
      ? null
      : calendarInboxIsoInstant(args.end_time);
    const description = optionalText(args.description, 5000);
    const link = meetingLink(args.meeting_link);
    const leadId = args.lead_id === undefined || args.lead_id === null
      ? null
      : calendarInboxUuid(args.lead_id);
    const userId = args.user_id === undefined ? ctx.userId : calendarInboxUuid(args.user_id);
    const reminder = calendarInboxReminder(args.reminder_minutes ?? null);
    const invalidEnd = args.end_time !== undefined && args.end_time !== null && end === null;
    const invalidLead = args.lead_id !== undefined && args.lead_id !== null && leadId === null;
    if (!title || !eventType || !start || !userId || invalidEnd
      || description === undefined || link === undefined || invalidLead
      || reminder === undefined || !calendarInboxValidRange(start, end)
      || (args.all_day !== undefined && typeof args.all_day !== "boolean")) return INVALID_EVENT;
    if (!await calendarInboxCanAssignUser(ctx, userId)
      || !await calendarInboxCanUseLead(ctx, leadId)) {
      return { error: "Referência fora do âmbito", reason_code: "record_scope_denied" };
    }
    const { data, error } = await ctx.supabaseAdmin.from("calendar_events").insert({
      organization_id: ctx.orgId,
      user_id: userId,
      lead_id: leadId,
      title,
      description,
      event_type: eventType,
      start_time: start,
      end_time: end,
      all_day: args.all_day === true,
      reminder_minutes: reminder,
      meeting_link: link,
      status: "pending",
    }).select(CALENDAR_EVENT_COLUMNS).single();
    if (error) return CALENDAR_INBOX_DATABASE_ERROR;
    const event = calendarInboxEventRow(data);
    if (!event || event.organization_id !== ctx.orgId) return CALENDAR_INBOX_DATABASE_ERROR;
    return {
      success: true,
      operation: "created",
      ...calendarInboxResource("calendar_event", event.id, "/calendar"),
      event,
    };
  },
}];
