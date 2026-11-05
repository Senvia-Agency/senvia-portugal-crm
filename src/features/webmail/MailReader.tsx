import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Archive, ArrowLeft, ChevronDown, Forward, FolderInput, Loader2, Mail, MailOpen, MoreHorizontal, Reply, ReplyAll, ShieldAlert, Star, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmailBody } from '@/components/email/EmailBody';
import { EmailWorkflowActions } from '@/components/email/EmailWorkflowActions';
import { addrText, fmtFullDate, folderLabel, initials, ROLE_META } from '@/components/email/emailShared';
import type { ComposeMode } from '@/components/email/EmailComposer';
import type { EmailAttachment, EmailMessage } from '@/hooks/useEmail';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n';
import { AttachmentTiles, fetchCachedAttachment, makeResolver } from './AttachmentTiles';
import { avatarTone } from './MailList';
import { readMessage } from './webmail-api';
import { useMailThread, type MailboxActions } from './useWebmail';
import type { MailAccount, WebmailFolder } from './webmail-model';

interface ReaderProps {
  readonly messageId: string;
  readonly account: MailAccount | undefined;
  readonly showAccount: boolean;
  readonly folders: readonly WebmailFolder[];
  readonly actions: MailboxActions;
  readonly onBack: () => void;
  readonly onClose: () => void;
  readonly onCompose: (mode: ComposeMode, message: EmailMessage, attachments: readonly EmailAttachment[]) => void;
  /** A new email to an address clicked inside a message, from the same caixa. */
  readonly onComposeTo?: (address: string, channelId: string) => void;
  readonly onDeleteForever: (messages: readonly EmailMessage[]) => void;
  readonly onOpened: (message: EmailMessage) => void;
}

const labelClass = 'webmail-tool-label';
const toolClass = 'h-8 shrink-0 gap-1.5 rounded-full px-1.5 text-[13px] [&_svg]:mr-0';

