import type { Tool } from "../types.ts";
import { calendarInboxLoadEvent } from "./calendar-inbox-event-helpers.ts";
import {
  CALENDAR_INBOX_DATABASE_ERROR,
  calendarInboxIsRecord,
  calendarInboxResource,
  calendarInboxUuid,
} from "./calendar-inbox-shared.ts";

export const calendarEventDeleteTools: Tool[] = [{
  name: "delete_calendar_event",
  module: "calendar",
  description: "Eliminar um evento da Agenda. É destrutivo e exige pré-visualização e confirmação de uso único.",
  parameters: {
    type: "object",
    properties: {
      event_id: { type: "string" },
      expected_updated_at: { type: "string", description: "updated_at exato do evento revisto" },
    },
    required: ["event_id", "expected_updated_at"],
    additionalProperties: false,
  },
  permission: { module: "calendar", subarea: "events", action: "delete" },
  isWrite: true,
  confirmation: {
    kind: "confirmation_required",
    preview: async (args, ctx) => {
      const eventId = calendarInboxUuid(args.event_id);
      if (!eventId || typeof args.expected_updated_at !== "string") return null;
      const event = await calendarInboxLoadEvent(ctx, eventId);
      if (!event || event.updated_at !== args.expected_updated_at) return null;
      return {
        title: "Eliminar evento da Agenda",
        summary: `Eliminar “${event.title}” (${event.event_type}) com início em ${event.start_time}. Esta operação remove o registo nativo da Agenda.`,
        destination: "/calendar",
      };
    },
  },
  execute: async (args, ctx) => {
    const eventId = calendarInboxUuid(args.event_id);
    const event = eventId ? await calendarInboxLoadEvent(ctx, eventId) : null;
    if (!event || typeof args.expected_updated_at !== "string"
      || event.updated_at !== args.expected_updated_at) {
      return { error: "Evento não encontrado", reason_code: "event_not_found" };
    }
    const { data, error } = await ctx.supabaseAdmin.from("calendar_events").delete()
      .eq("organization_id", ctx.orgId).eq("id", event.id)
      .eq("user_id", event.user_id).eq("updated_at", event.updated_at)
      .select("id").maybeSingle();
    if (error || !calendarInboxIsRecord(data) || data.id !== eventId) {
      return CALENDAR_INBOX_DATABASE_ERROR;
    }
    return {
      success: true,
      operation: "deleted",
      ...calendarInboxResource("calendar_event", event.id, "/calendar"),
    };
  },
}];
