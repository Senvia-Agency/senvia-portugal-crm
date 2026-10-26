import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { pt } from 'date-fns/locale';
import { MessageCircle, Pin, Send, Megaphone, Loader2, UsersRound, SmilePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useCommentDraft } from './useCommentDraft';
import { useFeedIntent } from './useFeedIntent';
import { describeFeedError } from './useOrganizationFeed';
import { reactionEmojis, recognitionType, type ReactionEmoji } from './recognition-types';
import type { FeedAuthor } from './feed-storage';
import type { FeedEntry } from './feed-model';
import { PostAttachments } from './PostAttachments';
// A stable hue per person gives initials-only avatars their own colour.
const avatarHue = (name: string) => [...name].reduce((hue, character) => (hue * 31 + character.charCodeAt(0)) % 360, 0);
export function FeedAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  return <Avatar className="feed-avatar" style={{ '--feed-avatar-hue': avatarHue(name) } as CSSProperties}><AvatarImage src={avatarUrl || undefined} alt={name} /><AvatarFallback>{name.split(' ').slice(0, 2).map(part => part[0]).join('').toUpperCase()}</AvatarFallback></Avatar>;
}
/** Gradient colours for a dimensional tile, as HSL channels; descendants read them as CSS variables. */
export const tileStyle = (tile: readonly [string, string]) => ({ '--tile-start': tile[0], '--tile-end': tile[1] }) as CSSProperties;
/** Dimensional tile for announcements and recognition types. */
export function FeedKindTile({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('feed-kind-tile', className)} aria-hidden="true">{children}</span>;
}
const dateLabel = (value: string) => new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
function PostTime({ value }: { value: string }) {
  const date = new Date(value);
  return <time dateTime={value} title={dateLabel(value)}>{Date.now() - date.getTime() < 60_000 ? 'agora' : formatDistanceToNowStrict(date, { locale: pt, addSuffix: true })}</time>;
}
const recognitionOf = (post: FeedEntry) => post.kind === 'recognition' && post.recognitionType ? recognitionType(post.recognitionType) : null;
/** Article frame for a post: story cards (announcements, recognitions) take their tile colours. */
export function feedPostFrame(post: FeedEntry) {
  const type = recognitionOf(post);
  const story = post.kind === 'announcement' || !!type;
  return { className: cn('feed-paper feed-post', story && 'feed-post--story', type && 'feed-post--recognition'), style: type ? tileStyle(type.tile) : undefined };
}
/** Header, text and meta of a post, as `viewerId` reads it. Shared by the Feed card and the recognition preview. */
export function FeedPostContent({ post, viewerId, avatarUrl, pin }: { post: FeedEntry; viewerId: string; avatarUrl?: string | null; pin?: ReactNode }) {
  const type = recognitionOf(post);
  const story = post.kind === 'announcement' || !!type;
  const audience = <span className="inline-flex items-center gap-1"><UsersRound aria-hidden="true" />Toda a organização</span>;
  const meta = <p className="feed-post-meta"><PostTime value={post.createdAt} /><span aria-hidden="true">·</span>{audience}</p>;
  let header: ReactNode;
  if (type && post.recipient) {
    const TypeIcon = type.icon;
    const sender = <strong>{post.author.name}</strong>;
    const recipient = <strong>{post.recipient.name}</strong>;
    header = <header className="feed-post-header">
      <FeedKindTile><TypeIcon /></FeedKindTile>
      <div className="min-w-0 flex-1">
        <p className="feed-post-headline">{post.author.id === viewerId ? <>Reconheceu o trabalho de {recipient}</> : post.recipient.id === viewerId ? <>{sender} reconheceu o seu trabalho</> : <>{sender} reconheceu {recipient}</>}</p>
        <p className="feed-post-kind">{type.label}</p>
      </div>
    </header>;
  } else if (post.kind === 'announcement') {
    header = <header className="feed-post-header">
      <FeedKindTile><Megaphone /></FeedKindTile>
      <div className="min-w-0 flex-1">
        <p className="feed-post-headline"><strong>{post.author.name}</strong> partilhou um comunicado</p>
        <p className="feed-post-kind">{post.pinned && <Pin aria-hidden="true" />}{post.pinned ? 'Comunicado fixado' : 'Comunicado'}</p>
      </div>
      {pin}
    </header>;
  } else {
    header = <header className="feed-post-header"><FeedAvatar name={post.author.name} avatarUrl={avatarUrl} />
      <div className="min-w-0 flex-1"><p className="feed-post-author">{post.author.name}</p>{meta}</div>
    </header>;
  }
  return <>
    {header}
    <p className={cn('feed-post-text', story && 'feed-post-quote')}>{type ? `“${post.text}”` : post.text}</p>
    <PostAttachments attachments={post.attachments} />
    {story && meta}
  </>;
}
interface FeedPostCardProps {
  avatarUrl?: string | null; avatarFor: (id: string) => string | null | undefined; nameFor: (id: string) => string;
  storageKey: string; post: FeedEntry; author: FeedAuthor; canPin: boolean; disabled: boolean;
  onReact: (postId: string, emoji: ReactionEmoji, on: boolean) => Promise<unknown>;
  onPin: (postId: string, pinned: boolean) => Promise<unknown>;
  onComment: (postId: string, id: string, body: string) => Promise<unknown>;
}
export function FeedPostCard({ post, author, canPin, storageKey, disabled, onReact, onPin, onComment, avatarUrl, avatarFor, nameFor }: FeedPostCardProps) {
  const draft = useCommentDraft(storageKey, post.id);
  const intent = useFeedIntent(`${storageKey}:comment-intent:${post.id}`);
  const [expanded, setExpanded] = useState(!!draft.text || !!draft.error || !!intent.pending);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const comment = intent.pending?.body ?? draft.text;
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
  const reactions = reactionEmojis.map(emoji => ({ emoji, people: post.reactions.filter(item => item.emoji === emoji).map(item => item.userId) })).filter(group => group.people.length > 0);
  const mine = (emoji: ReactionEmoji) => post.reactions.some(item => item.emoji === emoji && item.userId === author.id);
  const react = (emoji: ReactionEmoji) => { setPickerOpen(false); void run(() => onReact(post.id, emoji, !mine(emoji))); };
  const pin = canPin && post.kind === 'announcement' && <Button disabled={locked} variant="ghost" size="icon" aria-label={post.pinned ? 'Desafixar comunicado' : 'Fixar comunicado'} aria-pressed={post.pinned} onClick={() => void run(() => onPin(post.id, !post.pinned))}><Pin className="h-4 w-4" /></Button>;
  return <article {...feedPostFrame(post)}>
    <FeedPostContent post={post} viewerId={author.id} avatarUrl={avatarUrl} pin={pin} />
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <footer className="feed-post-actions">
      {reactions.map(group => <button key={group.emoji} type="button" className="feed-chip feed-reaction" disabled={locked} aria-pressed={mine(group.emoji)}
        title={group.people.map(nameFor).join(', ')} aria-label={`${group.emoji} ${group.people.length}, ${mine(group.emoji) ? 'retirar a sua reação' : 'reagir também'}`}
        onClick={() => react(group.emoji)}><span aria-hidden="true" className="feed-emoji">{group.emoji}</span>{group.people.length}</button>)}
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild><button type="button" className="feed-chip feed-reaction-add" disabled={locked} aria-label="Adicionar reação" title="Adicionar reação"><SmilePlus aria-hidden="true" />{reactions.length === 0 && 'Reagir'}</button></PopoverTrigger>
        <PopoverContent side="top" align="start" className="flex w-auto gap-0.5 rounded-full p-1.5" aria-label="Escolher reação">
          {reactionEmojis.map(emoji => <button key={emoji} type="button" aria-pressed={mine(emoji)} aria-label={`Reagir com ${emoji}`} onClick={() => react(emoji)}
            className={cn('flex h-10 w-10 items-center justify-center rounded-full text-[22px] transition-transform hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:hover:scale-100', mine(emoji) && 'bg-primary/10')}>{emoji}</button>)}
        </PopoverContent>
      </Popover>
      {reactions.length > 0 && <Popover>
        <PopoverTrigger asChild><button type="button" className="feed-who">Quem reagiu</button></PopoverTrigger>
        <PopoverContent align="start" className="w-64 space-y-3 p-3">
          {reactions.map(group => <div key={group.emoji} className="flex gap-2 text-sm"><span aria-hidden="true" className="text-lg leading-6">{group.emoji}</span><p className="min-w-0 flex-1 leading-6"><span className="sr-only">{group.emoji}: </span>{group.people.map(id => id === author.id ? 'Eu' : nameFor(id)).join(', ')}</p></div>)}
        </PopoverContent>
      </Popover>}
      <button type="button" className="feed-chip feed-comment-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><MessageCircle aria-hidden="true" />Comentar{post.comments.length > 0 ? ` · ${post.comments.length}` : ''}</button>
    </footer>
    {expanded && <section aria-label="Comentários" className="feed-comments">
      {(draft.error || intent.error) && <p role="alert" className="text-sm text-destructive">{draft.error || intent.error}</p>}
      {post.comments.map(item => <div key={item.id} className="feed-comment"><FeedAvatar name={item.author.name} avatarUrl={avatarFor(item.author.id)} /><div><p className="text-sm font-semibold">{item.author.name}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{item.text}</p><span className="mt-2 block text-xs text-muted-foreground"><PostTime value={item.createdAt} /></span></div></div>)}
      {intent.pending && <p className="text-xs text-muted-foreground">Confirme novamente esta tentativa antes de escrever outro comentário. Não será duplicado.</p>}
      <form className="flex items-end gap-2" onSubmit={event => { event.preventDefault(); void addComment(); }}><Textarea aria-label="Escrever comentário" placeholder="Acrescentar um comentário…" value={comment} disabled={locked || draft.blocked || !!intent.pending || !!intent.error} maxLength={2000} onChange={event => draft.change(event.target.value)} /><Button type="submit" size="icon" disabled={locked || draft.blocked || !!intent.error || !comment.trim()} aria-label="Publicar comentário">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button></form>
    </section>}
  </article>;
}
