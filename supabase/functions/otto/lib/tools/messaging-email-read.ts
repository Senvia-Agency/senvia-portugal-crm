import type { Tool } from "../types.ts";
import { messagingLoadEmailChannel } from "./messaging-email-helpers.ts";
import {
  MESSAGING_DATABASE_ERROR,
  messagingIsRecord,
  messagingText,
  messagingUuid,
} from "./messaging-shared.ts";

const EMAIL_HEADER_COLUMNS = "id, organization_id, channel_id, folder_id, message_id, thread_id, in_reply_to, from_name, from_address, to_addresses, cc_addresses, subject, snippet, date, seen, flagged, answered, has_attachments, body_fetched";
const EMAIL_DETAIL_COLUMNS = `${EMAIL_HEADER_COLUMNS}, email_references, html_body, text_body`;

export const messagingEmailReadTools: Tool[] = [
  {
    name: "list_inbox_email_channels",
    module: "inbox",
    description: "Listar caixas de email nativas acessíveis, usando apenas colunas seguras e sem devolver configurações ou passwords.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    permission: { module: "inbox", subarea: "email", action: "view" },
    execute: async (_args, ctx) => {
      const { data, error } = await ctx.supabaseUser.from("messaging_channels")
        .select("id, organization_id, channel_type, provider, label, status, archived_at")
        .eq("organization_id", ctx.orgId).eq("channel_type", "email").is("archived_at", null)
        .order("label", { ascending: true });
      const rows: unknown = data;
      if (error || !Array.isArray(rows)
        || !rows.every((row) => messagingIsRecord(row) && row.organization_id === ctx.orgId)) {
        return MESSAGING_DATABASE_ERROR;
      }
      const accessible = await Promise.all(rows.map(async (row) => (
        typeof row.id === "string" ? await messagingLoadEmailChannel(ctx, row.id) : null
      )));
      const channels = accessible.filter((channel) => channel !== null);
      return { channels, count: channels.length };
    },
  },
  {
    name: "search_inbox_email_messages",
    module: "inbox",
    description: "Pesquisar assunto, remetente e resumo nas 200 mensagens mais recentes de uma caixa de email acessível.",
    parameters: {
      type: "object",
      properties: { channel_id: { type: "string" }, search: { type: "string", maxLength: 100 } },
      required: ["channel_id", "search"],
      additionalProperties: false,
    },
    permission: { module: "inbox", subarea: "email", action: "view" },
    execute: async (args, ctx) => {
      const channelId = messagingUuid(args.channel_id);
      const term = messagingText(args.search, 100)?.toLowerCase();
      if (!channelId || !term || !await messagingLoadEmailChannel(ctx, channelId)) {
        return { error: "Caixa ou pesquisa inválida", reason_code: "invalid_email_search" };
      }
      const { data, error } = await ctx.supabaseUser.from("email_messages")
        .select(EMAIL_HEADER_COLUMNS).eq("organization_id", ctx.orgId).eq("channel_id", channelId)
        .order("date", { ascending: false, nullsFirst: false }).limit(200);
      const rows: unknown = data;
      if (error || !Array.isArray(rows)
        || !rows.every((row) => messagingIsRecord(row) && row.organization_id === ctx.orgId)) {
        return MESSAGING_DATABASE_ERROR;
      }
      const matches = rows.filter((row) => {
        const values = [row.subject, row.from_name, row.from_address, row.snippet];
        return values.some((value) => typeof value === "string" && value.toLowerCase().includes(term));
      }).slice(0, 50);
      return { messages: matches, count: matches.length, searched_recent: rows.length };
    },
  },
  {
    name: "get_inbox_email_message",
    module: "inbox",
    description: "Obter detalhe de um email acessível. Se o corpo ainda não estiver em cache, usa o contrato Edge email-fetch-body antes de reler o registo nativo.",
    parameters: {
      type: "object",
      properties: { message_id: { type: "string" } },
      required: ["message_id"],
      additionalProperties: false,
    },
    permission: { module: "inbox", subarea: "email", action: "view" },
    execute: async (args, ctx) => {
      const messageId = messagingUuid(args.message_id);
      if (!messageId) return { error: "Email inválido", reason_code: "invalid_email_message" };
      const initial = await ctx.supabaseUser.from("email_messages").select(EMAIL_DETAIL_COLUMNS)
        .eq("organization_id", ctx.orgId).eq("id", messageId).maybeSingle();
      const channelId = messagingIsRecord(initial.data)
        ? messagingUuid(initial.data.channel_id)
        : null;
      if (initial.error || !messagingIsRecord(initial.data) || initial.data.organization_id !== ctx.orgId
        || !channelId || !await messagingLoadEmailChannel(ctx, channelId)) {
        return { error: "Email não encontrado", reason_code: "email_not_found" };
      }
      let bodyStatus = "available";
      if (initial.data.body_fetched !== true) {
        const fetched = await ctx.supabaseUser.functions.invoke("email-fetch-body", {
          body: { message_id: messageId },
        });
        bodyStatus = fetched.error ? "fetch_failed" : "fetched";
      }
      const [{ data: message, error }, attachmentsResult] = await Promise.all([
        ctx.supabaseUser.from("email_messages").select(EMAIL_DETAIL_COLUMNS)
          .eq("organization_id", ctx.orgId).eq("id", messageId).maybeSingle(),
        ctx.supabaseUser.from("email_attachments")
          .select("id, organization_id, message_id, filename, content_type, size, inline, content_id, storage_path")
          .eq("organization_id", ctx.orgId).eq("message_id", messageId),
      ]);
      const attachments: unknown = attachmentsResult.data;
      if (error || !messagingIsRecord(message) || message.organization_id !== ctx.orgId
        || attachmentsResult.error || !Array.isArray(attachments)) return MESSAGING_DATABASE_ERROR;
      return { message, attachments, body_status: bodyStatus };
    },
  },
];
