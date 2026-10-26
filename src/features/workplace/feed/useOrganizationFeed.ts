import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useProfileNames } from '@/hooks/useTeam';
import type { FeedEntry, FeedKind } from './feed-model';
import { isReactionEmoji, isRecognitionKey } from './recognition-types';
import { parseAttachments } from './feed-files';
import { readOrganizationFeed } from './feed-queries';
import { publishPost, publishComment, setReaction, setPinned, type FeedScope, type PublicationInput, type CommentInput } from './feed-actions';
// Database guards raise stable codes; people get the reason in plain Portuguese.
const knownErrors: readonly (readonly [RegExp, string])[] = [
  [/workplace_recognition_daily_limit/, 'Já fez 3 reconhecimentos nas últimas 24 horas. Tente novamente amanhã.'],
  [/workplace_recognition_recipient_limit/, 'Já reconheceu esta pessoa nas últimas 24 horas.'],
  [/recipient must be an active organization member/, 'Esta pessoa já não é membro ativo da organização.'],
  [/column .*(recipient_id|recognition_type|emoji).* does not exist/, 'Falta aplicar a migration 20261026120000_workplace_recognitions_emoji_reactions.sql no Supabase.'],
  [/column .*attachments.* does not exist|Bucket not found/, 'Falta aplicar a migration 20261026170000_workplace_feed_attachments.sql no Supabase.'],
  [/workplace_feed_invalid_attachment|workplace_posts_attachments_check/,'Anexo recusado pela base de dados: confirme o tipo e o tamanho do ficheiro.'],
];
export function describeFeedError(error: unknown) {
  const parsed = z.object({ message: z.string() }).safeParse(error);
  const message = error instanceof Error ? error.message : parsed.success ? parsed.data.message : 'Erro desconhecido';
  return knownErrors.find(([pattern]) => pattern.test(message))?.[1] ?? message;
}
const feedKinds: readonly FeedKind[] = ['publication', 'announcement', 'recognition'];
export function useOrganizationFeed(scope: FeedScope) {
  const client = useQueryClient();
  const queryKey = ['workplace-feed', scope.organizationId, scope.userId];
  const query = useQuery({
    queryKey,
    queryFn: () => readOrganizationFeed(scope.organizationId),
    refetchOnWindowFocus: true,
  });
  const names = useProfileNames([
    ...(query.data?.posts.flatMap(post => [post.author_id, post.recipient_id]) ?? []),
    ...(query.data?.comments.map(comment => comment.author_id) ?? []),
    ...(query.data?.reactions.map(reaction => reaction.user_id) ?? []),
  ]);
  const nameFor = (id: string) => names.data?.[id] || 'Membro da equipa';
  const posts: FeedEntry[] = (query.data?.posts ?? []).map(post => {
    const stored = feedKinds.find(value => value === post.kind) ?? 'publication';
    const recipientId = post.recipient_id;
    const type = isRecognitionKey(post.recognition_type) ? post.recognition_type : null;
    // A recognition missing its recipient or type still shows, as a plain publication.
    const kind = stored === 'recognition' && !(recipientId && type) ? 'publication' : stored;
    return {
      id: post.id, author: { id: post.author_id, name: nameFor(post.author_id) },
      text: post.body, kind, pinned: post.pinned,
      createdAt: post.created_at,
      reactions: (query.data?.reactions ?? []).filter(item => item.post_id === post.id).flatMap(item => isReactionEmoji(item.emoji) ? [{ userId: item.user_id, emoji: item.emoji }] : []),
      comments: (query.data?.comments ?? []).filter(item => item.post_id === post.id).map(item => ({ id: item.id, text: item.body, createdAt: item.created_at, author: { id: item.author_id, name: nameFor(item.author_id) } })),
      recipient: kind === 'recognition' && recipientId ? { id: recipientId, name: nameFor(recipientId) } : null,
      recognitionType: kind === 'recognition' ? type : null,
      attachments: parseAttachments(post.attachments),
    };
  });
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
  const reaction = useMutation({ mutationFn: ({ postId, emoji, on }: { postId: string; emoji: string; on: boolean }) => setReaction(scope, postId, emoji, on), onSuccess: invalidate });
  const pin = useMutation({ mutationFn: ({ postId, pinned }: { postId: string; pinned: boolean }) => setPinned(scope, postId, pinned), onSuccess: invalidate });
  return { posts, query, publication, comment, reaction, pin, nameFor };
}
