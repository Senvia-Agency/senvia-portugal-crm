import { canAccessRecord, canAssignUser } from "../record-scope.ts";
import type { ToolContext } from "../types.ts";
import {
  calendarInboxIsRecord,
  calendarInboxUuid,
} from "./calendar-inbox-shared.ts";

export const CALENDAR_EVENT_COLUMNS = "id, organization_id, user_id, lead_id, title, description, event_type, start_time, end_time, all_day, meeting_link, status, reminder_minutes, reminder_sent, created_at, updated_at";

export type CalendarEventRow = {
  readonly id: string;
  readonly organization_id: string;
  readonly user_id: string;
  readonly lead_id: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly event_type: string;
  readonly start_time: string;
  readonly end_time: string | null;
  readonly all_day: boolean;
  readonly meeting_link: string | null;
  readonly status: string;
  readonly reminder_minutes: number | null;
  readonly reminder_sent: boolean;
  readonly created_at: string;
  readonly updated_at: string;
};

export function calendarInboxEventRow(value: unknown): CalendarEventRow | null {
  if (!calendarInboxIsRecord(value)) return null;
  const id = calendarInboxUuid(value.id);
  const organizationId = calendarInboxUuid(value.organization_id);
  const userId = calendarInboxUuid(value.user_id);
  const leadId = value.lead_id === null ? null : calendarInboxUuid(value.lead_id);
  if (!id || !organizationId || !userId
    || (value.lead_id !== null && !leadId)
    || typeof value.title !== "string"
    || typeof value.event_type !== "string"
    || typeof value.start_time !== "string"
    || (value.end_time !== null && typeof value.end_time !== "string")
    || typeof value.all_day !== "boolean"
    || typeof value.status !== "string") return null;
  return {
    id,
    organization_id: organizationId,
    user_id: userId,
    lead_id: leadId,
    title: value.title,
    description: typeof value.description === "string" ? value.description : null,
    event_type: value.event_type,
    start_time: value.start_time,
    end_time: value.end_time,
    all_day: value.all_day,
    meeting_link: typeof value.meeting_link === "string" ? value.meeting_link : null,
    status: value.status,
    reminder_minutes: typeof value.reminder_minutes === "number" ? value.reminder_minutes : null,
    reminder_sent: value.reminder_sent === true,
    created_at: typeof value.created_at === "string" ? value.created_at : "",
    updated_at: typeof value.updated_at === "string" ? value.updated_at : "",
  };
}

export async function calendarInboxLoadEvent(
  ctx: ToolContext,
  eventId: string,
): Promise<CalendarEventRow | null> {
  const { data, error } = await ctx.supabaseAdmin.from("calendar_events")
    .select(CALENDAR_EVENT_COLUMNS).eq("organization_id", ctx.orgId)
    .eq("id", eventId).maybeSingle();
  if (error || data === null) return null;
  const event = calendarInboxEventRow(data);
  return event && event.organization_id === ctx.orgId && canAccessRecord(ctx, event)
    ? event
    : null;
}

export async function calendarInboxCanUseLead(
  ctx: ToolContext,
  leadId: string | null,
): Promise<boolean> {
  if (leadId === null) return true;
  const { data, error } = await ctx.supabaseAdmin.from("leads")
    .select("id, organization_id, assigned_to")
    .eq("organization_id", ctx.orgId).eq("id", leadId).maybeSingle();
  return !error && calendarInboxIsRecord(data)
    && data.organization_id === ctx.orgId
    && canAccessRecord(ctx, data);
}

export async function calendarInboxCanAssignUser(
  ctx: ToolContext,
  userId: string,
): Promise<boolean> {
  if (!canAssignUser(ctx, userId)) return false;
  const { data, error } = await ctx.supabaseAdmin.from("organization_members")
    .select("user_id").eq("organization_id", ctx.orgId)
    .eq("user_id", userId).eq("is_active", true).maybeSingle();
  return !error && calendarInboxIsRecord(data) && data.user_id === userId;
}

export function calendarInboxEventType(value: unknown): string | null {
  return value === "meeting" || value === "call" || value === "task" || value === "follow_up"
    ? value
    : null;
}

export function calendarInboxEventStatus(value: unknown): string | null {
  return value === "pending" || value === "completed" || value === "cancelled"
    ? value
    : null;
}

export function calendarInboxReminder(value: unknown): number | null | undefined {
  if (value === null) return null;
  return value === 15 || value === 30 || value === 60 || value === 1440
    ? value
    : undefined;
}

export function calendarInboxValidRange(start: string, end: string | null): boolean {
  return end === null || Date.parse(end) > Date.parse(start);
}
