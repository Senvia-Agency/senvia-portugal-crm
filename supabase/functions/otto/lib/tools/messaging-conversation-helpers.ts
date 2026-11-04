import { canAccessRecord } from "../record-scope.ts";
import type { ToolContext } from "../types.ts";
import { messagingIsRecord, messagingUuid } from "./messaging-shared.ts";

export const MESSAGING_CONVERSATION_COLUMNS = "id, organization_id, channel_id, contact_ref, contact_name, last_message, last_message_at, unread_count, status, window_expires_at, assigned_to, lead_id, client_id";

export type MessagingConversationRow = {
  readonly id: string;
  readonly organization_id: string;
  readonly channel_id: string;
  readonly contact_ref: string;
  readonly contact_name: string | null;
  readonly last_message: string | null;
  readonly last_message_at: string | null;
  readonly unread_count: number;
  readonly status: string;
  readonly window_expires_at: string | null;
  readonly assigned_to: string | null;
  readonly lead_id: string | null;
  readonly client_id: string | null;
};

export type MessagingChannelRow = {
  readonly id: string;
  readonly organization_id: string;
  readonly channel_type: string;
  readonly provider: string | null;
  readonly label: string | null;
  readonly status: string | null;
  readonly archived_at: string | null;
};

export function messagingConversationRow(value: unknown): MessagingConversationRow | null {
  if (!messagingIsRecord(value)) return null;
  const id = messagingUuid(value.id);
  const organizationId = messagingUuid(value.organization_id);
  const channelId = messagingUuid(value.channel_id);
  if (!id || !organizationId || !channelId
    || typeof value.contact_ref !== "string" || typeof value.status !== "string") return null;
  return {
    id,
    organization_id: organizationId,
    channel_id: channelId,
    contact_ref: value.contact_ref,
    contact_name: typeof value.contact_name === "string" ? value.contact_name : null,
    last_message: typeof value.last_message === "string" ? value.last_message : null,
    last_message_at: typeof value.last_message_at === "string" ? value.last_message_at : null,
    unread_count: typeof value.unread_count === "number" ? value.unread_count : 0,
    status: value.status,
    window_expires_at: typeof value.window_expires_at === "string" ? value.window_expires_at : null,
    assigned_to: messagingUuid(value.assigned_to),
    lead_id: messagingUuid(value.lead_id),
    client_id: messagingUuid(value.client_id),
  };
}

export function messagingChannelRow(value: unknown): MessagingChannelRow | null {
  if (!messagingIsRecord(value)) return null;
  const id = messagingUuid(value.id);
  const organizationId = messagingUuid(value.organization_id);
  if (!id || !organizationId || typeof value.channel_type !== "string") return null;
  return {
    id,
    organization_id: organizationId,
    channel_type: value.channel_type,
    provider: typeof value.provider === "string" ? value.provider : null,
    label: typeof value.label === "string" ? value.label : null,
    status: typeof value.status === "string" ? value.status : null,
    archived_at: typeof value.archived_at === "string" ? value.archived_at : null,
  };
}

export async function messagingLoadConversation(
  ctx: ToolContext,
  conversationId: string,
): Promise<MessagingConversationRow | null> {
  const { data, error } = await ctx.supabaseUser.from("meta_conversations")
    .select(MESSAGING_CONVERSATION_COLUMNS).eq("organization_id", ctx.orgId)
    .eq("id", conversationId).maybeSingle();
  if (error || data === null) return null;
  const conversation = messagingConversationRow(data);
  return conversation && conversation.organization_id === ctx.orgId
      && canAccessRecord(ctx, conversation)
    ? conversation
    : null;
}

export async function messagingLoadChannel(
  ctx: ToolContext,
  channelId: string,
): Promise<MessagingChannelRow | null> {
  const access = await ctx.supabaseUser.rpc("pode_aceder_caixa", {
    _user_id: ctx.userId,
    _channel_id: channelId,
  });
  if (access.error || access.data !== true) return null;
  const { data, error } = await ctx.supabaseUser.from("messaging_channels")
    .select("id, organization_id, channel_type, provider, label, status, archived_at")
    .eq("organization_id", ctx.orgId).eq("id", channelId).maybeSingle();
  if (error || data === null) return null;
  const channel = messagingChannelRow(data);
  return channel && channel.organization_id === ctx.orgId && channel.archived_at === null
    ? channel
    : null;
}
