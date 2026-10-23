import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useProfileNames } from '@/hooks/useTeam';
import type { FeedPost } from './feed-storage';
import { readOrganizationFeed } from './feed-queries';
import { publishPost, publishComment, setReaction, setPinned, type FeedScope, type PublicationInput, type CommentInput } from './feed-actions';
export function describeFeedError(error: unknown) {
  if (error instanceof Error) return error.message;
  const parsed = z.object({ message: z.string() }).safeParse(error);
  if (parsed.success) return parsed.data.message;
  throw error;
}
export function useOrganizationFeed(scope: FeedScope) {
  const client = useQueryClient();
  const queryKey = ['workplace-feed', scope.organizationId, scope.userId];
  const query = useQuery({
    queryKey,
    queryFn: () => readOrganizationFeed(scope.organizationId),
    refetchOnWindowFocus: true,
  });
  const names = useProfileNames([...(query.data?.posts.map(post => post.author_id) ?? []), ...(query.data?.comments.map(comment => comment.author_id) ?? [])]);
  const posts: FeedPost[] = (query.data?.posts ?? []).map(post => ({
    id: post.id, author: { id: post.author_id, name: names.data?.[post.author_id] || 'Membro da equipa' },
    text: post.body, kind: post.kind === 'announcement' ? 'announcement' : 'publication', pinned: post.pinned,
    createdAt: post.created_at,
    reactions: (query.data?.reactions ?? []).filter(item => item.post_id === post.id).map(item => item.user_id),
    comments: (query.data?.comments ?? []).filter(item => item.post_id === post.id).map(item => ({ id: item.id, text: item.body, createdAt: item.created_at, author: { id: item.author_id, name: names.data?.[item.author_id] || 'Membro da equipa' } })),
  }));
  const invalidate = () => client.invalidateQueries({ queryKey: ['workplace-feed', scope.organizationId, scope.userId] });
  useEffect(() => {
    const refresh = () => { void client.invalidateQueries({ queryKey: ['workplace-feed', scope.organizationId, scope.userId] }); };
    const channel = supabase.channel(`workplace-feed:${scope.organizationId}:${scope.userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workplace_posts', filter: `organization_id=eq.${scope.organizationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workplace_comments', filter: `organization_id=eq.${scope.organizationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workplace_reactions', filter: `organization_id=eq.${scope.organizationId}` }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [client, scope.organizationId, scope.userId]);
  const publication = useMutation({ mutationFn: (input: PublicationInput) => publishPost(scope, input), onSuccess: invalidate });
  const comment = useMutation({ mutationFn: (input: CommentInput) => publishComment(scope, input), onSuccess: invalidate });
  const reaction = useMutation({ mutationFn: ({ postId, liked }: { postId: string; liked: boolean }) => setReaction(scope, postId, liked), onSuccess: invalidate });
  const pin = useMutation({ mutationFn: ({ postId, pinned }: { postId: string; pinned: boolean }) => setPinned(scope, postId, pinned), onSuccess: invalidate });
  return { posts, query, publication, comment, reaction, pin };
}
