import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, MessagesSquare } from 'lucide-react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { describeChatError } from './chat-api';
import type { ChatFilter } from './chat-model';
import { useChatConversations, useChatPeople } from './useChat';
import { ConversationList } from './ConversationList';
import { ConversationView } from './ConversationView';
import { NewConversationDialog } from './NewConversationDialog';
import './chat.css';

/** Internal messages: conversation list and the open conversation. Used by /mensagens and inside the Inbox. */
export function ChatWorkspace({ organizationId, userId, embedded = false }: { organizationId: string; userId: string; embedded?: boolean }) {
  const list = useChatConversations(organizationId, userId);
  const people = useChatPeople(userId);
  const [params, setParams] = useSearchParams();
  const activeId = params.get('conversa');
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  const [filter, setFilter] = usePersistedState<ChatFilter>('workplace-chat-filter-v1', 'all');
  const [creating, setCreating] = useState(false);
  const conversations = list.data ?? [];
  const active = conversations.find(conversation => conversation.id === activeId) ?? null;
  const open = useCallback((conversationId: string, messageId?: string) => {
    setParams(current => { const next = new URLSearchParams(current); next.set('conversa', conversationId); return next; });
    setFocusMessageId(messageId ?? null);
  }, [setParams]);
  const back = () => setParams(current => { const next = new URLSearchParams(current); next.delete('conversa'); return next; });
  const focused = useCallback(() => setFocusMessageId(null), []);
  const shell = cn('workplace-chat', embedded && 'workplace-chat--embedded');

  if (list.isError) {
    return <div className={cn(shell, 'flex items-center justify-center p-6')}>
      <div role="alert" className="max-w-md rounded-3xl border bg-card p-8 text-center shadow-sm">
        <span className="chat-avatar chat-tile chat-tile--group mx-auto" style={{ width: 56, height: 56 }}><MessagesSquare className="h-7 w-7" /></span>
        <h1 className="mt-4 text-lg font-bold">As Mensagens ainda não estão disponíveis</h1>
        <p className="mt-2 text-sm text-muted-foreground">{describeChatError(list.error)}</p>
        <Button variant="outline" className="mt-5 rounded-full" onClick={() => void list.refetch()}>Tentar novamente</Button>
      </div>
    </div>;
  }

  return <div className={shell} data-open={active ? 'conversation' : 'list'}>
    <aside className="chat-list-pane" aria-label="Conversas">
      {list.isLoading
        ? <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        : <ConversationList organizationId={organizationId} conversations={conversations} activeId={activeId} filter={filter} onFilter={setFilter}
            onOpen={open} onNew={() => setCreating(true)} nameFor={people.nameFor} firstName={people.firstName} avatarFor={people.avatarFor} />}
    </aside>
    <div className="chat-thread-pane">
      {active
        ? <ConversationView key={active.id} conversation={active} conversations={conversations} organizationId={organizationId} userId={userId} people={people}
            focusMessageId={focusMessageId} onFocused={focused} onBack={back} onOpen={id => open(id)} />
        : <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <span className="chat-avatar chat-tile chat-tile--group" style={{ width: 64, height: 64 }}><MessagesSquare className="h-8 w-8" /></span>
            <h2 className="text-lg font-bold">As suas conversas da equipa</h2>
            <p className="max-w-sm text-sm text-muted-foreground">Escolha uma conversa ou comece uma nova com um colega ou um grupo.</p>
            <Button className="rounded-full" onClick={() => setCreating(true)}>Nova conversa</Button>
          </div>}
    </div>
    <NewConversationDialog open={creating} onOpenChange={setCreating} organizationId={organizationId} userId={userId} people={people.members}
      onCreated={id => { void list.refetch(); open(id); }} />
  </div>;
}
