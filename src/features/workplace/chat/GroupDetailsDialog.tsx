import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, LogOut, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTeamMembers } from '@/hooks/useTeam';
import { addMembers, describeChatError, leaveGroup, renameGroup } from './chat-api';
import type { ChatConversation, ChatMember } from './chat-model';
import { chatKeys } from './useChat';
import { ConversationAvatar, PeoplePicker, PersonAvatar } from './ChatAvatar';

const ROLE_LABELS = { owner: 'Dono', admin: 'Administrador', member: '' } as const;

interface Props {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly conversation: ChatConversation;
  readonly organizationId: string;
  readonly userId: string;
  readonly members: readonly ChatMember[];
  readonly people: { nameFor: (id: string | null) => string; avatarFor: (id: string | null) => string | null };
  readonly onLeft: () => void;
}

export function GroupDetailsDialog({ open, onOpenChange, conversation, organizationId, userId, members, people, onLeft }: Props) {
  const client = useQueryClient();
  const { data: team = [] } = useTeamMembers();
  const [title, setTitle] = useState(conversation.title ?? '');
  const [adding, setAdding] = useState<string[]>([]);
  const [busy, setBusy] = useState<'rename' | 'add' | 'leave' | null>(null);
  useEffect(() => { if (open) { setTitle(conversation.title ?? ''); setAdding([]); } }, [open, conversation.title]);
  const isGroup = conversation.kind === 'group';
  const manages = isGroup && (conversation.myRole === 'owner' || conversation.myRole === 'admin');
  const refresh = () => {
    void client.invalidateQueries({ queryKey: chatKeys.list(organizationId) });
    void client.invalidateQueries({ queryKey: chatKeys.members(conversation.id) });
  };
  async function run(kind: 'rename' | 'add' | 'leave', action: () => Promise<void>, done: string) {
    setBusy(kind);
    try { await action(); refresh(); toast.success(done); return true; }
    catch (error) { toast.error('Não foi possível concluir', { description: describeChatError(error) }); return false; }
    finally { setBusy(null); }
  }
  const sorted = [...members].sort((first, second) => Number(second.role === 'owner') - Number(first.role === 'owner') || people.nameFor(first.userId).localeCompare(people.nameFor(second.userId), 'pt'));

  return <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
    <DialogContent variant="fullScreen" className="chat-dialog flex flex-col gap-0 p-0">
      <DialogHeader className="border-b px-5 py-4 text-left md:px-8">
        <DialogTitle className="flex items-center gap-3 text-xl">
          <ConversationAvatar kind={conversation.kind} name={conversation.title ?? 'Grupo'} size={40} />{conversation.title}
        </DialogTitle>
        <DialogDescription>{conversation.kind === 'channel' ? 'Canal de toda a organização: cada colega entra ao abrir as Mensagens.' : `${members.length} membros`}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-8">
          {isGroup && <form className="space-y-2" onSubmit={event => { event.preventDefault(); void run('rename', () => renameGroup(conversation.id, title.trim()), 'Nome do grupo atualizado'); }}>
            <label htmlFor="chat-group-title" className="text-base font-semibold">Nome do grupo</label>
            <div className="flex gap-2">
              <Input id="chat-group-title" value={title} maxLength={80} onChange={event => setTitle(event.target.value)} className="h-11 rounded-full" />
              <Button type="submit" className="h-11 rounded-full" disabled={!title.trim() || title.trim() === conversation.title || !!busy}>{busy === 'rename' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar</Button>
            </div>
          </form>}
          <section className="space-y-3" aria-label="Membros">
            <h3 className="text-base font-semibold">Membros</h3>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {sorted.map(member => <li key={member.userId} className="flex items-center gap-3 rounded-2xl border bg-card px-3 py-2">
                <PersonAvatar name={people.nameFor(member.userId)} url={people.avatarFor(member.userId)} size={36} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{people.nameFor(member.userId)}{member.userId === userId ? ' (Eu)' : ''}</span>
                {ROLE_LABELS[member.role] && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{ROLE_LABELS[member.role]}</span>}
              </li>)}
            </ul>
          </section>
          {manages && <section className="space-y-3" aria-label="Adicionar pessoas">
            <h3 className="flex items-center gap-2 text-base font-semibold"><UserPlus className="h-4 w-4" aria-hidden="true" />Adicionar pessoas</h3>
            <PeoplePicker people={team.filter(person => !person.is_banned)} multiple selected={adding} excludeIds={members.map(member => member.userId)}
              onToggle={id => setAdding(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])} />
            <Button className="rounded-full" disabled={adding.length === 0 || !!busy}
              onClick={() => void run('add', () => addMembers(conversation.id, adding), adding.length === 1 ? 'Pessoa adicionada' : 'Pessoas adicionadas').then(ok => { if (ok) setAdding([]); })}>
              {busy === 'add' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Adicionar {adding.length > 0 ? `(${adding.length})` : ''}
            </Button>
          </section>}
          {isGroup && <section className="border-t pt-6">
            <Button variant="outline" className="rounded-full border-destructive/40 text-destructive hover:bg-destructive/10" disabled={!!busy}
              onClick={() => void run('leave', () => leaveGroup(conversation.id), 'Saiu do grupo').then(ok => { if (ok) onLeft(); })}>
              {busy === 'leave' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}Sair do grupo
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">Deixa de ver este grupo. As mensagens ficam para os outros membros.</p>
          </section>}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
