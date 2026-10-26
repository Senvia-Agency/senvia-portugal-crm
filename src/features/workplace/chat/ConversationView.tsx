import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, Bell, BellOff, Info, Loader2, MoreVertical, Pin, PinOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { deleteMessage, describeChatError, setReaction, updateSettings } from './chat-api';
import { conversationTitle, dayLabel } from './chat-format';
import type { ChatConversation, ChatMessage } from './chat-model';
import { chatKeys, useChatThread } from './useChat';
import { ConversationAvatar } from './ChatAvatar';
import { MessageBubble, type ReactionGroup } from './MessageBubble';
import { ChatComposer } from './ChatComposer';
import { ForwardDialog } from './ForwardDialog';
import { GroupDetailsDialog } from './GroupDetailsDialog';

interface People {
  readonly nameFor: (id: string | null) => string;
  readonly firstName: (id: string | null) => string;
  readonly avatarFor: (id: string | null) => string | null;
}
interface Props {
  readonly conversation: ChatConversation;
  readonly conversations: readonly ChatConversation[];
  readonly organizationId: string;
  readonly userId: string;
  readonly people: People;
  readonly focusMessageId: string | null;
  readonly onFocused: () => void;
  readonly onBack: () => void;
  readonly onOpen: (conversationId: string) => void;
}

// Messages from the same person within five minutes read as one block.
const SAME_RUN_MS = 5 * 60 * 1000;

