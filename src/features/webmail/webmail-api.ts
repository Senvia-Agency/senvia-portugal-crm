import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type { EmailAddress, EmailAttachment, EmailDraft, EmailMessage } from '@/hooks/useEmail';
import type { AccountPreference, WebmailFolder } from './webmail-model';

// The mailbox tables (email_*) predate the generated types: read them untyped, as useEmail does.
const db = supabase as unknown as { from: (table: string) => any };

const MISSING_MIGRATION = 'Falta aplicar a migration 20261026190000_webmail.sql no Supabase.';
const knownErrors: readonly (readonly [RegExp, string])[] = [
  [/Bucket not found/i, MISSING_MIGRATION],
  [/email_contact_lists_name|duplicate key/i, 'Já existe uma lista com esse nome.'],
  [/email_signature_forbidden|email_contacts_forbidden|row-level security/i, 'Não tem acesso a esta caixa.'],
  [/exceeded the maximum allowed size|Payload too large/i, 'A imagem passa dos 5 MB.'],
];
/** Maps database and storage errors to plain Portuguese. A missing migration names the file to run. */
export function describeWebmailError(error: unknown): string {
  const parsed = z.object({ message: z.string() }).safeParse(error);
  const message = error instanceof Error ? error.message : parsed.success ? parsed.data.message : 'Erro desconhecido';
  // A missing table or function reads "relation ... does not exist" or "Could not find the table ... in the schema cache".
  if (/does not exist|Could not find the (table|function)/i.test(message)
    && /email_(account_preferences|signatures|contacts|contact_lists|save_signatures|remember_contacts)/i.test(message)) return MISSING_MIGRATION;
  return knownErrors.find(([pattern]) => pattern.test(message))?.[1] ?? message;
}
export const isMissingMigration = (error: unknown) => describeWebmailError(error).startsWith('Falta aplicar');

// Preferences ---------------------------------------------------------------------------------

export async function readPreferences(organizationId: string, userId: string): Promise<AccountPreference[]> {
  const { data, error } = await supabase.from('email_account_preferences')
    .select('channel_id, label, color, notify, is_default, position')
    .eq('organization_id', organizationId).eq('user_id', userId);
  if (error) throw error;
  return data ?? [];
}

export type PreferencePatch = Partial<Pick<AccountPreference, 'label' | 'color' | 'notify' | 'position'>>;
export async function savePreference(organizationId: string, userId: string, channelId: string, patch: PreferencePatch) {
  const { error } = await supabase.from('email_account_preferences')
    .upsert({ user_id: userId, channel_id: channelId, organization_id: organizationId, ...patch }, { onConflict: 'user_id,channel_id' });
  if (error) throw error;
}

/** Only one default per person: the old one is cleared before the new one is set. */
export async function setDefaultAccount(organizationId: string, userId: string, channelId: string | null) {
  const cleared = await supabase.from('email_account_preferences').update({ is_default: false })
    .eq('organization_id', organizationId).eq('user_id', userId).eq('is_default', true);
  if (cleared.error) throw cleared.error;
  if (!channelId) return;
  const { error } = await supabase.from('email_account_preferences')
    .upsert({ user_id: userId, channel_id: channelId, organization_id: organizationId, is_default: true }, { onConflict: 'user_id,channel_id' });
  if (error) throw error;
}

export async function saveOrder(organizationId: string, userId: string, channelIds: readonly string[]) {
  if (channelIds.length === 0) return;
  const { error } = await supabase.from('email_account_preferences').upsert(
    channelIds.map((channelId, position) => ({ user_id: userId, channel_id: channelId, organization_id: organizationId, position })),
    { onConflict: 'user_id,channel_id' },
  );
  if (error) throw error;
}

// Signatures ----------------------------------------------------------------------------------

export interface PersonalSignature {
  readonly id: string;
  readonly name: string;
  readonly html: string;
  readonly is_default: boolean;
}

export async function readSignatures(channelId: string, userId: string): Promise<PersonalSignature[]> {
  const { data, error } = await supabase.from('email_signatures')
    .select('id, name, html, is_default').eq('channel_id', channelId).eq('user_id', userId).order('position');
  if (error) throw error;
  return data ?? [];
}

