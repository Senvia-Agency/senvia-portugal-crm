import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';

// Mirrors the bucket in 20261026170000_workplace_feed_attachments.sql.
export const FEED_BUCKET = 'workplace-feed-files';
export const MAX_POST_FILES = 4;
export const MAX_POST_FILE_BYTES = 15 * 1024 * 1024;
export const POST_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic'] as const;
export const POST_DOCUMENT_TYPES = [
  'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;
const POST_FILE_TYPES: readonly string[] = [...POST_IMAGE_TYPES, ...POST_DOCUMENT_TYPES];

const attachmentSchema = z.object({ path: z.string().min(1), name: z.string().min(1), size: z.number().nonnegative(), mime: z.string().min(1) });
export type FeedAttachment = z.infer<typeof attachmentSchema>;

/** Attachments stored on a post; anything malformed is left out rather than breaking the Feed. */
export function parseAttachments(value: unknown): FeedAttachment[] {
  const parsed = z.array(z.unknown()).safeParse(value);
  if (!parsed.success) return [];
  return parsed.data.flatMap(item => { const one = attachmentSchema.safeParse(item); return one.success ? [one.data] : []; });
}

export const isImageMime = (mime: string) => mime.startsWith('image/');

/** Adds files to the ones already chosen, keeping the post's limits; says why any were left out. */
export function acceptPostFiles(current: readonly File[], incoming: readonly File[]): { files: File[]; error: string | null } {
  const valid = incoming.filter(file => POST_FILE_TYPES.includes(file.type) && file.size <= MAX_POST_FILE_BYTES);
  const files = [...current, ...valid].slice(0, MAX_POST_FILES);
  const dropped = incoming.length - (files.length - current.length);
  if (dropped === 0) return { files, error: null };
  const tooMany = current.length + valid.length > MAX_POST_FILES;
  return { files, error: tooMany ? `No máximo ${MAX_POST_FILES} ficheiros por publicação.` : 'Só fotografias, PDF, Word, Excel ou PowerPoint, até 15 MB cada.' };
}

const safeName = (name: string) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-120) || 'ficheiro';

/** Uploads files for a post the caller wrote, then records them on the post. Uploaded files are removed if recording fails. */
export async function attachFilesToPost(postId: string, files: readonly File[], existing: readonly FeedAttachment[]) {
  const uploaded: FeedAttachment[] = [];
  try {
    for (const file of files) {
      const path = `${postId}/${crypto.randomUUID()}-${safeName(file.name)}`;
      const result = await supabase.storage.from(FEED_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (result.error) throw result.error;
      uploaded.push({ path, name: file.name.slice(0, 255), size: file.size, mime: file.type });
    }
    const { error } = await supabase.from('workplace_posts').update({ attachments: [...existing, ...uploaded] }).eq('id', postId);
    if (error) throw error;
  } catch (error) {
    if (uploaded.length) await supabase.storage.from(FEED_BUCKET).remove(uploaded.map(item => item.path));
    throw error;
  }
}

export async function feedFileUrl(path: string) {
  const { data, error } = await supabase.storage.from(FEED_BUCKET).createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

export function fileLabel(attachment: Pick<FeedAttachment, 'mime' | 'name' | 'size'>) {
  const extension = attachment.name.includes('.') ? attachment.name.split('.').pop()!.toUpperCase() : attachment.mime.split('/').pop()!.toUpperCase();
  const size = attachment.size < 1024 * 1024 ? `${Math.max(1, Math.round(attachment.size / 1024))} KB` : `${(attachment.size / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  return `${extension} · ${size}`;
}
