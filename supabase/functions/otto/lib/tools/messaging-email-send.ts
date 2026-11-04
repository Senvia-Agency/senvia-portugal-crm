import type { Tool, ToolContext } from "../types.ts";
import {
  messagingLoadEmailChannel,
  messagingLoadEmailDraft,
  type MessagingEmailDraftRow,
} from "./messaging-email-helpers.ts";
import {
  messagingIsRecord,
  messagingPreviewText,
  messagingResource,
  messagingUuid,
} from "./messaging-shared.ts";

type BoundEmailDraft = {
  readonly draft: MessagingEmailDraftRow;
  readonly channelLabel: string;
};

async function messagingBoundEmailDraft(
  args: Readonly<Record<string, unknown>>,
  ctx: ToolContext,
): Promise<BoundEmailDraft | null> {
  const draftId = messagingUuid(args.draft_id);
  if (!draftId || typeof args.expected_updated_at !== "string") return null;
  const draft = await messagingLoadEmailDraft(ctx, draftId);
  if (!draft || draft.updated_at !== args.expected_updated_at
    || draft.to_addresses.length === 0 || draft.attachments.length > 0
    || draft.subject.trim().length === 0 || draft.body_html.trim().length === 0
    || draft.body_html.length > 20_000) return null;
  const channel = await messagingLoadEmailChannel(ctx, draft.channel_id);
  if (!channel) return null;
  return { draft, channelLabel: channel.label ?? channel.id };
}

export const messagingEmailSendTools: Tool[] = [{
  name: "queue_inbox_email",
  module: "inbox",
  description: "Colocar um rascunho nativo sem anexos na fila durável email_commands. Exige confirmação; o resultado inicial é queued, nunca entregue.",
  parameters: {
    type: "object",
    properties: {
      draft_id: { type: "string" },
      expected_updated_at: { type: "string", description: "updated_at exato do rascunho revisto" },
    },
    required: ["draft_id", "expected_updated_at"],
    additionalProperties: false,
  },
  permission: { module: "inbox", subarea: "email", action: "send" },
  isWrite: true,
  confirmation: {
    kind: "confirmation_required",
    preview: async (args, ctx) => {
      const bound = await messagingBoundEmailDraft(args, ctx);
      if (!bound) return null;
      const recipients = bound.draft.to_addresses.map(({ name, address }) => name ? `${name} <${address}>` : address);
      return {
        title: "Enviar email da Inbox",
        summary: [
          `Caixa: ${bound.channelLabel}`,
          `Para: ${recipients.join(", ")}`,
          bound.draft.cc_addresses.length > 0
            ? `Cc: ${bound.draft.cc_addresses.map(({ address }) => address).join(", ")}`
            : "Cc: nenhum",
          `Assunto: ${bound.draft.subject}`,
          "Corpo:",
          messagingPreviewText(bound.draft.body_html),
          "Sem anexos. A confirmação apenas coloca o email na fila; entrega será reconciliada pela Inbox.",
        ].join("\n"),
        destination: "/inbox",
      };
    },
  },
  execute: async (args, ctx) => {
    const values: Readonly<Record<string, unknown>> = args;
    const bound = await messagingBoundEmailDraft(values, ctx);
    if (!bound) {
      return { error: "O rascunho mudou ou não pode ser enviado", reason_code: "email_draft_changed" };
    }
    let references: readonly string[] | undefined;
    if (bound.draft.reply_message_id) {
      const { data, error } = await ctx.supabaseUser.from("email_messages")
        .select("message_id, email_references").eq("organization_id", ctx.orgId)
        .eq("channel_id", bound.draft.channel_id).eq("id", bound.draft.reply_message_id).maybeSingle();
      if (error || !messagingIsRecord(data)) {
        return { error: "A resposta deixou de corresponder ao email original", reason_code: "email_reply_changed" };
      }
      const prior = Array.isArray(data.email_references)
        ? data.email_references.filter((value): value is string => typeof value === "string")
        : [];
      references = typeof data.message_id === "string" ? [...prior, data.message_id] : prior;
    }
    const payload = {
      to: bound.draft.to_addresses,
      cc: bound.draft.cc_addresses,
      bcc: bound.draft.bcc_addresses,
      subject: bound.draft.subject,
      html: bound.draft.body_html,
      text: messagingPreviewText(bound.draft.body_html),
      inReplyTo: bound.draft.in_reply_to,
      ...(references ? { references } : {}),
      attachments: [],
    };
    const { data, error } = await ctx.supabaseUser.from("email_commands").insert({
      organization_id: ctx.orgId,
      channel_id: bound.draft.channel_id,
      type: "send",
      payload,
      status: "pending",
      created_by: ctx.userId,
    }).select("id, status, created_at").single();
    const commandId = messagingIsRecord(data) ? messagingUuid(data.id) : null;
    if (error || !messagingIsRecord(data) || !commandId) {
      return {
        error: "Resultado da fila não confirmado",
        reason_code: "email_queue_outcome_unknown",
        outcome: "unknown",
        _instruction: "A confirmação foi consumida. NÃO repitas automaticamente; verifica a atividade da caixa.",
      };
    }
    return {
      success: true,
      operation: "queued",
      outcome: "queued_not_delivered",
      ...messagingResource("email_command", commandId),
      command: data,
      draft_id: bound.draft.id,
      _instruction: "O email está na fila durável. Não afirmes entrega; a Inbox atualizará para concluído ou erro.",
    };
  },
}];
