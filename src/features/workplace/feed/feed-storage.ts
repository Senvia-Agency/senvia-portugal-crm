import { z } from 'zod';
const authorSchema = z.object({ id: z.string(), name: z.string().max(200) });
const commentSchema = z.object({ id: z.string(), author: authorSchema, text: z.string().max(2000), createdAt: z.string().datetime() });
export const postSchema = z.object({
  id: z.string(), author: authorSchema, text: z.string().min(1).max(6000),
  kind: z.enum(['publication', 'announcement']), pinned: z.boolean(),
  createdAt: z.string().datetime(), reactions: z.array(z.string()), comments: z.array(commentSchema),
});
const feedSchema = z.object({ version: z.literal(1), draft: z.string().max(6000), kind: z.enum(['publication', 'announcement']), posts: z.array(postSchema) });
export type FeedPost = z.infer<typeof postSchema>;
export type FeedState = z.infer<typeof feedSchema>;
export type FeedAuthor = z.infer<typeof authorSchema>;
export const emptyFeed = (): FeedState => ({ version: 1, draft: '', kind: 'publication', posts: [] });
export function feedStorageKey(userId: string, organizationId: string) {
  return `senvia:workplace:feed:v1:${encodeURIComponent(userId)}:${encodeURIComponent(organizationId)}`;
}
export function readFeed(storage: Pick<Storage, 'getItem'>, key: string): FeedState {
  const raw = storage.getItem(key);
  if (!raw) return emptyFeed();
  const parsed = feedSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error('Os dados existentes foram preservados: formato local inválido.');
  return parsed.data;
}
export function writeFeed(storage: Pick<Storage, 'setItem'>, key: string, state: FeedState) {
  storage.setItem(key, JSON.stringify(state));
}
