import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { CHAT_BUCKET, kindForFile, type ChatConversation, type ChatMember, type ChatMessage, type ChatMessageKind, type ChatReaction } from './chat-model';

const messageColumns = 'id,conversation_id,sender_id,kind,body,attachment_path,attachment_name,attachment_size,attachment_mime,duration_sec,reply_to_id,forwarded,created_at,edited_at,deleted_at';
type MessageRow = Pick<Tables<'workplace_chat_messages'>, 'id' | 'conversation_id' | 'sender_id' | 'kind' | 'body' | 'attachment_path' | 'attachment_name'
  | 'attachment_size' | 'attachment_mime' | 'duration_sec' | 'reply_to_id' | 'forwarded' | 'created_at' | 'edited_at' | 'deleted_at'>;

const messageKind = (value: string | null): ChatMessageKind =>
  value === 'image' || value === 'file' || value === 'audio' ? value : 'text';
const role = (value: string): ChatMember['role'] => value === 'owner' || value === 'admin' ? value : 'member';

export function mapMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id, conversationId: row.conversation_id, senderId: row.sender_id, kind: messageKind(row.kind), body: row.body,
    attachment: row.attachment_path ? { path: row.attachment_path, name: row.attachment_name ?? 'ficheiro', size: row.attachment_size, mime: row.attachment_mime, durationSec: row.duration_sec } : null,
    replyToId: row.reply_to_id, forwarded: row.forwarded, createdAt: row.created_at, editedAt: row.edited_at, deletedAt: row.deleted_at,
  };
}

// Database guards raise stable codes; people get the reason in plain Portuguese.
const knownErrors: readonly (readonly [RegExp, string])[] = [
  [/workplace_chat_not_member/, 'Já não é membro ativo desta organização.'],
  [/workplace_chat_invalid_colleague/, 'Uma das pessoas escolhidas já não é membro ativo da organização.'],
  [/workplace_chat_invalid_group_size/, 'Um grupo precisa de 2 a 100 pessoas.'],
  [/workplace_chat_invalid_title/, 'O nome do grupo deve ter entre 1 e 80 caracteres.'],
  [/workplace_chat_not_group_admin/, 'Só quem gere o grupo pode adicionar pessoas.'],
  [/workplace_chat_message_deleted/, 'Esta mensagem já foi eliminada.'],
  [/workplace_chat_only_text_editable/, 'Só as mensagens de texto podem ser editadas.'],
  [/(workplace_chat_[a-z_]+.*(does not exist|could not find))|((does not exist|could not find).*workplace_chat)|PGRST202|PGRST205/i,
    'Falta aplicar a migration 20261026150000_workplace_chat.sql no Supabase.'],
  [/exceeded the maximum allowed size|Payload too large/i, 'O ficheiro tem mais de 25 MB.'],
  [/mime type .* is not supported/i, 'Este tipo de ficheiro não é aceite.'],
];
export function describeChatError(error: unknown) {
  const parsed = z.object({ message: z.string(), code: z.string().optional() }).safeParse(error);
  const message = error instanceof Error ? error.message : parsed.success ? `${parsed.data.message} ${parsed.data.code ?? ''}` : 'Erro desconhecido';
  return knownErrors.find(([pattern]) => pattern.test(message))?.[1] ?? message;
}
export const isMissingMigration = (error: unknown) => describeChatError(error).startsWith('Falta aplicar a migration');

export async function bootstrapChat(organizationId: string) {
  const { data, error } = await supabase.rpc('workplace_chat_bootstrap', { _organization_id: organizationId });
  if (error) throw error;
  return data;
}

export async function listConversations(organizationId: string): Promise<ChatConversation[]> {
  const { data, error } = await supabase.rpc('workplace_chat_list_conversations', { _organization_id: organizationId });
  if (error) throw error;
  return (data ?? []).map(row => ({
    id: row.id, kind: row.kind === 'group' || row.kind === 'channel' ? row.kind : 'direct', title: row.title, isDefault: row.is_default,
    createdAt: row.created_at, lastMessageAt: row.last_message_at, myRole: role(row.my_role), isPinned: row.is_pinned,
    isMuted: row.is_muted, isArchived: row.is_archived, memberCount: row.member_count, unread: row.unread, peerUserId: row.peer_user_id,
    last: row.last_kind ? { senderId: row.last_sender_id, kind: messageKind(row.last_kind), body: row.last_body, attachmentName: row.last_attachment_name, deleted: row.last_deleted } : null,
  }));
}

export async function startDirect(organizationId: string, userId: string) {
  const { data, error } = await supabase.rpc('workplace_chat_start_direct', { _organization_id: organizationId, _other_user_id: userId });
  if (error) throw error;
  return data;
}

export async function createGroup(organizationId: string, title: string, memberIds: string[]) {
  const { data, error } = await supabase.rpc('workplace_chat_create_group', { _organization_id: organizationId, _title: title, _member_ids: memberIds });
  if (error) throw error;
  return data;
}

export async function addMembers(conversationId: string, memberIds: string[]) {
  const { error } = await supabase.rpc('workplace_chat_add_members', { _conversation_id: conversationId, _member_ids: memberIds });
  if (error) throw error;
}

export async function leaveGroup(conversationId: string) {
  const { error } = await supabase.rpc('workplace_chat_leave_group', { _conversation_id: conversationId });
  if (error) throw error;
}

