import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive, CheckCheck, FileEdit, Inbox, Loader2, Mail, MailOpen, Menu, Paperclip, RefreshCw, Search, Star, StarOff, Trash2, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { EmailDraft, EmailMessage } from '@/hooks/useEmail';
import { fmtListDate, initials } from '@/components/email/emailShared';
import { readMessage } from './webmail-api';
import type { MailboxActions } from './useWebmail';
import type { MailAccount } from './webmail-model';

const AVATAR_TONES = ['bg-rose-100 text-rose-700', 'bg-amber-100 text-amber-700', 'bg-emerald-100 text-emerald-700', 'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700', 'bg-fuchsia-100 text-fuchsia-700', 'bg-teal-100 text-teal-700', 'bg-orange-100 text-orange-700'];
/** Plain text of a draft body (entities decoded), without the signature. */
function draftPreview(html: string | null) {
  if (!html) return '';
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  body.querySelectorAll('.senvia-signature').forEach(node => node.remove());
  return (body.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
}

export function avatarTone(name: string) {
  let hash = 0;
  for (let index = 0; index < name.length; index++) hash = (hash * 31 + name.charCodeAt(index)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}

interface MailListProps {
  readonly title: string;
  readonly resetKey: string;
  readonly accounts: readonly MailAccount[];
  readonly unified: boolean;
  readonly sentView: boolean;
  readonly trashView: boolean;
  readonly messages: readonly EmailMessage[];
  readonly drafts: readonly EmailDraft[] | null;
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly search: string;
  readonly onSearch: (value: string) => void;
  readonly activeId: string | null;
  readonly onOpen: (message: EmailMessage) => void;
  readonly onOpenDraft: (draft: EmailDraft) => void;
  readonly onRefresh: () => void;
  readonly onMenu: () => void;
  readonly onLoadMore: (() => void) | null;
  readonly loadingMore: boolean;
  readonly onMarkAllRead: (() => void) | null;
  readonly onDeleteForever: (messages: readonly EmailMessage[]) => void;
  readonly actions: MailboxActions;
  readonly notices?: ReactNode;
  readonly emptyText: string;
  readonly onSelecting: (selecting: boolean) => void;
}

export function MailList(props: MailListProps) {
  const { messages, actions, accounts, unified, activeId, trashView } = props;
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<number | null>(null);
  const client = useQueryClient();
  const hoverTimer = useRef<number>();
  useEffect(() => { setSelected(new Set()); anchor.current = null; }, [props.resetKey]);
  const { onSelecting } = props;
  useEffect(() => { onSelecting(selected.size > 0); }, [selected.size, onSelecting]);

  const picked = messages.filter(message => selected.has(message.id));
  const allOnPage = messages.length > 0 && picked.length === messages.length;
  const toggle = (index: number, shift: boolean) => {
    const message = messages[index];
    if (!message) return;
    setSelected(previous => {
      const next = new Set(previous);
      // Shift+click selects the whole range from the last clicked row, Gmail-style.
      if (shift && anchor.current !== null) {
        const [from, to] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
        const on = !previous.has(message.id);
        messages.slice(from, to + 1).forEach(item => (on ? next.add(item.id) : next.delete(item.id)));
      } else if (next.has(message.id)) next.delete(message.id);
      else next.add(message.id);
      return next;
    });
    anchor.current = index;
  };
  const clear = () => setSelected(new Set());
  const run = (action: () => unknown) => { action(); clear(); };
  const accountOf = (message: EmailMessage) => accounts.find(account => account.id === message.channel_id);
  const prefetch = (id: string) => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      void client.prefetchQuery({ queryKey: ['email-message', id], queryFn: () => readMessage(id), staleTime: 30_000 });
    }, 250);
  };

  return <section className="webmail-list" aria-label={props.title}>
    <header className="space-y-3 border-b px-4 pb-3 pt-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="webmail-menu h-9 w-9 shrink-0 rounded-full" aria-label="Caixas e pastas" onClick={props.onMenu}><Menu className="h-5 w-5" /></Button>
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">{props.title}</h2>
        {props.onMarkAllRead && <Button variant="ghost" size="sm" className="h-9 rounded-full px-3 text-xs text-primary" onClick={props.onMarkAllRead}>
          <CheckCheck className="mr-1.5 h-4 w-4" />Marcar tudo como lido
        </Button>}
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-full" aria-label="Atualizar" onClick={props.onRefresh}>
          <RefreshCw className={cn('h-4 w-4', props.refreshing && 'animate-spin motion-reduce:animate-none')} />
        </Button>
      </div>
      {selected.size > 0 ? (
        <div className="flex min-h-11 flex-wrap items-center gap-1 rounded-2xl bg-primary/5 px-2 py-1" role="toolbar" aria-label="Ações nos emails selecionados">
          <Checkbox aria-label={allOnPage ? 'Desselecionar todos' : 'Selecionar todos nesta página'} className="mx-1.5"
            checked={allOnPage ? true : 'indeterminate'} onCheckedChange={() => (allOnPage ? clear() : setSelected(new Set(messages.map(message => message.id))))} />
          <span className="mr-auto text-sm font-medium">{selected.size} {selected.size === 1 ? 'selecionado' : 'selecionados'}</span>
          <Button size="icon" variant="ghost" className="h-9 w-9 rounded-full" title="Marcar como lido" aria-label="Marcar como lido" onClick={() => run(() => actions.setRead(picked, true))}><MailOpen className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" className="h-9 w-9 rounded-full" title="Marcar como não lido" aria-label="Marcar como não lido" onClick={() => run(() => actions.setRead(picked, false))}><Mail className="h-4 w-4" /></Button>
          {picked.every(message => message.flagged)
            ? <Button size="icon" variant="ghost" className="h-9 w-9 rounded-full" title="Remover estrela" aria-label="Remover estrela" onClick={() => run(() => actions.setFlag(picked, false))}><StarOff className="h-4 w-4" /></Button>
            : <Button size="icon" variant="ghost" className="h-9 w-9 rounded-full" title="Marcar com estrela" aria-label="Marcar com estrela" onClick={() => run(() => actions.setFlag(picked, true))}><Star className="h-4 w-4" /></Button>}
          {!trashView && <Button size="icon" variant="ghost" className="h-9 w-9 rounded-full" title="Arquivar" aria-label="Arquivar" onClick={() => run(() => actions.archive(picked))}><Archive className="h-4 w-4" /></Button>}
          <Button size="icon" variant="ghost" className="h-9 w-9 rounded-full text-destructive hover:text-destructive" title={trashView ? 'Eliminar definitivamente' : 'Mover para o lixo'} aria-label={trashView ? 'Eliminar definitivamente' : 'Mover para o lixo'}
            onClick={() => (trashView ? props.onDeleteForever(picked) : run(() => actions.trash(picked)))}><Trash2 className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" className="h-9 w-9 rounded-full" title="Limpar seleção" aria-label="Limpar seleção" onClick={clear}><X className="h-4 w-4" /></Button>
        </div>
      ) : (
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" aria-hidden="true" />
          <input value={props.search} onChange={event => props.onSearch(event.target.value)} aria-label="Pesquisar emails" placeholder="Pesquisar emails…"
            autoComplete="off" className="h-11 w-full rounded-2xl border border-primary/25 bg-primary/5 pl-10 pr-10 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/30" />
          {props.search && <button type="button" aria-label="Limpar pesquisa" onClick={() => props.onSearch('')} className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>}
        </label>
      )}
      {props.notices}
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto">
      {props.loading ? (
        <div className="p-2" aria-busy="true" aria-label="A carregar">
          {Array.from({ length: 8 }).map((_, index) => <div key={index} className="flex items-center gap-3 px-2 py-3">
            <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-2"><div className="h-3 w-2/5 animate-pulse rounded bg-muted" /><div className="h-3 w-3/4 animate-pulse rounded bg-muted" /></div>
          </div>)}
        </div>
      ) : props.drafts ? (
        props.drafts.length === 0 ? <Empty icon={<FileEdit />} text="Sem rascunhos." /> : props.drafts.map(draft => {
          const to = (draft.to_addresses || []).map(address => address.name || address.address).join(', ') || '(sem destinatário)';
          const account = accounts.find(item => item.id === draft.channel_id);
          return <button key={draft.id} type="button" className="webmail-row" onClick={() => props.onOpenDraft(draft)}>
            {unified && account && <span className="webmail-row-bar" style={{ background: account.color }} title={account.name} />}
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700"><FileEdit className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm font-medium text-destructive/90">Rascunho · <span className="text-foreground/80">Para: {to}</span></span><span className="shrink-0 text-[11px] text-muted-foreground">{fmtListDate(draft.updated_at)}</span></span>
              <span className="block truncate text-sm font-semibold">{draft.subject || '(sem assunto)'}</span>
              <span className="block truncate text-xs text-muted-foreground">{draftPreview(draft.body_html) || '(sem conteúdo)'}</span>
            </span>
          </button>;
        })
      ) : messages.length === 0 ? (
        <Empty icon={<Inbox />} text={props.emptyText} />
      ) : messages.map((message, index) => {
        const sender = props.sentView
          ? `Para: ${(message.to_addresses || []).map(address => address.name || address.address).join(', ') || '—'}`
          : message.from_name || message.from_address || '(desconhecido)';
        const account = accountOf(message);
        const isSelected = selected.has(message.id);
        return <div key={message.id} role="button" tabIndex={0} className="webmail-row group"
          data-unread={!message.seen} data-active={message.id === activeId} data-selected={isSelected}
          onClick={event => (event.shiftKey || selected.size > 0 ? toggle(index, event.shiftKey) : props.onOpen(message))}
          onKeyDown={event => { if (event.key === 'Enter') props.onOpen(message); if (event.key === ' ') { event.preventDefault(); toggle(index, event.shiftKey); } }}
          onMouseEnter={() => prefetch(message.id)} onMouseLeave={() => window.clearTimeout(hoverTimer.current)}>
          {unified && account && <span className="webmail-row-bar" style={{ background: account.color }} title={account.name} aria-label={`Caixa ${account.name}`} />}
          <span className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center">
            <span className={cn('webmail-row-avatar flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold', avatarTone(sender))} aria-hidden="true">{initials(props.sentView ? message.to_addresses?.[0]?.name || message.to_addresses?.[0]?.address || '?' : sender)}</span>
            <span className={cn('webmail-row-check h-9 w-9 items-center justify-center', isSelected && '!flex')} onClick={event => { event.stopPropagation(); toggle(index, event.shiftKey); }}>
              <Checkbox checked={isSelected} aria-label={`Selecionar email de ${sender}`} tabIndex={-1} />
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              {!message.seen && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Não lido" />}
              <span className={cn('min-w-0 flex-1 truncate text-sm', message.seen ? 'font-medium text-foreground/85' : 'font-bold')}>{sender}</span>
              {message.has_attachments && <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Tem anexos" />}
              <span className="shrink-0 text-[11px] text-muted-foreground">{fmtListDate(message.date)}</span>
            </span>
            <span className={cn('block truncate text-sm', message.seen ? 'text-foreground/75' : 'font-semibold')}>{message.subject || '(sem assunto)'}</span>
            <span className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{message.snippet || ''}</span>
              <button type="button" className="webmail-row-hover flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label={trashView ? 'Eliminar definitivamente' : 'Mover para o lixo'} title={trashView ? 'Eliminar definitivamente' : 'Mover para o lixo'}
                onClick={event => { event.stopPropagation(); if (trashView) props.onDeleteForever([message]); else void actions.trash([message]); }}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button type="button" className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', !message.flagged && 'webmail-row-hover')}
                aria-label={message.flagged ? 'Remover estrela' : 'Marcar com estrela'} aria-pressed={message.flagged}
                onClick={event => { event.stopPropagation(); actions.setFlag([message], !message.flagged); }}>
                <Star className={cn('h-3.5 w-3.5', message.flagged ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground hover:text-amber-500')} />
              </button>
            </span>
          </span>
        </div>;
      })}
      {props.onLoadMore && !props.loading && messages.length > 0 && <div className="p-3">
        <button type="button" onClick={props.onLoadMore} disabled={props.loadingMore}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60">
          {props.loadingMore ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />A carregar mais…</> : 'Carregar mais'}
        </button>
      </div>}
    </div>
  </section>;
}

function Empty({ icon, text }: { icon: ReactNode; text: string }) {
  return <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center text-muted-foreground">
    <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary [&>svg]:h-7 [&>svg]:w-7">{icon}</span>
    <span className="text-sm">{text}</span>
  </div>;
}
