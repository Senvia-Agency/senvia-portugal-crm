import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { ArrowRight, Award, ImagePlus, Paperclip, UsersRound, Loader2, Megaphone, MessageSquareText, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamMembers } from '@/hooks/useTeam';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FeedAvatar, FeedPostCard } from '@/features/workplace/feed/FeedPostCard';
import { feedStorageKey, type FeedAuthor, type FeedState } from '@/features/workplace/feed/feed-storage';
import { useOrganizationFeed, describeFeedError } from '@/features/workplace/feed/useOrganizationFeed';
import { useFeedIntent } from '@/features/workplace/feed/useFeedIntent';
import { useLocalFeed } from '@/features/workplace/feed/useLocalFeed';
import { RecognitionDialog } from '@/features/workplace/feed/RecognitionDialog';
import { ComposerFiles } from '@/features/workplace/feed/ComposerFiles';
import { MAX_POST_FILES, POST_DOCUMENT_TYPES, POST_IMAGE_TYPES, acceptPostFiles, attachFilesToPost, parseAttachments } from '@/features/workplace/feed/feed-files';
import '@/features/workplace/feed/feed.css';

type FeedFilter = 'all' | 'publication' | 'announcement' | 'recognition';
export default function WorkplaceFeed() {
  const { user, profile, organization, roles, isSuperAdmin } = useAuth();
  if (!user || !organization) return <p className="p-6 text-muted-foreground">Selecione uma organização para abrir o Feed.</p>;
  return <FeedWorkspace key={`${user.id}:${organization.id}`} avatarUrl={profile?.avatar_url} organizationId={organization.id} storageKey={feedStorageKey(user.id, organization.id)} author={{ id: user.id, name: profile?.full_name || 'Utilizador' }} organizationName={organization.name} canAnnounce={isSuperAdmin || roles.includes('admin')} />;
}
function FeedWorkspace({ storageKey, author, organizationName, organizationId, canAnnounce, avatarUrl }: { avatarUrl?: string | null; organizationId: string; storageKey: string; author: FeedAuthor; organizationName: string; canAnnounce: boolean }) {
  const { state, save, error, blocked } = useLocalFeed(storageKey);
  const feed = useOrganizationFeed({ organizationId, userId: author.id });
  const intent = useFeedIntent(`${storageKey}:publish-intent`);
  const [publishError, setPublishError] = useState('');
  const draftText = intent.pending?.body ?? state.draft;
  const draftKind = intent.pending?.kind ?? state.kind;
  const unavailable = blocked || feed.query.isPending || feed.query.isError || !!intent.error;
  const publishing = feed.publication.isPending;
  const { data: members = [] } = useTeamMembers();
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [query, setQuery] = useState('');
  const [recognizing, setRecognizing] = useState(false);
  // Photos and documents for the next publication (kept in memory: browsers cannot store files as drafts).
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  const filesLocked = blocked || publishing || !!intent.error;
  function addFiles(incoming: File[]) {
    if (incoming.length === 0 || filesLocked) return;
    const result = acceptPostFiles(files, incoming);
    setFiles(result.files);
    if (result.error) toast.error('Alguns ficheiros não foram adicionados', { description: result.error });
  }
  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault(); setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  };
  const posts = feed.posts.filter(post => (filter === 'all' || post.kind === filter) && `${post.text} ${post.author.name} ${post.recipient?.name ?? ''}`.toLocaleLowerCase('pt').includes(query.toLocaleLowerCase('pt'))).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
  async function publish() {
    if (!draftText.trim() || unavailable || publishing) return;
    setPublishError('');
    try {
      const attempt = intent.prepare(draftText.trim(), canAnnounce && draftKind === 'announcement' ? 'announcement' : 'publication');
      if (attempt.kind === 'comment') throw new Error('Tentativa de publicação inválida.');
      const post = await feed.publication.mutateAsync({ id: attempt.id, body: attempt.body, kind: attempt.kind });
      // A retried attempt finds the post already there: files are only added once.
      if (files.length > 0 && parseAttachments(post.attachments).length === 0) await attachFilesToPost(post.id, files, []);
      if (save({ ...state, draft: '' })) intent.clear();
      setFiles([]);
      void feed.query.refetch();
    } catch (error) {
      setPublishError('Publicação não confirmada. O texto foi preservado. Tente novamente sem duplicar: ' + describeFeedError(error));
    }
  }
  function setKind(kind: FeedState['kind']) { save({ ...state, kind }, true); }
  const announcements = feed.posts.filter(post => post.kind === 'announcement');
  const receivedRecognitions = feed.posts.filter(post => post.kind === 'recognition' && post.recipient?.id === author.id).length;
  const avatarFor = (id: string) => id === author.id ? avatarUrl : members.find(member => member.user_id === id)?.avatar_url;
  return <div className="workplace-feed"><div className="workplace-feed-grid">
    <div className="workplace-feed-main">
      <header className="feed-page-heading"><h1>Feed</h1><label className="feed-search"><Search aria-hidden="true" /><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Pesquisar no Feed" aria-label="Pesquisar no Feed" /></label></header>
      {(error || publishError || intent.error) && <div role="alert" className="feed-error">{error || publishError || intent.error}</div>}
      <section aria-label="Criar publicação" className="feed-paper feed-composer" data-dragging={dragging}
        onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }}
        onDragLeave={event => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={onDrop}>
        <div className="feed-composer-body"><FeedAvatar name={author.name} avatarUrl={avatarUrl} /><Textarea aria-label="Texto da publicação" placeholder={`Partilhe uma novidade, ${author.name.split(' ')[0]}…`} value={draftText} disabled={blocked || publishing || !!intent.pending || !!intent.error} maxLength={6000} onChange={event => save({ ...state, draft: event.target.value }, true)}
          onPaste={event => { const pasted = Array.from(event.clipboardData.files); if (pasted.length) { event.preventDefault(); addFiles(pasted); } }} /></div>
        <ComposerFiles files={files} disabled={filesLocked} onRemove={index => setFiles(current => current.filter((_, at) => at !== index))} />
        <input ref={photoInput} type="file" multiple hidden accept={POST_IMAGE_TYPES.join(',')} onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
        <input ref={documentInput} type="file" multiple hidden accept={POST_DOCUMENT_TYPES.join(',')} onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
        <div className="feed-composer-footer">
          <div className="feed-composer-types"><Button size="sm" variant="ghost" className="feed-attach" disabled={filesLocked || files.length >= MAX_POST_FILES} onClick={() => photoInput.current?.click()}><ImagePlus />Fotografia</Button><Button size="sm" variant="ghost" className="feed-attach" disabled={filesLocked || files.length >= MAX_POST_FILES} onClick={() => documentInput.current?.click()}><Paperclip />Documento</Button><Button size="sm" variant="ghost" aria-pressed={draftKind === 'publication'} disabled={blocked || publishing || !!intent.pending} onClick={() => setKind('publication')}><MessageSquareText />Publicação</Button>{canAnnounce && <Button size="sm" variant="ghost" aria-pressed={draftKind === 'announcement'} disabled={blocked || publishing || !!intent.pending} onClick={() => setKind('announcement')}><Megaphone />Comunicado</Button>}<Button size="sm" variant="ghost" className="feed-recognize" disabled={unavailable} onClick={() => setRecognizing(true)}><Award />Reconhecer</Button></div>
          <span className="feed-audience" title={organizationName}><UsersRound aria-hidden="true" />Toda a organização</span>
          <Button className="feed-publish" disabled={unavailable || publishing || !draftText.trim()} onClick={() => void publish()}>{publishing && <Loader2 className="animate-spin" />}{intent.pending ? 'Confirmar publicação' : 'Publicar'}</Button>
        </div>
        {(!!draftText || !!intent.pending) && <p className="feed-draft-note">{draftText.length}/6000 · {error ? 'Não guardado' : 'Rascunho privado guardado neste navegador'}{intent.pending && ' · Confirme esta tentativa antes de iniciar outra; não será duplicada.'}</p>}
      </section>
      <div className="feed-filter-row" aria-label="Filtrar publicações">{([{ id: 'all', label: 'Tudo' }, { id: 'announcement', label: 'Comunicados' }, { id: 'publication', label: 'Publicações' }, { id: 'recognition', label: 'Reconhecimentos' }] satisfies { id: FeedFilter; label: string }[]).map(item => <button type="button" key={item.id} className="feed-filter" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
      <section aria-label="Publicações" className="feed-timeline">
        {feed.query.isPending ? <p role="status" className="feed-paper feed-empty">A carregar publicações da equipa…</p> : feed.query.isError ? <div role="alert" className="feed-paper feed-empty"><p className="text-destructive">Não foi possível carregar o Feed. {describeFeedError(feed.query.error)}</p><Button variant="outline" className="mt-4" onClick={() => void feed.query.refetch()}>Tentar novamente</Button></div> : posts.length ? posts.map(post => <FeedPostCard avatarUrl={avatarFor(post.author.id)} avatarFor={avatarFor} nameFor={feed.nameFor} storageKey={storageKey} key={post.id} post={post} author={author} canPin={canAnnounce} disabled={feed.query.isError} onReact={(postId, emoji, on) => feed.reaction.mutateAsync({ postId, emoji, on })} onPin={(postId, pinned) => feed.pin.mutateAsync({ postId, pinned })} onComment={(postId, id, body) => feed.comment.mutateAsync({ postId, id, body })} />) : <div className="feed-paper feed-empty"><span className="feed-empty-icon"><MessageSquareText /></span><h2>{feed.posts.length ? 'Sem resultados para este filtro' : 'A primeira novidade pode ser sua'}</h2><p>{feed.posts.length ? 'Experimente outra pesquisa ou veja todas as publicações.' : 'Partilhe uma ideia, uma conquista ou uma atualização com a equipa. O trabalho também acontece nas conversas.'}</p></div>}
      </section>
    </div>
    <aside className="feed-rail" aria-label="A sua organização">
      <section className="feed-paper feed-rail-card"><div className="feed-rail-title"><Award className="text-primary" /><h2>Reconhecimentos</h2>{receivedRecognitions > 0 && <span className="feed-count" title="Recebidos por si">{receivedRecognitions}</span>}</div><p>{receivedRecognitions > 0 ? `Recebeu ${receivedRecognitions} ${receivedRecognitions === 1 ? 'reconhecimento' : 'reconhecimentos'} da equipa.` : 'Valorize o trabalho de um colega à frente de toda a equipa.'}</p><Button variant="outline" className="mt-3 w-full" disabled={unavailable} onClick={() => setRecognizing(true)}><Award className="mr-2 h-4 w-4" />Reconhecer alguém</Button></section>
      <section className="feed-paper feed-rail-card"><div className="feed-rail-title"><Megaphone className="text-warning" /><h2>Comunicados</h2>{!feed.query.isPending && !feed.query.isError && <span className="feed-count">{announcements.length}</span>}</div>{feed.query.isPending ? <p>A carregar comunicados…</p> : feed.query.isError ? <p>Os comunicados estão temporariamente indisponíveis.</p> : announcements.length ? <><div className="feed-notices">{announcements.slice(0, 3).map(post => <button type="button" key={post.id} onClick={() => setFilter('announcement')}><span>{post.text}</span><small>{post.pinned ? 'Fixado · ' : ''}{post.author.name}</small></button>)}</div><button type="button" className="feed-text-link" onClick={() => setFilter('announcement')}>Ver comunicados<ArrowRight /></button></> : <p>Sem comunicados de momento.</p>}</section>
    </aside>
  </div>
    <RecognitionDialog open={recognizing} onOpenChange={setRecognizing} members={members} selfId={author.id} selfName={author.name} describeError={describeFeedError}
      onSubmit={input => feed.publication.mutateAsync({ id: input.id, body: input.body, kind: 'recognition', recipientId: input.recipientId, recognitionType: input.recognitionType })} />
  </div>;
}
