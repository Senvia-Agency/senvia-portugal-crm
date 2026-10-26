import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BellOff, Loader2, PenSquare, Pin, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { searchMessages } from './chat-api';
import { conversationTitle, lastPreview, listTime } from './chat-format';
import type { ChatConversation, ChatFilter } from './chat-model';
import { ConversationAvatar } from './ChatAvatar';

const FILTERS: readonly { key: ChatFilter; label: string }[] = [
  { key: 'all', label: 'Todas' }, { key: 'unread', label: 'Não lidas' }, { key: 'groups', label: 'Grupos' }, { key: 'archived', label: 'Arquivadas' },
];

interface Props {
  readonly organizationId: string;
  readonly conversations: readonly ChatConversation[];
  readonly activeId: string | null;
  readonly filter: ChatFilter;
  readonly onFilter: (filter: ChatFilter) => void;
  readonly onOpen: (conversationId: string, messageId?: string) => void;
  readonly onNew: () => void;
  readonly nameFor: (id: string | null) => string;
  readonly firstName: (id: string | null) => string;
  readonly avatarFor: (id: string | null) => string | null;
}

export function ConversationList({ organizationId, conversations, activeId, filter, onFilter, onOpen, onNew, nameFor, firstName, avatarFor }: Props) {
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => { const timer = window.setTimeout(() => setTerm(query.trim()), 300); return () => window.clearTimeout(timer); }, [query]);
  const found = useQuery({ queryKey: ['workplace-chat', 'search', organizationId, term], enabled: term.length >= 2, queryFn: () => searchMessages(organizationId, term) });

  const lowered = query.trim().toLocaleLowerCase('pt');
  const visible = conversations
    .filter(conversation => filter === 'archived' ? conversation.isArchived : !conversation.isArchived)
    .filter(conversation => filter !== 'unread' || conversation.unread > 0)
    .filter(conversation => filter !== 'groups' || conversation.kind !== 'direct')
    .filter(conversation => !lowered || conversationTitle(conversation, nameFor).toLocaleLowerCase('pt').includes(lowered))
    .sort((first, second) => Number(second.isPinned) - Number(first.isPinned)
      || (second.lastMessageAt ?? second.createdAt).localeCompare(first.lastMessageAt ?? first.createdAt));
  const titleOf = (conversationId: string) => {
    const conversation = conversations.find(item => item.id === conversationId);
    return conversation ? conversationTitle(conversation, nameFor) : 'Conversa';
  };

  return <div className="flex h-full min-h-0 flex-col">
    <div className="space-y-3 border-b px-4 pb-3 pt-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-[22px] font-extrabold tracking-tight">Mensagens</h1>
        <Button size="sm" className="h-9 rounded-full" onClick={onNew}><PenSquare className="mr-1.5 h-4 w-4" />Nova</Button>
      </div>
      <label className="flex h-10 items-center gap-2 rounded-full border bg-card px-3.5 focus-within:ring-2 focus-within:ring-ring">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Procurar conversas e mensagens" aria-label="Procurar conversas e mensagens" value={query} onChange={event => setQuery(event.target.value)} />
        {query && <button type="button" aria-label="Limpar pesquisa" onClick={() => setQuery('')} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>}
      </label>
      {/* Compact pills that wrap instead of being cut in the narrow list (Inbox embed included). */}
      <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar conversas">
        {FILTERS.map(item => {
          const count = item.key === 'unread' ? conversations.filter(conversation => !conversation.isArchived && conversation.unread > 0).length : 0;
          return <button key={item.key} type="button" aria-pressed={filter === item.key} onClick={() => onFilter(item.key)}
            className={cn('h-7 shrink-0 rounded-full px-2.5 text-[11.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              filter === item.key ? 'bg-foreground text-background' : 'border bg-card text-muted-foreground hover:text-foreground')}>
            {item.label}{count > 0 ? ` · ${count}` : ''}
          </button>;
        })}
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      {visible.map(conversation => {
        const title = conversationTitle(conversation, nameFor);
        const unread = conversation.unread > 0;
        return <button key={conversation.id} type="button" onClick={() => onOpen(conversation.id)} aria-current={activeId === conversation.id ? 'true' : undefined}
          className={cn('chat-row flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            activeId === conversation.id ? 'bg-primary/10' : 'hover:bg-muted/70')}>
          <ConversationAvatar kind={conversation.kind} name={title} url={conversation.kind === 'direct' ? avatarFor(conversation.peerUserId) : null} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className={cn('min-w-0 flex-1 truncate text-[14.5px]', unread ? 'font-bold' : 'font-semibold')}>{title}</span>
              <span className={cn('shrink-0 text-[11.5px]', unread && !conversation.isMuted ? 'font-semibold text-primary' : 'text-muted-foreground')}>{listTime(conversation.lastMessageAt ?? conversation.createdAt)}</span>
            </span>
            <span className="mt-0.5 flex items-center gap-1.5">
              <span className={cn('min-w-0 flex-1 truncate text-[13px]', unread ? 'text-foreground' : 'text-muted-foreground')}>{lastPreview(conversation, firstName)}</span>
              {conversation.isMuted && <BellOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Silenciada" />}
              {conversation.isPinned && <Pin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Fixada" />}
              {unread && <span className={cn('flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white', conversation.isMuted ? 'bg-muted-foreground/60' : 'bg-primary')}>
                {conversation.unread > 99 ? '99+' : conversation.unread}
              </span>}
            </span>
          </span>
        </button>;
      })}
      {visible.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">
        {filter === 'archived' ? 'Sem conversas arquivadas.' : filter === 'unread' ? 'Está tudo lido.' : lowered ? 'Nenhuma conversa com esse nome.' : 'Ainda não há conversas. Comece uma com "Nova".'}
      </p>}
      {term.length >= 2 && <div className="mt-2 border-t px-2 pt-3">
        <p className="px-1 pb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Mensagens</p>
        {found.isFetching && <Loader2 className="mx-auto my-3 h-4 w-4 animate-spin text-muted-foreground" />}
        {found.data?.map(result => <button key={result.id} type="button" onClick={() => onOpen(result.conversation_id, result.id)}
          className="block w-full rounded-xl px-2.5 py-2 text-left hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex items-center gap-2 text-[12.5px]"><span className="min-w-0 flex-1 truncate font-semibold">{titleOf(result.conversation_id)}</span><span className="text-muted-foreground">{listTime(result.created_at)}</span></span>
          <span className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{firstName(result.sender_id)}: {result.body}</span>
        </button>)}
        {found.data && found.data.length === 0 && !found.isFetching && <p className="px-2 pb-2 text-sm text-muted-foreground">Nenhuma mensagem encontrada.</p>}
      </div>}
    </div>
  </div>;
}
