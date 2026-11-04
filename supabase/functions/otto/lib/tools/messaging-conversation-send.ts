import type { Tool, ToolContext } from "../types.ts";
import {
  messagingLoadChannel,
  messagingLoadConversation,
  type MessagingChannelRow,
  type MessagingConversationRow,
} from "./messaging-conversation-helpers.ts";
import {
  messagingIsRecord,
  messagingResource,
  messagingText,
  messagingUuid,
} from "./messaging-shared.ts";

type BoundMessage = {
  readonly body: string;
  readonly conversation: MessagingConversationRow;
  readonly channel: MessagingChannelRow;
};

async function messagingBoundMessage(
  args: Readonly<Record<string, unknown>>,
  ctx: ToolContext,
): Promise<BoundMessage | null> {
  const conversationId = messagingUuid(args.conversation_id);
  const expectedChannelId = messagingUuid(args.channel_id);
  const expectedRecipient = messagingText(args.recipient_ref, 255);
  const body = typeof args.body === "string" && args.body.trim().length > 0
      && args.body.length <= 4096
    ? args.body
    : null;
  if (!conversationId || !expectedChannelId || !expectedRecipient || !body) return null;
  const conversation = await messagingLoadConversation(ctx, conversationId);
  if (!conversation || conversation.channel_id !== expectedChannelId
    || conversation.contact_ref !== expectedRecipient) return null;
  const channel = await messagingLoadChannel(ctx, conversation.channel_id);
  if (!channel || channel.status !== "connected"
    || !["whatsapp", "instagram", "messenger"].includes(channel.channel_type)) return null;
  const validLength = channel.channel_type === "whatsapp"
    ? [...body].length <= 4096
    : new TextEncoder().encode(body).length <= 1000;
  return validLength ? { body, conversation, channel } : null;
}

export const messagingConversationSendTools: Tool[] = [{
  name: "send_inbox_message",
  module: "inbox",
  description: "Enviar texto por uma conversa nativa WhatsApp/Instagram/Messenger através do contrato Edge meta-send. Não suporta anexos nem adivinha canal ou destinatário.",
  parameters: {
    type: "object",
    properties: {
      conversation_id: { type: "string" },
      channel_id: { type: "string" },
      recipient_ref: { type: "string", description: "Referência exata devolvida pela conversa" },
      body: { type: "string", maxLength: 4096 },
    },
    required: ["conversation_id", "channel_id", "recipient_ref", "body"],
    additionalProperties: false,
  },
  permission: { module: "inbox", subarea: "messages", action: "send" },
  isWrite: true,
  confirmation: {
    kind: "confirmation_required",
    preview: async (args, ctx) => {
      const bound = await messagingBoundMessage(args, ctx);
      if (!bound) return null;
      const recipient = bound.conversation.contact_name ?? bound.conversation.contact_ref;
      return {
        title: `Enviar mensagem por ${bound.channel.channel_type}`,
        summary: [
          `Caixa: ${bound.channel.label ?? bound.channel.id}`,
          `Destinatário: ${recipient} (${bound.conversation.contact_ref})`,
          "Mensagem:",
          bound.body,
          "Sem anexos. O resultado só será dado como entregue quando o provider confirmar.",
        ].join("\n"),
        destination: "/inbox",
      };
    },
  },
  execute: async (args, ctx) => {
    const values: Readonly<Record<string, unknown>> = args;
    const bound = await messagingBoundMessage(values, ctx);
    if (!bound) {
      return { error: "Mensagem ou destino inválido", reason_code: "message_binding_changed" };
    }
    const { data, error } = await ctx.supabaseUser.functions.invoke("meta-send", {
      body: { conversation_id: bound.conversation.id, text: bound.body },
    });
    if (error) {
      return {
        error: "Resultado do envio não confirmado",
        reason_code: "provider_outcome_unknown",
        outcome: "unknown",
        _instruction: "A confirmação foi consumida. NÃO repitas automaticamente: verifica a conversa/provider antes de preparar novo envio.",
      };
    }
    if (!messagingIsRecord(data) || data.success !== true) {
      return {
        error: messagingIsRecord(data) && typeof data.error === "string"
          ? data.error
          : "O provider recusou o envio",
        reason_code: "provider_rejected",
        outcome: "failed",
      };
    }
    const messageId = typeof data.message_id === "string" ? data.message_id : null;
    const stored = data.stored !== false;
    return {
      success: true,
      operation: "sent",
      outcome: stored ? "delivered" : "delivered_not_stored",
      ...messagingResource("meta_message", messageId ?? bound.conversation.id),
      provider_message_id: messageId,
      stored,
      _instruction: stored
        ? "O provider confirmou o envio e a mensagem ficou registada na Inbox."
        : "O provider confirmou entrega, mas o registo nativo falhou. NÃO reenvies; pede verificação manual.",
    };
  },
}];
