import { supabase } from '@/integrations/supabase/client';
export const postColumns = 'id,organization_id,author_id,body,kind,pinned,created_at,updated_at';
export const commentColumns = 'id,organization_id,post_id,author_id,body,created_at';
export const reactionColumns = 'organization_id,post_id,user_id,created_at';
export interface FeedScope { organizationId: string; userId: string }
export interface PublicationInput { id: string; body: string; kind: 'publication' | 'announcement' }
export interface CommentInput { id: string; postId: string; body: string }
export async function publishPost(scope: FeedScope, input: PublicationInput) {
  const find = () => supabase.from('workplace_posts').select(postColumns).eq('organization_id', scope.organizationId).eq('id', input.id).maybeSingle();
  const existing = await find();
  if (existing.error) throw existing.error;
  if (existing.data) {
    if (existing.data.author_id !== scope.userId || existing.data.body !== input.body || existing.data.kind !== input.kind) throw new Error('Esta tentativa corresponde a outra publicação. Não foi criado um duplicado.');
    return existing.data;
  }
  const result = await supabase.from('workplace_posts').insert({ id: input.id, organization_id: scope.organizationId, author_id: scope.userId, body: input.body, kind: input.kind, pinned: input.kind === 'announcement' }).select(postColumns).single();
  if (!result.error) return result.data;
  const confirmed = await find();
  if (confirmed.data?.author_id === scope.userId && confirmed.data.body === input.body && confirmed.data.kind === input.kind) return confirmed.data;
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
export async function setReaction(scope: FeedScope, postId: string, liked: boolean) {
  const find = () => supabase.from('workplace_reactions').select(reactionColumns).eq('organization_id', scope.organizationId).eq('post_id', postId).eq('user_id', scope.userId).maybeSingle();
  const existing = await find();
  if (existing.error) throw existing.error;
  if (!!existing.data === liked) return;
  const result = liked
    ? await supabase.from('workplace_reactions').insert({ organization_id: scope.organizationId, post_id: postId, user_id: scope.userId }).select(reactionColumns).single()
    : await supabase.from('workplace_reactions').delete().eq('organization_id', scope.organizationId).eq('post_id', postId).eq('user_id', scope.userId).select(reactionColumns);
  if (!result.error) return;
  const confirmed = await find();
  if (!confirmed.error && !!confirmed.data === liked) return;
  throw result.error;
}
export async function setPinned(scope: FeedScope, postId: string, pinned: boolean) {
  const result = await supabase.from('workplace_posts').update({ pinned }).eq('organization_id', scope.organizationId).eq('id', postId).select(postColumns).single();
  if (result.error) throw result.error;
  return result.data;
}
