import { filterAccessibleRecords } from "../record-scope.ts";
import type { Tool } from "../types.ts";
import {
  MESSAGING_CONVERSATION_COLUMNS,
  messagingChannelRow,
  messagingConversationRow,
  messagingLoadChannel,
  messagingLoadConversation,
} from "./messaging-conversation-helpers.ts";
import {
  MESSAGING_DATABASE_ERROR,
  messagingIsRecord,
  messagingUuid,
} from "./messaging-shared.ts";

export const messagingConversationReadTools: Tool[] = [
  {
    name: "list_inbox_conversations",
    module: "inbox",
    description: "Listar conversas nativas recentes de WhatsApp, Instagram e Messenger acessíveis ao utilizador. Exclui caixas arquivadas.",
    parameters: {
      type: "object",
      properties: {
        channel_id: { type: "string" },
        status: { type: "string" },
        search: { type: "string", maxLength: 100 },
      },
      required: [],
      additionalProperties: false,
    },
    permission: { module: "inbox", subarea: "messages", action: "view" },
    execute: async (args, ctx) => {
      const channelId = args.channel_id === undefined ? null : messagingUuid(args.channel_id);
      const status = args.status === undefined ? null : typeof args.status === "string"
          && args.status.trim().length > 0 && args.status.trim().length <= 50
        ? args.status.trim()
        : null;
      const search = args.search === undefined ? "" : typeof args.search === "string"
          && args.search.trim().length <= 100
        ? args.search.trim().toLowerCase()
        : null;
      if ((args.channel_id !== undefined && !channelId)
        || (args.status !== undefined && !status) || search === null) {
        return { error: "Filtro de conversas inválido", reason_code: "invalid_conversation_filter" };
      }
      let query = ctx.supabaseUser.from("meta_conversations")
        .select(MESSAGING_CONVERSATION_COLUMNS).eq("organization_id", ctx.orgId)
        .order("last_message_at", { ascending: false, nullsFirst: false }).limit(150);
      if (channelId) query = query.eq("channel_id", channelId);
      if (status) query = query.eq("status", status);
      const [{ data, error }, channelsResult] = await Promise.all([
        query,
        ctx.supabaseUser.from("messaging_channels")
          .select("id, organization_id, channel_type, provider, label, status, archived_at")
          .eq("organization_id", ctx.orgId).is("archived_at", null),
      ]);
      const rows: unknown = data;
      const channelRows: unknown = channelsResult.data;
      if (error || channelsResult.error || !Array.isArray(rows) || !Array.isArray(channelRows)) {
        return MESSAGING_DATABASE_ERROR;
      }
      const conversations = rows.map(messagingConversationRow);
      const channels = channelRows.map(messagingChannelRow);
      if (conversations.some((item) => item === null) || channels.some((item) => item === null)) {
        return MESSAGING_DATABASE_ERROR;
      }
      const activeChannels = new Map(channels.filter((item) => item !== null).map((item) => [item.id, item]));
      const scoped = filterAccessibleRecords(ctx, conversations.filter((item) => item !== null));
      const visible = scoped.filter((item) => activeChannels.has(item.channel_id)
        && (search.length === 0
          || item.contact_ref.toLowerCase().includes(search)
          || item.contact_name?.toLowerCase().includes(search) === true));
      return {
        conversations: visible.slice(0, 50).map((conversation) => ({
          ...conversation,
          channel: activeChannels.get(conversation.channel_id),
        })),
        count: Math.min(visible.length, 50),
        scope: ctx.dataScope,
      };
    },
  },
  {
    name: "get_inbox_conversation",
    module: "inbox",
    description: "Obter uma conversa nativa e as mensagens mais recentes, sem credenciais do canal.",
    parameters: {
      type: "object",
      properties: { conversation_id: { type: "string" } },
      required: ["conversation_id"],
      additionalProperties: false,
    },
    permission: { module: "inbox", subarea: "messages", action: "view" },
    execute: async (args, ctx) => {
      const conversationId = messagingUuid(args.conversation_id);
      if (!conversationId) return { error: "Conversa inválida", reason_code: "invalid_conversation" };
      const conversation = await messagingLoadConversation(ctx, conversationId);
      if (!conversation) return { error: "Conversa não encontrada", reason_code: "conversation_not_found" };
      const channel = await messagingLoadChannel(ctx, conversation.channel_id);
      if (!channel) return { error: "Canal indisponível", reason_code: "channel_unavailable" };
      const { data, error } = await ctx.supabaseUser.from("meta_messages")
        .select("id, organization_id, conversation_id, external_id, direction, content, attachments, reaction, reaction_by, reply_to_external_id, sent_by, sent_at, created_at")
        .eq("organization_id", ctx.orgId).eq("conversation_id", conversationId)
        .eq("is_deleted", false).order("sent_at", { ascending: false, nullsFirst: false }).limit(100);
      const messages: unknown = data;
      if (error || !Array.isArray(messages)
        || !messages.every((message) => messagingIsRecord(message)
          && message.organization_id === ctx.orgId && message.conversation_id === conversationId)) {
        return MESSAGING_DATABASE_ERROR;
      }
      return { conversation, channel, messages: [...messages].reverse() };
    },
  },
];
