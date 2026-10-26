import { useState } from 'react';
import { Forward, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { describeChatError, forwardMessage } from './chat-api';
import { conversationTitle, messageSummary } from './chat-format';
import type { ChatConversation, ChatMessage } from './chat-model';
import { ConversationAvatar } from './ChatAvatar';

interface Props {
  readonly message: ChatMessage | null;
  readonly conversations: readonly ChatConversation[];
  readonly currentId: string;
  readonly userId: string;
  readonly people: { nameFor: (id: string | null) => string; avatarFor: (id: string | null) => string | null };
  readonly onClose: () => void;
  readonly onForwarded: (conversationId: string) => void;
}

export function ForwardDialog({ message, conversations, currentId, userId, people, onClose, onForwarded }: Props) {
  const [query, setQuery] = useState('');
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const term = query.trim().toLocaleLowerCase('pt');
  const targets = conversations.filter(conversation => conversation.id !== currentId && conversationTitle(conversation, people.nameFor).toLocaleLowerCase('pt').includes(term));
  async function forward(target: ChatConversation) {
    if (!message || sendingTo) return;
    setSendingTo(target.id);
    try {
      await forwardMessage(message, target.id, userId);
      toast.success(`Reencaminhada para ${conversationTitle(target, people.nameFor)}`);
      onForwarded(target.id);
    } catch (error) {
      toast.error('Não foi reencaminhada', { description: describeChatError(error) });
    } finally {
      setSendingTo(null);
    }
  }
  return <Dialog open={!!message} onOpenChange={open => { if (!open && !sendingTo) onClose(); }}>
    <DialogContent variant="fullScreen" className="chat-dialog flex flex-col gap-0 p-0">
      <DialogHeader className="border-b px-5 py-4 text-left md:px-8">
        <DialogTitle className="flex items-center gap-2 text-xl"><Forward className="h-5 w-5 text-primary" aria-hidden="true" />Reencaminhar mensagem</DialogTitle>
        <DialogDescription className="line-clamp-2">{message ? messageSummary({ ...message, attachmentName: message.attachment?.name }) : ''}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-8">
        <div className="mx-auto max-w-2xl space-y-3">
          <label className="flex h-11 items-center gap-2 rounded-full border bg-card px-4 focus-within:ring-2 focus-within:ring-ring">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Procurar conversa…" aria-label="Procurar conversa" value={query} onChange={event => setQuery(event.target.value)} />
          </label>
          <div className="space-y-1">
            {targets.map(target => {
              const title = conversationTitle(target, people.nameFor);
              return <button key={target.id} type="button" disabled={!!sendingTo} onClick={() => void forward(target)}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
                <ConversationAvatar kind={target.kind} name={title} url={target.kind === 'direct' ? people.avatarFor(target.peerUserId) : null} size={40} />
                <span className="min-w-0 flex-1 truncate font-semibold">{title}</span>
                {sendingTo === target.id && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              </button>;
            })}
            {targets.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma outra conversa encontrada.</p>}
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
