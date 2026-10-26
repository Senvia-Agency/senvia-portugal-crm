import { supabase } from '@/integrations/supabase/client';
export const postColumns = 'id,organization_id,author_id,body,kind,pinned,recipient_id,recognition_type,attachments,created_at,updated_at';
export const commentColumns = 'id,organization_id,post_id,author_id,body,created_at';
export const reactionColumns = 'organization_id,post_id,user_id,emoji,created_at';
export interface FeedScope { organizationId: string; userId: string }
export type PublicationInput =
  | { id: string; body: string; kind: 'publication' | 'announcement' }
  | { id: string; body: string; kind: 'recognition'; recipientId: string; recognitionType: string };
export interface CommentInput { id: string; postId: string; body: string }
interface StoredPost { author_id: string; body: string; kind: string; recipient_id: string | null; recognition_type: string | null }
const samePost = (row: StoredPost, scope: FeedScope, input: PublicationInput) =>
  row.author_id === scope.userId && row.body === input.body && row.kind === input.kind
  && row.recipient_id === (input.kind === 'recognition' ? input.recipientId : null)
  && row.recognition_type === (input.kind === 'recognition' ? input.recognitionType : null);
export async function publishPost(scope: FeedScope, input: PublicationInput) {
  const find = () => supabase.from('workplace_posts').select(postColumns).eq('organization_id', scope.organizationId).eq('id', input.id).maybeSingle();
  const existing = await find();
  if (existing.error) throw existing.error;
  if (existing.data) {
    if (!samePost(existing.data, scope, input)) throw new Error('Esta tentativa corresponde a outra publicação. Não foi criado um duplicado.');
    return existing.data;
  }
  const recognition = input.kind === 'recognition' ? { recipient_id: input.recipientId, recognition_type: input.recognitionType } : { recipient_id: null, recognition_type: null };
  const result = await supabase.from('workplace_posts').insert({ id: input.id, organization_id: scope.organizationId, author_id: scope.userId, body: input.body, kind: input.kind, pinned: input.kind === 'announcement', ...recognition }).select(postColumns).single();
  if (!result.error) return result.data;
  const confirmed = await find();
  if (confirmed.data && samePost(confirmed.data, scope, input)) return confirmed.data;
  throw result.error;
}
export async function publishComment(scope: FeedScope, input: CommentInput) {
  const find = () => supabase.from('workplace_comments').select(commentColumns).eq('organization_id', scope.organizationId).eq('id', input.id).maybeSingle();
  const existing = await find();
  if (existing.error) throw existing.error;
  if (existing.data) {
    if (existing.data.author_id !== scope.userId || existing.data.body !== input.body || existing.data.post_id !== input.postId) throw new Error('Esta tentativa corresponde a outro comentário. Não foi criado um duplicado.');
    return existing.data;
  }
  const result = await supabase.from('workplace_comments').insert({ id: input.id, organization_id: scope.organizationId, post_id: input.postId, author_id: scope.userId, body: input.body }).select(commentColumns).single();
  if (!result.error) return result.data;
  const confirmed = await find();
  if (confirmed.data?.author_id === scope.userId && confirmed.data.body === input.body && confirmed.data.post_id === input.postId) return confirmed.data;
  throw result.error;
}
export async function setReaction(scope: FeedScope, postId: string, emoji: string, on: boolean) {
  const find = () => supabase.from('workplace_reactions').select(reactionColumns).eq('organization_id', scope.organizationId).eq('post_id', postId).eq('user_id', scope.userId).eq('emoji', emoji).maybeSingle();
  const existing = await find();
  if (existing.error) throw existing.error;
  if (!!existing.data === on) return;
  const result = on
    ? await supabase.from('workplace_reactions').insert({ organization_id: scope.organizationId, post_id: postId, user_id: scope.userId, emoji }).select(reactionColumns).single()
    : await supabase.from('workplace_reactions').delete().eq('organization_id', scope.organizationId).eq('post_id', postId).eq('user_id', scope.userId).eq('emoji', emoji).select(reactionColumns);
  if (!result.error) return;
  const confirmed = await find();
  if (!confirmed.error && !!confirmed.data === on) return;
  throw result.error;
}
export async function setPinned(scope: FeedScope, postId: string, pinned: boolean) {
  const result = await supabase.from('workplace_posts').update({ pinned }).eq('organization_id', scope.organizationId).eq('id', postId).select(postColumns).single();
  if (result.error) throw result.error;
  return result.data;
}
