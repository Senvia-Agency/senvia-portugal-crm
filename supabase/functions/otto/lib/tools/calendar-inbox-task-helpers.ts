import { canAccessRecord } from "../record-scope.ts";
import type { ToolContext } from "../types.ts";
import {
  calendarInboxIsRecord,
  calendarInboxUuid,
} from "./calendar-inbox-shared.ts";

export const INBOX_TASK_COLUMNS = "id, organization_id, created_by, assigned_to, source_channel_id, contact_phone, contact_name, lead_id, client_id, title, description, due_at, done_at, suggested, created_at";

export type InboxTaskRow = {
  readonly id: string;
  readonly organization_id: string;
  readonly created_by: string | null;
  readonly assigned_to: string | null;
  readonly source_channel_id: string | null;
  readonly contact_phone: string | null;
  readonly contact_name: string | null;
  readonly lead_id: string | null;
  readonly client_id: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly due_at: string | null;
  readonly done_at: string | null;
  readonly suggested: boolean;
  readonly created_at: string;
};

export type InboxConversationBinding = {
  readonly conversationId: string;
  readonly channelId: string;
  readonly contactPhone: string;
  readonly contactName: string | null;
  readonly leadId: string | null;
  readonly clientId: string | null;
};

export function calendarInboxTaskRow(value: unknown): InboxTaskRow | null {
  if (!calendarInboxIsRecord(value)) return null;
  const id = calendarInboxUuid(value.id);
  const organizationId = calendarInboxUuid(value.organization_id);
  if (!id || !organizationId || typeof value.title !== "string") return null;
  return {
    id,
    organization_id: organizationId,
    created_by: calendarInboxUuid(value.created_by),
    assigned_to: calendarInboxUuid(value.assigned_to),
    source_channel_id: calendarInboxUuid(value.source_channel_id),
    contact_phone: typeof value.contact_phone === "string" ? value.contact_phone : null,
    contact_name: typeof value.contact_name === "string" ? value.contact_name : null,
    lead_id: calendarInboxUuid(value.lead_id),
    client_id: calendarInboxUuid(value.client_id),
    title: value.title,
    description: typeof value.description === "string" ? value.description : null,
    due_at: typeof value.due_at === "string" ? value.due_at : null,
    done_at: typeof value.done_at === "string" ? value.done_at : null,
    suggested: value.suggested === true,
    created_at: typeof value.created_at === "string" ? value.created_at : "",
  };
}

export async function calendarInboxLoadTask(
  ctx: ToolContext,
  taskId: string,
): Promise<InboxTaskRow | null> {
  const { data, error } = await ctx.supabaseUser.from("inbox_tasks")
    .select(INBOX_TASK_COLUMNS).eq("organization_id", ctx.orgId)
    .eq("id", taskId).eq("suggested", false).maybeSingle();
  if (error || data === null) return null;
  const task = calendarInboxTaskRow(data);
  return task && task.organization_id === ctx.orgId && canAccessRecord(ctx, task)
    ? task
    : null;
}

export async function calendarInboxLoadConversation(
  ctx: ToolContext,
  conversationId: string,
): Promise<InboxConversationBinding | null> {
  const { data, error } = await ctx.supabaseUser.from("meta_conversations")
    .select("id, organization_id, channel_id, contact_ref, contact_name, lead_id, client_id, assigned_to")
    .eq("organization_id", ctx.orgId).eq("id", conversationId).maybeSingle();
  if (error || !calendarInboxIsRecord(data) || data.organization_id !== ctx.orgId
    || data.id !== conversationId
    || typeof data.contact_ref !== "string" || !/^\d{9,15}$/.test(data.contact_ref)
    || !canAccessRecord(ctx, data)) return null;
  const channelId = calendarInboxUuid(data.channel_id);
  if (!channelId) return null;
  const { data: channel, error: channelError } = await ctx.supabaseUser.from("messaging_channels")
    .select("id, organization_id, channel_type, status, archived_at")
    .eq("organization_id", ctx.orgId).eq("id", channelId).maybeSingle();
  if (channelError || !calendarInboxIsRecord(channel)
    || channel.organization_id !== ctx.orgId || channel.channel_type !== "whatsapp"
    || channel.status !== "connected" || channel.archived_at !== null) return null;
  return {
    conversationId,
    channelId,
    contactPhone: data.contact_ref,
    contactName: typeof data.contact_name === "string" ? data.contact_name : null,
    leadId: calendarInboxUuid(data.lead_id),
    clientId: calendarInboxUuid(data.client_id),
  };
}
