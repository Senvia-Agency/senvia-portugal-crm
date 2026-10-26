import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, UsersRound, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { EmailAddress } from '@/hooks/useEmail';
import { cn } from '@/lib/utils';
import { describeWebmailError, type ContactList } from './webmail-api';
import { useContactListActions, useContactLists, useMailContacts } from './useWebmail';

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
/** "Ana <ana@x.pt>, b@y.pt; c@z.pt" → addresses (names kept when given). */
function parseAddresses(text: string): EmailAddress[] {
  return text.split(/[,;\n]/).map(part => part.trim()).filter(Boolean).flatMap(part => {
    const named = part.match(/^(.*?)<([^>]+)>$/);
    const address = (named ? named[2] : part).trim().toLowerCase();
    return EMAIL.test(address) ? [{ name: named ? named[1].trim().replace(/^"|"$/g, '') : '', address }] : [];
  });
}

export function ContactListsDialog({ onClose }: { onClose: () => void }) {
  const lists = useContactLists();
  const contacts = useMailContacts();
  const actions = useContactListActions();
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [name, setName] = useState('');
  const [members, setMembers] = useState<EmailAddress[]>([]);
  const [entry, setEntry] = useState('');
  const current: ContactList | undefined = lists.data?.find(list => list.id === selected);
  useEffect(() => {
    if (selected === null && lists.data) setSelected(lists.data[0]?.id ?? 'new');
  }, [lists.data, selected]);
  useEffect(() => {
    setName(current?.name ?? '');
    setMembers(current ? [...current.members] : []);
    setEntry('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, current?.id]);

  const merge = (base: readonly EmailAddress[], text: string) => {
    const known = new Set(base.map(member => member.address));
    return [...base, ...parseAddresses(text).filter(member => !known.has(member.address) && (known.add(member.address), true))].slice(0, 500);
  };
  const add = (text: string) => {
    if (parseAddresses(text).length === 0) return false;
    setMembers(previous => merge(previous, text));
    setEntry('');
    return true;
  };
  const term = entry.trim().toLowerCase();
  const suggestions = term.length >= 2 ? (contacts.data ?? []).filter(contact => `${contact.name ?? ''} ${contact.email}`.toLowerCase().includes(term)
    && !members.some(member => member.address === contact.email)).slice(0, 6) : [];

  const save = () => {
    // An address still being typed counts too.
    const finalMembers = entry.trim() ? merge(members, entry) : members;
    setMembers(finalMembers);
    setEntry('');
    if (!name.trim()) { toast.error('Dê um nome à lista.'); return; }
    actions.save.mutate({ id: current?.id ?? null, name, members: finalMembers }, {
      onSuccess: id => { toast.success(current ? 'Lista guardada' : 'Lista criada'); setSelected(id); },
      onError: error => toast.error('Não foi possível guardar a lista', { description: describeWebmailError(error) }),
    });
  };
  const remove = () => {
    if (!current) return;
    actions.remove.mutate(current.id, {
      onSuccess: () => { toast.success('Lista eliminada'); setSelected(null); },
      onError: error => toast.error('Não foi possível eliminar a lista', { description: describeWebmailError(error) }),
    });
  };

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent variant="fullScreen" className="flex flex-col gap-0 p-0">
      <DialogHeader className="border-b px-5 py-4 pr-14 text-left md:px-8">
        <DialogTitle className="flex items-center gap-2 text-xl"><UsersRound className="h-5 w-5 text-primary" aria-hidden="true" />Listas de contactos</DialogTitle>
        <DialogDescription>Escreva o nome de uma lista em "Para" e todos os contactos dela entram na mensagem. As listas são só suas.</DialogDescription>
      </DialogHeader>
      {lists.error ? <p role="alert" className="m-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{describeWebmailError(lists.error)}</p>
        : <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="webmail-tabs" role="tablist" aria-label="Listas">
            {(lists.data ?? []).map(list => <button key={list.id} type="button" role="tab" aria-selected={selected === list.id} className="webmail-tab" onClick={() => setSelected(list.id)}>
              <span className="min-w-0 flex-1 truncate">{list.name}</span><span className="rounded-full bg-muted px-2 text-[11px] font-semibold text-muted-foreground">{list.members.length}</span>
            </button>)}
            <button type="button" role="tab" aria-selected={selected === 'new'} className="webmail-tab text-primary" onClick={() => setSelected('new')}><Plus aria-hidden="true" />Nova lista</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8">
            {lists.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="A carregar" /> : <div className="mx-auto max-w-2xl space-y-6">
              <div className="space-y-1.5">
                <Label htmlFor="list-name">Nome da lista</Label>
                <Input id="list-name" value={name} maxLength={60} placeholder="Ex.: Clientes do Porto" onChange={event => setName(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="list-members">Contactos <span className="font-normal text-muted-foreground">· {members.length} {members.length === 1 ? 'pessoa' : 'pessoas'}</span></Label>
                <div className="relative">
                  <div className="flex min-h-[48px] flex-wrap items-center gap-1.5 rounded-2xl border bg-card p-2 focus-within:ring-2 focus-within:ring-ring">
                    {members.map(member => <span key={member.address} className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                      <span className="max-w-[14rem] truncate">{member.name || member.address}</span>
                      <button type="button" aria-label={`Retirar ${member.address}`} onClick={() => setMembers(members.filter(item => item.address !== member.address))}><X className="h-3 w-3" /></button>
                    </span>)}
                    <input id="list-members" value={entry} onChange={event => setEntry(event.target.value)} placeholder={members.length ? '' : 'Escreva ou cole emails separados por vírgulas'}
                      className="min-w-[12rem] flex-1 bg-transparent px-1 py-1 text-sm outline-none"
                      onKeyDown={event => {
                        if (['Enter', ',', ';', 'Tab'].includes(event.key) && entry.trim()) { event.preventDefault(); if (!add(entry)) toast.error('Endereço de email inválido.'); }
                        if (event.key === 'Backspace' && !entry && members.length) setMembers(members.slice(0, -1));
                      }}
                      onPaste={event => { const text = event.clipboardData.getData('text/plain'); if (/[,;\n]/.test(text)) { event.preventDefault(); add(text); } }}
                      onBlur={() => { if (entry.trim()) add(entry); }} />
                  </div>
                  {suggestions.length > 0 && <div className="absolute left-0 top-full z-10 mt-1 w-80 max-w-full rounded-xl border bg-popover p-1 shadow-lg" role="listbox" aria-label="Contactos sugeridos">
                    {suggestions.map(contact => <button key={contact.email} type="button" role="option" aria-selected={false} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-accent"
                      onMouseDown={event => { event.preventDefault(); add(contact.name ? `${contact.name} <${contact.email}>` : contact.email); }}>
                      <span className="font-medium">{contact.name || contact.email}</span><span className="truncate text-muted-foreground">{contact.email}</span>
                    </button>)}
                  </div>}
                </div>
              </div>
            </div>}
          </div>
        </div>}
      <div className={cn('flex items-center gap-2 border-t bg-background px-5 py-4 md:px-8')}>
        {current && <Button variant="ghost" className="rounded-full text-destructive hover:text-destructive" disabled={actions.remove.isPending} onClick={remove}><Trash2 className="mr-2 h-4 w-4" />Eliminar lista</Button>}
        <div className="flex-1" />
        <Button variant="outline" className="rounded-full" onClick={onClose}>Fechar</Button>
        <Button className="rounded-full" disabled={actions.save.isPending || !!lists.error} onClick={save}>{actions.save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{current ? 'Guardar' : 'Criar lista'}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