export async function renameGroup(conversationId: string, title: string) {
  const { error } = await supabase.rpc('workplace_chat_rename_group', { _conversation_id: conversationId, _title: title });
  if (error) throw error;
}

export async function markRead(conversationId: string) {
  const { error } = await supabase.rpc('workplace_chat_mark_read', { _conversation_id: conversationId });
  if (error) throw error;
}

/** The latest `limit` messages, oldest first. */
export async function fetchMessages(conversationId: string, limit: number) {
  const { data, error } = await supabase.from('workplace_chat_messages').select(messageColumns)
    .eq('conversation_id', conversationId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  if (error) throw error;
  return { messages: data.slice(0, limit).reverse().map(mapMessage), hasMore: data.length > limit };
}

export async function fetchMembers(conversationId: string): Promise<ChatMember[]> {
  const { data, error } = await supabase.from('workplace_chat_members').select('user_id,role,last_read_at').eq('conversation_id', conversationId);
  if (error) throw error;
  return data.map(row => ({ userId: row.user_id, role: role(row.role), lastReadAt: row.last_read_at }));
}

export async function fetchReactions(conversationId: string): Promise<ChatReaction[]> {
  const { data, error } = await supabase.from('workplace_chat_reactions').select('message_id,user_id,emoji').eq('conversation_id', conversationId).limit(5000);
  if (error) throw error;
  return data.map(row => ({ messageId: row.message_id, userId: row.user_id, emoji: row.emoji }));
}

export async function sendText(conversationId: string, senderId: string, body: string, replyToId: string | null, forwarded = false) {
  const { data, error } = await supabase.from('workplace_chat_messages')
    .insert({ conversation_id: conversationId, sender_id: senderId, kind: 'text', body, reply_to_id: replyToId, forwarded })
    .select(messageColumns).single();
  if (error) throw error;
  return mapMessage(data);
}

const safeName = (name: string) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-120) || 'ficheiro';

export async function sendAttachment(conversationId: string, senderId: string, file: File, options: { replyToId?: string | null; caption?: string; durationSec?: number }) {
  const path = `${conversationId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const upload = await supabase.storage.from(CHAT_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (upload.error) throw upload.error;
  const { data, error } = await supabase.from('workplace_chat_messages').insert({
    conversation_id: conversationId, sender_id: senderId, kind: kindForFile(file), body: options.caption?.trim() || null,
    attachment_path: path, attachment_name: file.name.slice(0, 255), attachment_size: file.size, attachment_mime: file.type,
    duration_sec: options.durationSec ?? null, reply_to_id: options.replyToId ?? null,
  }).select(messageColumns).single();
  if (error) {
    // The message never existed: do not leave its file behind.
    await supabase.storage.from(CHAT_BUCKET).remove([path]);
    throw error;
  }
  return mapMessage(data);
}

export async function editMessage(messageId: string, body: string) {
  const { error } = await supabase.from('workplace_chat_messages').update({ body }).eq('id', messageId);
  if (error) throw error;
}

/** Deleting clears the content in the database; the sender's file is removed from storage too. */
export async function deleteMessage(message: ChatMessage) {
  const { error } = await supabase.from('workplace_chat_messages').update({ deleted_at: new Date().toISOString() }).eq('id', message.id);
  if (error) throw error;
  if (message.attachment) await supabase.storage.from(CHAT_BUCKET).remove([message.attachment.path]);
}

export async function forwardMessage(message: ChatMessage, targetConversationId: string, senderId: string) {
  if (!message.attachment) return sendText(targetConversationId, senderId, message.body ?? '', null, true);
  const path = `${targetConversationId}/${crypto.randomUUID()}-${safeName(message.attachment.name)}`;
  const copy = await supabase.storage.from(CHAT_BUCKET).copy(message.attachment.path, path);
  if (copy.error) throw copy.error;
  const { error } = await supabase.from('workplace_chat_messages').insert({
    conversation_id: targetConversationId, sender_id: senderId, kind: message.kind, body: message.body, forwarded: true,
    attachment_path: path, attachment_name: message.attachment.name, attachment_size: message.attachment.size,
    attachment_mime: message.attachment.mime, duration_sec: message.attachment.durationSec,
  });
  if (error) {
    await supabase.storage.from(CHAT_BUCKET).remove([path]);
    throw error;
  }
}

export async function setReaction(conversationId: string, messageId: string, userId: string, emoji: string, on: boolean) {
  const { error } = on
    ? await supabase.from('workplace_chat_reactions').insert({ conversation_id: conversationId, message_id: messageId, user_id: userId, emoji })
    : await supabase.from('workplace_chat_reactions').delete().eq('message_id', messageId).eq('user_id', userId).eq('emoji', emoji);
  // A duplicate press is already the wanted state.
  if (error && !(on && error.code === '23505')) throw error;
}

export async function updateSettings(conversationId: string, userId: string, patch: { is_pinned?: boolean; is_muted?: boolean; is_archived?: boolean }) {
  const { error } = await supabase.from('workplace_chat_member_settings')
    .upsert({ conversation_id: conversationId, user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'conversation_id,user_id' });
  if (error) throw error;
}

export async function searchMessages(organizationId: string, term: string) {
  const { data, error } = await supabase.rpc('workplace_chat_search_messages', { _organization_id: organizationId, _term: term, _limit: 20 });
  if (error) throw error;
  return data ?? [];
}

export async function signedUrl(path: string) {
  const { data, error } = await supabase.storage.from(CHAT_BUCKET).createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}
