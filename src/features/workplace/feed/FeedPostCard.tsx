import { useState } from 'react';
import { Heart, MessageCircle, Pin, Send, Megaphone, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { useCommentDraft } from './useCommentDraft';
import { useFeedIntent } from './useFeedIntent';
import { describeFeedError } from './useOrganizationFeed';
import type { FeedAuthor, FeedPost } from './feed-storage';
export function FeedAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  return <Avatar className="feed-avatar"><AvatarImage src={avatarUrl || undefined} alt={name} /><AvatarFallback>{name.split(' ').slice(0, 2).map(part => part[0]).join('').toUpperCase()}</AvatarFallback></Avatar>;
}
const dateLabel = (value: string) => new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
interface FeedPostCardProps {
  avatarUrl?: string | null; avatarFor: (id: string) => string | null | undefined; storageKey: string; post: FeedPost; author: FeedAuthor; canPin: boolean; disabled: boolean;
  onReact: (postId: string, liked: boolean) => Promise<unknown>;
  onPin: (postId: string, pinned: boolean) => Promise<unknown>;
  onComment: (postId: string, id: string, body: string) => Promise<unknown>;
}
export function FeedPostCard({ post, author, canPin, storageKey, disabled, onReact, onPin, onComment, avatarUrl, avatarFor }: FeedPostCardProps) {
  const draft = useCommentDraft(storageKey, post.id);
  const intent = useFeedIntent(`${storageKey}:comment-intent:${post.id}`);
  const [expanded, setExpanded] = useState(!!draft.text || !!draft.error || !!intent.pending);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const comment = intent.pending?.body ?? draft.text;
  const liked = post.reactions.includes(author.id);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); }
    catch (error) { setError(`Ação não confirmada : ${describeFeedError(error)}. Tente novamente; o texto foi preservado.`); }
    finally { setBusy(false); }
  }
  async function addComment() {
    if (!comment.trim() || draft.blocked || intent.error) return;
    await run(async () => {
      const attempt = intent.prepare(comment.trim(), 'comment');
      await onComment(post.id, attempt.id, attempt.body);
      if (draft.published()) intent.clear();
    });
  }
  const locked = busy || disabled;
  return <article className="feed-paper feed-post">
    <header className="feed-post-header"><FeedAvatar name={post.author.name} avatarUrl={avatarUrl} />
      <div className="min-w-0 flex-1"><p className="break-words font-semibold">{post.author.name}</p><p className="text-xs text-muted-foreground"><time dateTime={post.createdAt}>{dateLabel(post.createdAt)}</time> · Equipa</p></div>
      {canPin && post.kind === 'announcement' && <Button disabled={locked} variant="ghost" size="icon" aria-label={post.pinned ? 'Desafixar comunicado' : 'Fixar comunicado'} aria-pressed={post.pinned} onClick={() => void run(() => onPin(post.id, !post.pinned))}><Pin className="h-4 w-4" /></Button>}
    </header>
    {post.kind === 'announcement' && <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-warning/10 px-3 py-1 text-xs font-semibold"><Megaphone className="h-3.5 w-3.5" />{post.pinned ? 'Comunicado fixado' : 'Comunicado'}</p>}
    <p className="feed-post-text">{post.text}</p>
    {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
    <div className="feed-post-actions">
      <Button disabled={locked} variant={liked ? 'secondary' : 'ghost'} size="sm" aria-pressed={liked} onClick={() => void run(() => onReact(post.id, !liked))}><Heart className={`mr-2 h-4 w-4 ${liked ? 'fill-current' : ''}`} />Gostar{post.reactions.length > 0 ? ` · ${post.reactions.length}` : ''}</Button>
      <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><MessageCircle className="mr-2 h-4 w-4" />Comentar{post.comments.length > 0 ? ` · ${post.comments.length}` : ''}</Button>
    </div>
    {expanded && <section aria-label="Comentários" className="feed-comments">
      {(draft.error || intent.error) && <p role="alert" className="text-sm text-destructive">{draft.error || intent.error}</p>}
      {post.comments.map(item => <div key={item.id} className="feed-comment"><FeedAvatar name={item.author.name} avatarUrl={avatarFor(item.author.id)} /><div><p className="text-sm font-semibold">{item.author.name}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{item.text}</p><time className="mt-2 block text-xs text-muted-foreground" dateTime={item.createdAt}>{dateLabel(item.createdAt)}</time></div></div>)}
      {intent.pending && <p className="text-xs text-muted-foreground">Confirme novamente esta tentativa antes de escrever outro comentário. Não será duplicado.</p>}
      <form className="flex items-end gap-2" onSubmit={event => { event.preventDefault(); void addComment(); }}><Textarea aria-label="Escrever comentário" placeholder="Acrescentar um comentário…" value={comment} disabled={locked || draft.blocked || !!intent.pending || !!intent.error} maxLength={2000} onChange={event => draft.change(event.target.value)} /><Button type="submit" size="icon" disabled={locked || draft.blocked || !!intent.error || !comment.trim()} aria-label="Publicar comentário">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button></form>
    </section>}
  </article>;
}