export interface SignatureDraft { readonly id: string | null; readonly name: string; readonly html: string; readonly is_default: boolean }
export async function saveSignatures(channelId: string, items: readonly SignatureDraft[]): Promise<PersonalSignature[]> {
  const payload = items.map(item => ({ id: item.id, name: item.name, html: item.html, is_default: item.is_default }));
  const { data, error } = await supabase.rpc('email_save_signatures', { _channel_id: channelId, _items: payload as unknown as Json });
  if (error) throw error;
  return (data ?? []).map(row => ({ id: row.id, name: row.name, html: row.html, is_default: row.is_default }));
}

const SIGNATURE_BUCKET = 'email-signatures';
export const SIGNATURE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const MAX_SIGNATURE_IMAGE = 5 * 1024 * 1024;

/** Big photos are scaled to 900px before upload (GIFs keep their animation). */
async function shrinkImage(file: File): Promise<Blob> {
  if (file.type === 'image/gif' || file.size <= 400 * 1024) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= MAX_SIGNATURE_IMAGE) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob ?? file), type, 0.88));
}

/** Uploads to the person's own folder and returns the public URL used in the signature HTML. */
export async function uploadSignatureImage(userId: string, file: File): Promise<string> {
  if (!SIGNATURE_IMAGE_TYPES.includes(file.type as typeof SIGNATURE_IMAGE_TYPES[number])) throw new Error('Use uma imagem PNG, JPEG, GIF ou WebP.');
  const body = await shrinkImage(file);
  if (body.size > MAX_SIGNATURE_IMAGE) throw new Error('A imagem passa dos 5 MB.');
  const extension = body.type === 'image/png' ? 'png' : body.type === 'image/gif' ? 'gif' : body.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${userId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(SIGNATURE_BUCKET).upload(path, body, { contentType: body.type, cacheControl: '31536000', upsert: false });
  if (error) throw error;
  return supabase.storage.from(SIGNATURE_BUCKET).getPublicUrl(path).data.publicUrl;
}

// Contacts ------------------------------------------------------------------------------------

export interface MailContact { readonly email: string; readonly name: string | null; readonly uses: number }
export async function readContacts(organizationId: string, userId: string): Promise<MailContact[]> {
  const { data, error } = await supabase.from('email_contacts').select('email, name, uses')
    .eq('organization_id', organizationId).eq('user_id', userId)
    .order('uses', { ascending: false }).order('last_used_at', { ascending: false }).limit(400);
  if (error) throw error;
  return data ?? [];
}

export async function rememberContacts(organizationId: string, addresses: readonly EmailAddress[]) {
  const items = addresses.filter(address => address.address).slice(0, 100).map(address => ({ email: address.address.toLowerCase(), name: address.name || null }));
  if (items.length === 0) return;
  const { error } = await supabase.rpc('email_remember_contacts', { _organization_id: organizationId, _items: items as unknown as Json });
  if (error) throw error;
}

export interface ContactList { readonly id: string; readonly name: string; readonly members: readonly EmailAddress[] }
const memberSchema = z.array(z.object({ email: z.string(), name: z.string().nullish() }).passthrough()).catch([]);
export async function readContactLists(organizationId: string, userId: string): Promise<ContactList[]> {
  const { data, error } = await supabase.from('email_contact_lists').select('id, name, members')
    .eq('organization_id', organizationId).eq('user_id', userId).order('name');
  if (error) throw error;
  return (data ?? []).map(row => ({ id: row.id, name: row.name, members: memberSchema.parse(row.members).map(member => ({ address: member.email, name: member.name ?? '' })) }));
}

export async function saveContactList(organizationId: string, list: { id: string | null; name: string; members: readonly EmailAddress[] }): Promise<string> {
  const members = list.members.slice(0, 500).map(member => ({ email: member.address.toLowerCase(), name: member.name || null })) as unknown as Json;
  if (list.id) {
    const { error } = await supabase.from('email_contact_lists').update({ name: list.name.trim(), members }).eq('id', list.id);
    if (error) throw error;
    return list.id;
  }
  const { data, error } = await supabase.from('email_contact_lists').insert({ organization_id: organizationId, name: list.name.trim(), members }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function deleteContactList(id: string) {
  const { error } = await supabase.from('email_contact_lists').delete().eq('id', id);
  if (error) throw error;
}

// Mailbox reads (RLS keeps them to the caixas this person may open) ----------------------------

export async function readFolders(channelIds: readonly string[]): Promise<WebmailFolder[]> {
  if (channelIds.length === 0) return [];
  const { data, error } = await db.from('email_folders')
    .select('id, channel_id, path, name, role, unread_count, total_count, sort, last_synced_at')
    .in('channel_id', channelIds).order('sort', { ascending: true }).order('name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export const LIST_COLUMNS = 'id, channel_id, folder_id, uid, message_id, thread_id, from_name, from_address, to_addresses, cc_addresses, subject, snippet, date, seen, flagged, answered, has_attachments';

export interface ListQuery {
  readonly channelIds: readonly string[];
  readonly folderIds: readonly string[] | null;
  readonly unread?: boolean;
  readonly starred?: boolean;
  readonly search?: string;
}

export async function readMessages(query: ListQuery): Promise<EmailMessage[]> {
  if (query.channelIds.length === 0 || (query.folderIds && query.folderIds.length === 0)) return [];
  let request = db.from('email_messages').select(LIST_COLUMNS).in('channel_id', query.channelIds);
  if (query.folderIds) request = request.in('folder_id', query.folderIds);
  if (query.unread) request = request.eq('seen', false);
  if (query.starred) request = request.eq('flagged', true);
  const term = (query.search ?? '').trim().replace(/[,()%*\\"]/g, ' ').trim();
  if (term.length >= 2) {
    const like = `%${term}%`;
    request = request.or(`subject.ilike.${like},from_name.ilike.${like},from_address.ilike.${like},snippet.ilike.${like}`);
  }
  const { data, error } = await request.order('date', { ascending: false }).limit(term.length >= 2 ? 150 : 300);
  if (error) throw error;
  return data ?? [];
}

/** The person's own drafts (others' drafts in a shared caixa are theirs to finish). */
export async function readDrafts(channelIds: readonly string[], userId: string): Promise<EmailDraft[]> {
  if (channelIds.length === 0) return [];
  const { data, error } = await db.from('email_drafts').select('*')
    .in('channel_id', channelIds).eq('author_id', userId).order('updated_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** One full message and its attachment list: same shape and cache key as the Inbox reader. */
export async function readMessage(messageId: string): Promise<{ message: EmailMessage; attachments: EmailAttachment[] }> {
  const { data: message, error } = await db.from('email_messages').select('*').eq('id', messageId).single();
  if (error) throw error;
  const { data: attachments } = await db.from('email_attachments')
    .select('id, message_id, filename, content_type, size, inline, content_id, storage_path').eq('message_id', messageId);
  return { message, attachments: attachments ?? [] };
}

/** Other messages of the same conversation in that caixa (any folder), newest first. */
export async function readThread(message: Pick<EmailMessage, 'id' | 'channel_id' | 'thread_id'>): Promise<EmailMessage[]> {
  if (!message.thread_id) return [];
  const { data, error } = await db.from('email_messages').select(`${LIST_COLUMNS}, body_fetched, html_body, text_body`)
    .eq('channel_id', message.channel_id).eq('thread_id', message.thread_id).neq('id', message.id)
    .order('date', { ascending: false }).limit(30);
  if (error) throw error;
  return data ?? [];
}

export interface CachedAttachment { readonly data_b64: string; readonly content_type: string | null }
/** Bytes already cached in the database (no request to the mail server). */
export async function readCachedAttachment(attachmentId: string): Promise<CachedAttachment | null> {
  const { data } = await db.from('email_attachments').select('data_b64, content_type').eq('id', attachmentId).maybeSingle();
  return data?.data_b64 ? { data_b64: data.data_b64, content_type: data.content_type ?? null } : null;
}

export function base64ToBlob(b64: string, type: string | null): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: type || 'application/octet-stream' });
}
