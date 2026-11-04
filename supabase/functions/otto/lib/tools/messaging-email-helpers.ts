import type { ToolContext } from "../types.ts";
import { messagingLoadChannel } from "./messaging-conversation-helpers.ts";
import {
  messagingEmailAddresses,
  messagingIsRecord,
  messagingUuid,
  type MessagingEmailAddress,
} from "./messaging-shared.ts";

export const EMAIL_DRAFT_COLUMNS = "id, organization_id, channel_id, author_id, to_addresses, cc_addresses, bcc_addresses, subject, body_html, in_reply_to, reply_message_id, attachments, created_at, updated_at";

export type MessagingEmailDraftRow = {
  readonly id: string;
  readonly organization_id: string;
  readonly channel_id: string;
  readonly author_id: string | null;
  readonly to_addresses: readonly MessagingEmailAddress[];
  readonly cc_addresses: readonly MessagingEmailAddress[];
  readonly bcc_addresses: readonly MessagingEmailAddress[];
  readonly subject: string;
  readonly body_html: string;
  readonly in_reply_to: string | null;
  readonly reply_message_id: string | null;
  readonly attachments: readonly unknown[];
  readonly created_at: string;
  readonly updated_at: string;
};

export function messagingEmailDraftRow(value: unknown): MessagingEmailDraftRow | null {
  if (!messagingIsRecord(value)) return null;
  const id = messagingUuid(value.id);
  const organizationId = messagingUuid(value.organization_id);
  const channelId = messagingUuid(value.channel_id);
  if (!id || !organizationId || !channelId) return null;
  const to = messagingEmailAddresses(value.to_addresses, true);
  const cc = messagingEmailAddresses(value.cc_addresses, true);
  const bcc = messagingEmailAddresses(value.bcc_addresses, true);
  if (!to || !cc || !bcc || !Array.isArray(value.attachments)) return null;
  return {
    id,
    organization_id: organizationId,
    channel_id: channelId,
    author_id: messagingUuid(value.author_id),
    to_addresses: to,
    cc_addresses: cc,
    bcc_addresses: bcc,
    subject: typeof value.subject === "string" ? value.subject : "",
    body_html: typeof value.body_html === "string" ? value.body_html : "",
    in_reply_to: typeof value.in_reply_to === "string" ? value.in_reply_to : null,
    reply_message_id: messagingUuid(value.reply_message_id),
    attachments: value.attachments,
    created_at: typeof value.created_at === "string" ? value.created_at : "",
    updated_at: typeof value.updated_at === "string" ? value.updated_at : "",
  };
}

export async function messagingLoadEmailChannel(
  ctx: ToolContext,
  channelId: string,
) {
  const channel = await messagingLoadChannel(ctx, channelId);
  return channel?.channel_type === "email" && channel.status === "connected" ? channel : null;
}

export async function messagingLoadEmailDraft(
  ctx: ToolContext,
  draftId: string,
): Promise<MessagingEmailDraftRow | null> {
  const { data, error } = await ctx.supabaseUser.from("email_drafts")
    .select(EMAIL_DRAFT_COLUMNS).eq("organization_id", ctx.orgId)
    .eq("id", draftId).maybeSingle();
  if (error || data === null) return null;
  const draft = messagingEmailDraftRow(data);
  if (!draft || draft.organization_id !== ctx.orgId
    || !await messagingLoadEmailChannel(ctx, draft.channel_id)) return null;
  return draft;
}
