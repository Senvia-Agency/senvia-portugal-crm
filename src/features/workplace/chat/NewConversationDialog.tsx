import { useMemo, useState } from 'react';
import { Check, Loader2, Search, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { TeamMember } from '@/hooks/useTeam';
import { cn } from '@/lib/utils';
import { createGroup, describeChatError, startDirect } from './chat-api';
import { PersonAvatar } from './ChatAvatar';

interface Props {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly organizationId: string;
  readonly userId: string;
  readonly people: readonly TeamMember[];
  readonly onCreated: (conversationId: string) => void;
}

const ROLE_LABELS: Record<TeamMember['role'], string> = { admin: 'Administrador', salesperson: 'Comercial', viewer: 'Colaborador', super_admin: 'Super admin' };
const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt');

/** Automatic name for an unnamed group: "Ana, Rui e Marta" (up to four names, then "+N"). */
export function groupTitle(names: readonly string[]) {
  const list = names.filter(Boolean);
  if (list.length <= 1) return list[0] ?? 'Grupo';
  const shown = list.slice(0, 4);
  const rest = list.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} +${rest}`;
  return `${shown.slice(0, -1).join(', ')} e ${shown[shown.length - 1]}`;
}

/** New conversation, as in Realize: one colleague opens a private chat; several make a group (name optional). */
export function NewConversationDialog({ open, onOpenChange, organizationId, userId, people, onCreated }: Props) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const colleagues = useMemo(() => people.filter(person => person.user_id !== userId), [people, userId]);
  const visible = useMemo(() => {
    const term = normalize(query.trim());
    return colleagues.filter(person => !term || normalize(`${person.full_name} ${ROLE_LABELS[person.role] ?? ''} ${person.email ?? ''}`).includes(term));
  }, [colleagues, query]);
  const personOf = (id: string) => colleagues.find(person => person.user_id === id);
  const reset = () => { setQuery(''); setSelected([]); setTitle(''); };
  const toggle = (id: string) => setSelected(list => list.includes(id) ? list.filter(item => item !== id) : [...list, id]);

  const isGroup = selected.length > 1;
  const canCreate = selected.length > 0 && !busy;
  const defaultTitle = groupTitle(selected.map(id => personOf(id)?.full_name.split(' ')[0] ?? ''));

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    try {
      const id = isGroup ? await createGroup(organizationId, (title.trim() || defaultTitle).slice(0, 80), selected) : await startDirect(organizationId, selected[0]);
      reset();
      onOpenChange(false);
      onCreated(id);
    } catch (error) {
      toast.error('Conversa não criada', { description: describeChatError(error) });
    } finally {
      setBusy(false);
    }
  }

  return <Dialog open={open} onOpenChange={value => { if (busy) return; if (!value) reset(); onOpenChange(value); }}>
    <DialogContent className="chat-dialog flex max-h-[85vh] flex-col gap-0 overflow-hidden rounded-[28px] p-0 sm:max-w-md sm:rounded-[28px]">
      <DialogHeader className="space-y-1 px-6 pb-3 pt-6 text-left">
        <DialogTitle className="text-xl font-extrabold">Nova conversa</DialogTitle>
        <DialogDescription>Escolha um colega, ou vários para criar um grupo.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 px-6 pb-3">
        {isGroup && <div className="rounded-2xl bg-primary/[.07] p-3 ring-1 ring-primary/20">
          <label htmlFor="chat-new-group-title" className="mb-2 flex items-center gap-1.5 text-[12.5px] font-bold uppercase tracking-[0.08em] text-primary">
            <Users className="h-4 w-4" aria-hidden="true" /> Novo grupo · {selected.length} colegas
          </label>
          <input id="chat-new-group-title" value={title} onChange={event => setTitle(event.target.value.slice(0, 80))} placeholder="Dê um nome ao grupo"
            className="h-12 w-full rounded-xl bg-card px-4 text-[15px] font-semibold outline-none ring-2 ring-primary/30 placeholder:font-normal placeholder:text-muted-foreground focus:ring-primary" />
          <p className="mt-1.5 text-[12px] text-muted-foreground">Opcional. Se não escrever, fica <b className="text-foreground">{defaultTitle}</b>.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {selected.map(id => {
              const person = personOf(id);
              return <button key={id} type="button" onClick={() => toggle(id)} aria-label={`Tirar ${person?.full_name ?? ''} do grupo`}
                className="inline-flex items-center gap-1 rounded-full bg-card py-1 pl-1 pr-2 text-[12px] font-semibold ring-1 ring-border hover:ring-destructive/40">
                <PersonAvatar name={person?.full_name ?? '?'} url={person?.avatar_url} size={20} />
                {person?.full_name.split(' ')[0]}
                <X className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
              </button>;
            })}
          </div>
        </div>}
        <label className="flex h-11 items-center gap-2 rounded-2xl bg-muted/70 px-3 text-muted-foreground focus-within:bg-card focus-within:ring-1 focus-within:ring-primary/40">
          <Search className="h-4 w-4" aria-hidden="true" />
          <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Nome, função ou email" aria-label="Procurar colega"
            className="w-full bg-transparent text-sm text-foreground outline-none" />
        </label>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
        {visible.map(person => {
          const checked = selected.includes(person.user_id);
          return <li key={person.user_id}>
            <button type="button" onClick={() => toggle(person.user_id)} aria-pressed={checked}
              className={cn('flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', checked ? 'bg-primary/[.08]' : 'hover:bg-muted/70')}>
              <PersonAvatar name={person.full_name} url={person.avatar_url} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-semibold">{person.full_name}</span>
                <span className="block truncate text-xs text-muted-foreground">{ROLE_LABELS[person.role] ?? 'Colaborador'}</span>
              </span>
              <span aria-hidden="true" className={cn('flex h-6 w-6 items-center justify-center rounded-full ring-2', checked ? 'bg-primary text-primary-foreground ring-primary' : 'ring-border')}>
                {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
              </span>
            </button>
          </li>;
        })}
        {visible.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nenhum colega encontrado.</p>}
      </ul>
      <div className="border-t p-4">
        <button type="button" onClick={() => void create()} disabled={!canCreate}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-[15px] font-semibold text-primary-foreground transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {isGroup ? `Criar grupo com ${selected.length} colegas` : 'Começar conversa'}
        </button>
      </div>
    </DialogContent>
  </Dialog>;
}