export function ConversationView({ conversation, conversations, organizationId, userId, people, focusMessageId, onFocused, onBack, onOpen }: Props) {
  const client = useQueryClient();
  const thread = useChatThread(conversation.id, organizationId, userId);
  const messages = useMemo(() => thread.messages.data?.messages ?? [], [thread.messages.data]);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [deleting, setDeleting] = useState<ChatMessage | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [incoming, setIncoming] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const takeIncoming = useCallback(() => setIncoming([]), []);
  const title = conversationTitle(conversation, people.nameFor);
  const refreshList = () => { void client.invalidateQueries({ queryKey: chatKeys.list(organizationId) }); };
  const refreshThread = () => { void client.invalidateQueries({ queryKey: chatKeys.messages(conversation.id) }); refreshList(); };

  // Scroll: start at the newest message, follow new ones while near the bottom, keep position when loading older.
  const scroller = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const olderAnchor = useRef<number | null>(null);
  const lastId = messages.at(-1)?.id;
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (olderAnchor.current !== null) { element.scrollTop = element.scrollHeight - olderAnchor.current; olderAnchor.current = null; return; }
    if (nearBottom.current || messages.at(-1)?.senderId === userId) element.scrollTop = element.scrollHeight;
  }, [lastId, messages, userId]);
  useEffect(() => { nearBottom.current = true; setReplyTo(null); setEditing(null); }, [conversation.id]);
  const loadOlder = () => { if (scroller.current) olderAnchor.current = scroller.current.scrollHeight - scroller.current.scrollTop; thread.loadOlder(); };

  // Opening a search result: load older pages until the message is there, then bring it into view.
  useEffect(() => {
    if (!focusMessageId || thread.messages.isFetching) return;
    if (messages.some(message => message.id === focusMessageId)) {
      document.getElementById(`chat-message-${focusMessageId}`)?.scrollIntoView({ block: 'center' });
      setHighlight(focusMessageId); onFocused();
      const timer = window.setTimeout(() => setHighlight(null), 2500);
      return () => window.clearTimeout(timer);
    }
    if (thread.hasOlder) thread.loadOlder(); else onFocused();
  }, [focusMessageId, messages, thread, onFocused]);

  const reactionsByMessage = useMemo(() => {
    const map = new Map<string, ReactionGroup[]>();
    for (const reaction of thread.reactions.data ?? []) {
      const groups = map.get(reaction.messageId) ?? [];
      const group = groups.find(item => item.emoji === reaction.emoji);
      if (group) (group.userIds as string[]).push(reaction.userId); else groups.push({ emoji: reaction.emoji, userIds: [reaction.userId] });
      map.set(reaction.messageId, groups);
    }
    return map;
  }, [thread.reactions.data]);
  const peerReadAt = conversation.kind === 'direct' ? thread.members.data?.find(member => member.userId !== userId)?.lastReadAt ?? null : null;
  const byId = useMemo(() => new Map(messages.map(message => [message.id, message])), [messages]);

  async function react(message: ChatMessage, emoji: string, on: boolean) {
    try {
      await setReaction(conversation.id, message.id, userId, emoji, on);
      void client.invalidateQueries({ queryKey: chatKeys.reactions(conversation.id) });
      thread.notifyReactions();
    } catch (error) { toast.error('Reação não guardada', { description: describeChatError(error) }); }
  }
  async function confirmDelete() {
    if (!deleting) return;
    try { await deleteMessage(deleting); refreshThread(); } catch (error) { toast.error('Mensagem não eliminada', { description: describeChatError(error) }); }
    setDeleting(null);
  }
  async function toggleSetting(patch: { is_pinned?: boolean; is_muted?: boolean; is_archived?: boolean }, done: string) {
    try { await updateSettings(conversation.id, userId, patch); refreshList(); toast.success(done); } catch (error) { toast.error('Preferência não guardada', { description: describeChatError(error) }); }
  }

  const typingNames = thread.typingUserIds.map(id => people.firstName(id));
  const subtitle = typingNames.length > 0
    ? `${typingNames.join(', ')} ${typingNames.length === 1 ? 'está' : 'estão'} a escrever…`
    : conversation.kind === 'direct' ? 'Conversa privada' : conversation.kind === 'channel' ? `Toda a organização · ${conversation.memberCount} membros` : `${conversation.memberCount} membros`;

  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault(); setDragging(false);
    setIncoming(Array.from(event.dataTransfer.files));
  };

  return <section className="relative flex h-full min-h-0 flex-col" aria-label={`Conversa: ${title}`}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }}
    onDragLeave={event => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={onDrop}>
    {dragging && <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-3xl border-2 border-dashed border-primary bg-background/90 text-sm font-semibold text-primary">Largue os ficheiros para os enviar nesta conversa</div>}
    <header className="flex items-center gap-3 border-b px-3 py-2.5">
      <Button variant="ghost" size="icon" aria-label="Voltar às conversas" onClick={onBack} className="chat-back h-10 w-10 shrink-0 rounded-full"><ArrowLeft className="h-5 w-5" /></Button>
      <ConversationAvatar kind={conversation.kind} name={title} url={conversation.kind === 'direct' ? people.avatarFor(conversation.peerUserId) : null} size={40} />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[15.5px] font-bold">{title}</h2>
        <p className={cn('truncate text-[12.5px]', typingNames.length ? 'font-medium text-primary' : 'text-muted-foreground')}>{subtitle}</p>
      </div>
      {conversation.kind !== 'direct' && <Button variant="ghost" size="icon" aria-label="Detalhes" onClick={() => setDetailsOpen(true)} className="h-10 w-10 rounded-full"><Info className="h-5 w-5" /></Button>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Opções da conversa" className="h-10 w-10 rounded-full"><MoreVertical className="h-5 w-5" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => void toggleSetting({ is_pinned: !conversation.isPinned }, conversation.isPinned ? 'Conversa desafixada' : 'Conversa fixada')}>
            {conversation.isPinned ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />}{conversation.isPinned ? 'Desafixar' : 'Fixar no topo'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void toggleSetting({ is_muted: !conversation.isMuted }, conversation.isMuted ? 'Notificações ativadas' : 'Conversa silenciada')}>
            {conversation.isMuted ? <Bell className="mr-2 h-4 w-4" /> : <BellOff className="mr-2 h-4 w-4" />}{conversation.isMuted ? 'Reativar' : 'Silenciar'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void toggleSetting({ is_archived: !conversation.isArchived }, conversation.isArchived ? 'Conversa desarquivada' : 'Conversa arquivada')}>
            <Archive className="mr-2 h-4 w-4" />{conversation.isArchived ? 'Desarquivar' : 'Arquivar'}
          </DropdownMenuItem>
          {conversation.kind !== 'direct' && <DropdownMenuItem onSelect={() => setDetailsOpen(true)}><Info className="mr-2 h-4 w-4" />Detalhes do grupo</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>

    <div ref={scroller} className="chat-scroll min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6"
      onScroll={event => { const element = event.currentTarget; nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 140; }}>
      {thread.hasOlder && <div className="mb-3 flex justify-center"><Button variant="outline" size="sm" className="rounded-full" disabled={thread.messages.isFetching} onClick={loadOlder}>
        {thread.messages.isFetching && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Ver mensagens anteriores</Button></div>}
      {thread.messages.isLoading && <Loader2 className="mx-auto my-10 h-5 w-5 animate-spin text-muted-foreground" />}
      {thread.messages.isError && <p role="alert" className="mx-auto my-10 max-w-sm text-center text-sm text-destructive">{describeChatError(thread.messages.error)}</p>}
      {!thread.messages.isLoading && messages.length === 0 && !thread.messages.isError && <div className="mx-auto my-16 max-w-xs text-center text-sm text-muted-foreground">
        <ConversationAvatar kind={conversation.kind} name={title} url={conversation.kind === 'direct' ? people.avatarFor(conversation.peerUserId) : null} size={64} />
        <p className="mt-3 font-semibold text-foreground">{title}</p>
        <p className="mt-1">{conversation.kind === 'channel' ? 'O canal de toda a organização. Diga olá à equipa.' : 'Ainda não há mensagens. Escreva a primeira.'}</p>
      </div>}
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
        const continued = !newDay && previous?.senderId === message.senderId && new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < SAME_RUN_MS;
        const mine = message.senderId === userId;
        const replied = message.replyToId ? byId.get(message.replyToId) ?? null : null;
        return <Fragment key={message.id}>
          {newDay && <div className="my-4 flex justify-center"><span className="rounded-full bg-muted px-3 py-1 text-[11.5px] font-semibold capitalize text-muted-foreground">{dayLabel(message.createdAt)}</span></div>}
          <MessageBubble message={message} mine={mine} showSender={!continued && conversation.kind !== 'direct'}
            senderName={people.nameFor(message.senderId)} senderAvatar={people.avatarFor(message.senderId)}
            replied={replied} repliedName={replied ? (replied.senderId === userId ? 'Eu' : people.nameFor(replied.senderId)) : ''}
            reactions={reactionsByMessage.get(message.id) ?? []} myUserId={userId} nameFor={id => id === userId ? 'Eu' : people.nameFor(id)}
            seen={mine && peerReadAt ? peerReadAt >= message.createdAt : mine && conversation.kind === 'direct' ? false : null}
            highlighted={highlight === message.id}
            onReply={() => { setEditing(null); setReplyTo(message); }} onEdit={() => { setReplyTo(null); setEditing(message); }}
            onDelete={() => setDeleting(message)} onForward={() => setForwarding(message)}
            onReact={(emoji, on) => void react(message, emoji, on)} onJump={id => { setHighlight(id); document.getElementById(`chat-message-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }} />
        </Fragment>;
      })}
    </div>

    <ChatComposer key={conversation.id} conversationId={conversation.id} userId={userId} replyTo={replyTo} editing={editing}
      replyName={replyTo ? (replyTo.senderId === userId ? 'si próprio' : people.nameFor(replyTo.senderId)) : ''}
      incomingFiles={incoming} onIncomingTaken={takeIncoming}
      onCancelReply={() => setReplyTo(null)} onCancelEdit={() => setEditing(null)} onSent={refreshThread}
      onTyping={thread.notifyTyping} describeError={describeChatError} />

    <AlertDialog open={!!deleting} onOpenChange={open => { if (!open) setDeleting(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Eliminar mensagem?</AlertDialogTitle>
          <AlertDialogDescription>A mensagem passa a aparecer como "Mensagem eliminada" para todos e o ficheiro anexado é apagado. Não pode ser desfeito.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Manter</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void confirmDelete()}>Eliminar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <ForwardDialog message={forwarding} conversations={conversations} currentId={conversation.id} userId={userId} people={people}
      onClose={() => setForwarding(null)} onForwarded={target => { setForwarding(null); refreshList(); onOpen(target); }} />
    {conversation.kind !== 'direct' && <GroupDetailsDialog open={detailsOpen} onOpenChange={setDetailsOpen} conversation={conversation} organizationId={organizationId}
      userId={userId} members={thread.members.data ?? []} people={people} onLeft={() => { setDetailsOpen(false); refreshList(); onBack(); }} />}
  </section>;
}