export function MailReader({ messageId, account, showAccount, folders, actions, onBack, onClose, onCompose, onComposeTo, onDeleteForever, onOpened }: ReaderProps) {
  const { t } = useLanguage();
  const opened = useQuery({ queryKey: ['email-message', messageId], queryFn: () => readMessage(messageId), staleTime: 30_000 });
  const message = opened.data?.message;
  const thread = useMailThread(message);
  const markedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!message || markedRef.current === message.id) return;
    markedRef.current = message.id;
    onOpened(message);
    if (!message.seen) actions.setRead([message], true);
  }, [message, actions, onOpened]);

  if (opened.isLoading) return <Placeholder><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label={t('A abrir o email')} /></Placeholder>;
  if (!message) return <Placeholder><p className="text-sm text-muted-foreground">{opened.error ? t('Não foi possível abrir este email.') : t('Este email já não está nesta pasta.')}</p></Placeholder>;

  const inTrash = folders.find(folder => folder.id === message.folder_id)?.role === 'trash';
  const moveTargets = folders.filter(folder => folder.channel_id === message.channel_id && folder.id !== message.folder_id && folder.role !== 'drafts');
  const conversation = [...(thread.data ?? []), message]
    .sort((a, b) => (Date.parse(b.date || '') || 0) - (Date.parse(a.date || '') || 0));
  const attachments = opened.data?.attachments ?? [];

  return <div className="inbox-email-reading flex min-h-0 flex-1 flex-col">
    <div className="flex flex-nowrap items-center gap-0.5 overflow-x-auto border-b bg-card px-2 py-1.5 sm:px-3" role="toolbar" aria-label={t('Ações do email')}>
      <Button variant="back" size="sm" className="webmail-back mr-1 h-9 rounded-full px-2.5" onClick={onBack}><ArrowLeft className="mr-1 h-4 w-4" />{t('Voltar')}</Button>
      <Button size="sm" variant="ghost" className={toolClass} aria-label={t('Responder')} title={t('Responder')} onClick={() => onCompose('reply', message, attachments)}><Reply className="h-4 w-4" /><span className={labelClass}>{t('Responder')}</span></Button>
      <Button size="sm" variant="ghost" className={toolClass} aria-label={t('Responder a todos')} title={t('Responder a todos')} onClick={() => onCompose('replyAll', message, attachments)}><ReplyAll className="h-4 w-4" /><span className={labelClass}>{t('Responder a todos')}</span></Button>
      <Button size="sm" variant="ghost" className={toolClass} aria-label={t('Reencaminhar')} title={t('Reencaminhar')} onClick={() => onCompose('forward', message, attachments)}><Forward className="h-4 w-4" /><span className={labelClass}>{t('Reencaminhar')}</span></Button>
      <EmailWorkflowActions key={message.id} message={message} labelClassName={labelClass} buttonClassName={toolClass} />
      <Button size="sm" variant="ghost" className={toolClass} aria-label={t('Marcar como não lido')} title={t('Marcar como não lido')} onClick={() => { actions.setRead([message], false); onClose(); }}><Mail className="h-4 w-4" /><span className={labelClass}>{t('Marcar como não lido')}</span></Button>
      <Button size="sm" variant="ghost" className={cn(toolClass, 'text-destructive hover:text-destructive')} aria-label={inTrash ? t('Eliminar definitivamente') : t('Lixo')} title={inTrash ? t('Eliminar definitivamente') : t('Mover para o lixo')}
        onClick={() => { if (inTrash) onDeleteForever([message]); else { void actions.trash([message]); onClose(); } }}>
        <Trash2 className="h-4 w-4" />
      </Button>
      <div className="flex-1" />
      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-full" aria-pressed={message.flagged} aria-label={message.flagged ? t('Remover estrela') : t('Marcar com estrela')} title={message.flagged ? t('Remover estrela') : t('Marcar com estrela')}
        onClick={() => actions.setFlag([message], !message.flagged)}>
        <Star className={cn('h-4 w-4', message.flagged && 'fill-amber-400 text-amber-400')} />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-full" aria-label={t('Mais ações')}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {!inTrash && <DropdownMenuItem onSelect={() => { void actions.archive([message]); onClose(); }}><Archive className="mr-2 h-4 w-4" />{t('Arquivar')}</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => { void actions.spam([message]); onClose(); }}><ShieldAlert className="mr-2 h-4 w-4" />{t('Marcar como spam')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.setRead([message], !message.seen)}><MailOpen className="mr-2 h-4 w-4" />{message.seen ? t('Marcar como não lido') : t('Marcar como lido')}</DropdownMenuItem>
          {moveTargets.length > 0 && <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground"><FolderInput className="h-3.5 w-3.5" />{t('Mover para')}</DropdownMenuLabel>
            {moveTargets.map(folder => {
              const Icon = ROLE_META[folder.role].Icon;
              return <DropdownMenuItem key={folder.id} onSelect={() => { void actions.move([message], folder.id); onClose(); }}><Icon className="mr-2 h-4 w-4" />{folderLabel(folder)}</DropdownMenuItem>;
            })}
          </>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">
      <article className="px-4 py-5 sm:px-8">
        <div className="mb-5 flex flex-wrap items-start gap-3">
          <h1 className="min-w-0 flex-1 break-words text-xl font-semibold leading-snug tracking-tight">{message.subject || t('(sem assunto)')}</h1>
          {showAccount && account && <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium"><span className="webmail-dot" style={{ background: account.color }} />{account.name}</span>}
        </div>
        {conversation.length > 1 && <p className="mb-3 text-xs font-medium text-muted-foreground">{t('Conversa com {{n}} mensagens', { n: conversation.length })}</p>}
        <div>
          {conversation.map(item => <ThreadMessage key={item.id} id={item.id} preview={item} primary={item.id === message.id} actions={actions} onComposeTo={onComposeTo} />)}
        </div>
      </article>
    </div>
  </div>;
}

/** One message of the conversation: the opened one starts expanded; the others load their body when opened. */
function ThreadMessage({ id, preview, primary, actions, onComposeTo }: { id: string; preview: EmailMessage; primary: boolean; actions: MailboxActions; onComposeTo?: (address: string, channelId: string) => void }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(primary);
  const ref = useRef<HTMLDivElement>(null);
  const full = useQuery({ queryKey: ['email-message', id], queryFn: () => readMessage(id), enabled: open, staleTime: 30_000 });
  const message = full.data?.message ?? preview;
  const requested = useRef(false);
  const [bodyError, setBodyError] = useState<string | null>(null);
  // In a long conversation the opened message scrolls into view inside the reader only (never the page).
  useEffect(() => {
    const element = ref.current;
    const scroller = element?.closest<HTMLElement>('.overflow-y-auto');
    if (!primary || !element || !scroller || element === scroller.querySelector('.webmail-thread-item')) return;
    scroller.scrollTop += element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
  }, [primary]);
  useEffect(() => {
    if (!open || !full.data || full.data.message.body_fetched || requested.current) return;
    requested.current = true;
    actions.fetchBody(id).catch(error => setBodyError(error instanceof Error ? error.message : t('Não foi possível carregar o conteúdo.')));
  }, [open, full.data, actions, id]);
  const resolve = useMemo(() => makeResolver(message.channel_id, actions.fetchAttachment), [message.channel_id, actions.fetchAttachment]);
  const who = message.from_name || message.from_address || t('(desconhecido)');
  if (!open) {
    return <div ref={ref} role="button" tabIndex={0} className="webmail-thread-item flex items-center gap-3 px-2 py-3" data-open="false"
      onClick={() => setOpen(true)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpen(true); } }}>
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold', avatarTone(who))} aria-hidden="true">{initials(who)}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2"><span className="truncate text-sm font-semibold">{who}</span><span className="ml-auto shrink-0 text-xs text-muted-foreground">{fmtFullDate(message.date)}</span></span>
        <span className="block truncate text-xs text-muted-foreground">{message.snippet}</span>
      </span>
      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </div>;
  }
  const attachments = full.data?.attachments ?? [];
  return <div ref={ref} className="webmail-thread-item" data-open="true">
    <header className="flex items-start gap-3 px-2 pb-2 pt-4" onClick={primary ? undefined : () => setOpen(false)}>
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold', avatarTone(who))} aria-hidden="true">{initials(who)}</span>
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold">{who}</span>
          {message.from_name && <span className="truncate text-xs text-muted-foreground">&lt;{message.from_address}&gt;</span>}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{fmtFullDate(message.date)}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{t('Para:')} {addrText(message.to_addresses) || '—'}{message.cc_addresses?.length ? ` · Cc: ${addrText(message.cc_addresses)}` : ''}</p>
      </div>
    </header>
    <div className="px-2 pb-5 pt-2">
      <AttachmentTiles attachments={attachments} resolve={resolve} />
      {full.isLoading ? <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('A abrir…')}</div>
        : message.body_fetched ? <div className="rounded-xl bg-white p-1 dark:bg-card">
          <EmailBody key={message.id} title={primary ? t('Email') : t('Email da conversa')} fitWidth html={message.html_body} text={message.text_body}
            inlineAttachments={attachments.filter(attachment => attachment.inline)}
            resolveAttachment={attachmentId => fetchCachedAttachment(message.channel_id, attachmentId, actions.fetchAttachment)}
            onComposeTo={onComposeTo ? address => onComposeTo(address, message.channel_id) : undefined} />
        </div>
        : bodyError ? <p role="alert" className="py-6 text-sm text-destructive">{t('Não foi possível carregar o conteúdo.')} {bodyError}</p>
        : <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('A carregar conteúdo…')}</div>}
    </div>
  </div>;
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-8 text-center">{children}</div>;
}

export function ReaderEmpty() {
  const { t } = useLanguage();
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
    <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Mail className="h-8 w-8" aria-hidden="true" /></span>
    <p className="text-sm text-muted-foreground">{t('Escolha um email para ler.')}</p>
  </div>;
}
