import { filterAccessibleRecords } from "../record-scope.ts";
import type { Tool } from "../types.ts";
import {
  CALENDAR_EVENT_COLUMNS,
  calendarInboxCanAssignUser,
  calendarInboxEventRow,
} from "./calendar-inbox-event-helpers.ts";
import {
  CALENDAR_INBOX_DATABASE_ERROR,
  calendarInboxIsoInstant,
  calendarInboxUuid,
} from "./calendar-inbox-shared.ts";

const INVALID_RANGE = {
  error: "Intervalo inválido",
  reason_code: "invalid_time_range",
  _instruction: "Pede datas ISO 8601 completas com timezone explícito.",
} as const;

export const calendarEventReadTools: Tool[] = [
  {
    name: "list_calendar_events",
    module: "calendar",
    description: "Listar eventos reais da Agenda no âmbito own/team/all do utilizador. Datas opcionais exigem ISO 8601 com timezone.",
    parameters: {
      type: "object",
      properties: {
        starts_at_or_after: { type: "string" },
        starts_before: { type: "string" },
        status: { type: "string", enum: ["pending", "completed", "cancelled"] },
      },
      required: [],
      additionalProperties: false,
    },
    permission: { module: "calendar", subarea: "events", action: "view" },
    execute: async (args, ctx) => {
      const validStatus = args.status === undefined || args.status === "pending"
        || args.status === "completed" || args.status === "cancelled";
      const lower = args.starts_at_or_after === undefined
        ? null
        : calendarInboxIsoInstant(args.starts_at_or_after);
      const upper = args.starts_before === undefined
        ? null
        : calendarInboxIsoInstant(args.starts_before);
      if (!validStatus || (args.starts_at_or_after !== undefined && lower === null)
        || (args.starts_before !== undefined && upper === null)
        || (lower && upper && Date.parse(upper) <= Date.parse(lower))) return INVALID_RANGE;
      let query = ctx.supabaseAdmin.from("calendar_events").select(CALENDAR_EVENT_COLUMNS)
        .eq("organization_id", ctx.orgId).order("start_time", { ascending: true }).limit(200);
      if (lower) query = query.gte("start_time", lower);
      if (upper) query = query.lt("start_time", upper);
      if (args.status === "pending" || args.status === "completed" || args.status === "cancelled") {
        query = query.eq("status", args.status);
      }
      const { data, error } = await query;
      const rows: unknown = data;
      if (error || !Array.isArray(rows)) return CALENDAR_INBOX_DATABASE_ERROR;
      const parsed = rows.map(calendarInboxEventRow);
      if (parsed.some((event) => event === null)) return CALENDAR_INBOX_DATABASE_ERROR;
      const events = filterAccessibleRecords(ctx, parsed.filter((event) => event !== null));
      return { events, count: events.length, scope: ctx.dataScope };
    },
  },
  {
    name: "check_calendar_availability",
    module: "calendar",
    description: "Consultar conflitos reais de Agenda para o utilizador atual ou outro utilizador dentro do âmbito autorizado. Não cria nem altera eventos.",
    parameters: {
      type: "object",
      properties: {
        start_time: { type: "string", description: "ISO 8601 com timezone" },
        end_time: { type: "string", description: "ISO 8601 com timezone" },
        user_id: { type: "string", description: "UUID; omitido usa o utilizador atual" },
      },
      required: ["start_time", "end_time"],
      additionalProperties: false,
    },
    permission: { module: "calendar", subarea: "events", action: "view" },
    execute: async (args, ctx) => {
      const start = calendarInboxIsoInstant(args.start_time);
      const end = calendarInboxIsoInstant(args.end_time);
      const userId = args.user_id === undefined ? ctx.userId : calendarInboxUuid(args.user_id);
      if (!start || !end || Date.parse(end) <= Date.parse(start) || !userId) return INVALID_RANGE;
      if (!await calendarInboxCanAssignUser(ctx, userId)) {
        return { error: "Utilizador fora do âmbito", reason_code: "user_scope_denied" };
      }
      const { data, error } = await ctx.supabaseAdmin.from("calendar_events")
        .select(CALENDAR_EVENT_COLUMNS).eq("organization_id", ctx.orgId)
        .eq("user_id", userId).neq("status", "cancelled").lt("start_time", end)
        .or(`end_time.gt.${start},and(end_time.is.null,start_time.gte.${start})`)
        .order("start_time", { ascending: true }).limit(100);
      const rows: unknown = data;
      if (error || !Array.isArray(rows)) return CALENDAR_INBOX_DATABASE_ERROR;
      const conflicts = rows.map(calendarInboxEventRow);
      if (conflicts.some((event) => event === null)) return CALENDAR_INBOX_DATABASE_ERROR;
      return {
        available: conflicts.length === 0,
        user_id: userId,
        start_time: start,
        end_time: end,
        conflicts: conflicts.filter((event) => event !== null),
      };
    },
  },
];
