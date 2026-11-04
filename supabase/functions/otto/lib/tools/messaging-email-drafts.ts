import type { Tool } from "../types.ts";
import {
  EMAIL_DRAFT_COLUMNS,
  messagingEmailDraftRow,
  messagingLoadEmailChannel,
  messagingLoadEmailDraft,
} from "./messaging-email-helpers.ts";
import {
  MESSAGING_DATABASE_ERROR,
  messagingEmailAddresses,
  messagingResource,
  messagingUuid,
} from "./messaging-shared.ts";

const INVALID_DRAFT = {
  error: "Rascunho de email inválido",
  reason_code: "invalid_email_draft",
  _instruction: "Confirma caixa, destinatários, assunto e corpo. Anexos não são suportados por esta ferramenta.",
} as const;

function draftText(value: unknown, maximumLength: number): string | null {
  return typeof value === "string" && value.length <= maximumLength ? value : null;
}

export const messagingEmailDraftTools: Tool[] = [
  {
    name: "create_inbox_email_draft",
    module: "inbox",
    description: "Criar um rascunho nativo de email, editável na Inbox. Não envia e não aceita anexos.",
    parameters: {
      type: "object",
      properties: {
        channel_id: { type: "string" },
        to: { type: "array", maxItems: 50, items: { type: "object", properties: { name: { type: "string" }, address: { type: "string" } }, required: ["address"], additionalProperties: false } },
        cc: { type: "array", maxItems: 50, items: { type: "object", properties: { name: { type: "string" }, address: { type: "string" } }, required: ["address"], additionalProperties: false } },
        bcc: { type: "array", maxItems: 50, items: { type: "object", properties: { name: { type: "string" }, address: { type: "string" } }, required: ["address"], additionalProperties: false } },
        subject: { type: "string", maxLength: 500 },
        body_html: { type: "string", maxLength: 100000 },
        in_reply_to: { type: ["string", "null"], maxLength: 1000 },
        reply_message_id: { type: ["string", "null"] },
      },
      required: ["channel_id", "to", "subject", "body_html"],
      additionalProperties: false,
    },
    permission: { module: "inbox", subarea: "email", action: "create" },
    isWrite: true,
    confirmation: { kind: "immediate" },
    execute: async (args, ctx) => {
      const channelId = messagingUuid(args.channel_id);
      const to = messagingEmailAddresses(args.to, true);
      const cc = messagingEmailAddresses(args.cc ?? [], true);
      const bcc = messagingEmailAddresses(args.bcc ?? [], true);
      const subject = draftText(args.subject, 500);
      const body = draftText(args.body_html, 100000);
      const replyMessageId = args.reply_message_id === undefined || args.reply_message_id === null
        ? null
        : messagingUuid(args.reply_message_id);
      const invalidReply = args.reply_message_id !== undefined
        && args.reply_message_id !== null && replyMessageId === null;
      if (!channelId || !to || !cc || !bcc || subject === null || body === null || invalidReply
        || !await messagingLoadEmailChannel(ctx, channelId)) return INVALID_DRAFT;
      if (replyMessageId) {
        const { data, error } = await ctx.supabaseUser.from("email_messages").select("id")
          .eq("organization_id", ctx.orgId).eq("channel_id", channelId)
          .eq("id", replyMessageId).maybeSingle();
        if (error || data === null) return INVALID_DRAFT;
      }
      const inReplyTo = args.in_reply_to === null || args.in_reply_to === undefined
        ? null
        : draftText(args.in_reply_to, 1000);
      if (inReplyTo === null && args.in_reply_to !== null && args.in_reply_to !== undefined) return INVALID_DRAFT;
      const { data, error } = await ctx.supabaseUser.from("email_drafts").insert({
        organization_id: ctx.orgId,
        channel_id: channelId,
        author_id: ctx.userId,
        to_addresses: to,
        cc_addresses: cc,
        bcc_addresses: bcc,
        subject,
        body_html: body,
        in_reply_to: inReplyTo,
        reply_message_id: replyMessageId,
        attachments: [],
      }).select(EMAIL_DRAFT_COLUMNS).single();
      if (error) return MESSAGING_DATABASE_ERROR;
      const draft = messagingEmailDraftRow(data);
      if (!draft || draft.organization_id !== ctx.orgId) return MESSAGING_DATABASE_ERROR;
      return { success: true, operation: "created", ...messagingResource("email_draft", draft.id), draft };
    },
  },
  {
    name: "update_inbox_email_draft",
    module: "inbox",
    description: "Editar campos explícitos de um rascunho nativo de email. Não envia e não altera anexos.",
    parameters: {
      type: "object",
      properties: {
        draft_id: { type: "string" },
        to: { type: "array", maxItems: 50, items: { type: "object", properties: { name: { type: "string" }, address: { type: "string" } }, required: ["address"], additionalProperties: false } },
        cc: { type: "array", maxItems: 50, items: { type: "object", properties: { name: { type: "string" }, address: { type: "string" } }, required: ["address"], additionalProperties: false } },
        bcc: { type: "array", maxItems: 50, items: { type: "object", properties: { name: { type: "string" }, address: { type: "string" } }, required: ["address"], additionalProperties: false } },
        subject: { type: "string", maxLength: 500 },
        body_html: { type: "string", maxLength: 100000 },
      },
      required: ["draft_id"],
      additionalProperties: false,
    },
    permission: { module: "inbox", subarea: "email", action: "edit" },
    isWrite: true,
    confirmation: { kind: "immediate" },
    execute: async (args, ctx) => {
      const draftId = messagingUuid(args.draft_id);
      if (!draftId || !await messagingLoadEmailDraft(ctx, draftId)) return INVALID_DRAFT;
      const updates: Record<string, unknown> = {};
      for (const key of ["to", "cc", "bcc"] as const) {
        if (args[key] === undefined) continue;
        const addresses = messagingEmailAddresses(args[key], true);
        if (!addresses) return INVALID_DRAFT;
        updates[`${key}_addresses`] = addresses;
      }
      if (args.subject !== undefined) {
        const subject = draftText(args.subject, 500);
        if (subject === null) return INVALID_DRAFT;
        updates.subject = subject;
      }
      if (args.body_html !== undefined) {
        const body = draftText(args.body_html, 100000);
        if (body === null) return INVALID_DRAFT;
        updates.body_html = body;
      }
      if (Object.keys(updates).length === 0) return INVALID_DRAFT;
      const { data, error } = await ctx.supabaseUser.from("email_drafts").update(updates)
        .eq("organization_id", ctx.orgId).eq("id", draftId)
        .select(EMAIL_DRAFT_COLUMNS).maybeSingle();
      if (error || data === null) return MESSAGING_DATABASE_ERROR;
      const draft = messagingEmailDraftRow(data);
      if (!draft || draft.organization_id !== ctx.orgId) return MESSAGING_DATABASE_ERROR;
      return { success: true, operation: "updated", ...messagingResource("email_draft", draft.id), draft };
    },
  },
];
