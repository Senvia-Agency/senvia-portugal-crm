import { useState } from 'react';
import { Mailbox, Inbox as InboxIcon, SlidersHorizontal, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MESSAGING_CHANNELS_ENABLED, isChannelEnabled } from '@/lib/constants';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usesInboxTables, type MessagingChannel } from '@/hooks/useMessagingChannels';
import { EmailFolderList } from '@/components/email/EmailFolderList';
import { useEmailFolders } from '@/hooks/useEmail';
import { useMetaUnreadTotals } from '@/hooks/useMetaInbox';

// Pastas que NAO contam para o total da caixa.
//
// Enviados e rascunhos sao nossos. Lixo e spam sao mensagens que a pessoa ja
// pos de lado — contar o lixo faz o distintivo pedir atencao para o que ja foi
// descartado, e o numero nunca desce.
const FORA_DO_TOTAL = new Set(['sent', 'drafts', 'trash', 'junk']);


function EmailChannelBadge({ channelId }: { channelId: string }) {
  const { data: folders = [] } = useEmailFolders(channelId);
  const unread = folders
    .filter((f) => !FORA_DO_TOTAL.has(f.role))
    .reduce((s, f) => s + (f.unread_count || 0), 0);
  if (!unread) return null;
  return (
    <span className="ml-1 shrink-0 rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold leading-none text-primary-foreground">
      {unread > 99 ? '99+' : unread}
    </span>
  );
}

function dotColor(ch: MessagingChannel) {
  if (ch.color) return ch.color;
  if (ch.channel_type === 'whatsapp') return '#25D366';
  if (ch.channel_type === 'instagram') return '#E4405F';
  if (ch.channel_type === 'facebook') return '#0084FF';
  return '#64748b';
}

function CountBadge({ n, active }: { n: number; active?: boolean }) {
  if (!n) return null;
  return (
    <span className={cn(
      'ml-1 shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold leading-none',
      active ? 'bg-primary text-primary-foreground' : 'bg-primary/15 text-primary',
    )}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

export function InboxCaixaRail({
  caixas,
  caixaFilter,
  metaChannelId,
  todasConversas,
  unreadByInbox,
  emailChannelId,
  emailFolderId,
  onSelectAll,
  onSelectMessaging,
  onSelectEmail,
  onSelectFolder,
  className,
}: {
  caixas: MessagingChannel[];
  caixaFilter: number | null;
  /** Caixa de Instagram/Messenger aberta, se houver. */
  metaChannelId?: string | null;
  /** Vista "Todas as conversas" ligada. */
  todasConversas?: boolean;
  unreadByInbox?: Map<number, number>;
  emailChannelId: string | null;
  emailFolderId: string | null;
  onSelectAll: () => void;
  onSelectMessaging: (ch: MessagingChannel) => void;
  onSelectEmail: (ch: MessagingChannel) => void;
  onSelectFolder: (folderId: string) => void;
  // Override the root layout (e.g. to render full-width inside a mobile Sheet).
  className?: string;
}) {
  const { data: metaUnread } = useMetaUnreadTotals();
  const [hidden, setHidden] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('inbox-rail-hidden-v1') || '[]'); } catch { return []; }
  });
  // Track which email caixas have their folder list expanded (independently of active caixa).
  const [openEmails, setOpenEmails] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('inbox-rail-open-emails-v1') || '[]'); } catch { return []; }
  });

  const isHidden = (id: string) => hidden.includes(id);
  const toggleHidden = (id: string) => setHidden((prev) => {
    const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    localStorage.setItem('inbox-rail-hidden-v1', JSON.stringify(next));
    return next;
  });
  const isFolderOpen = (id: string) => openEmails.includes(id);
  const toggleFolderOpen = (id: string, expand: boolean) => setOpenEmails((prev) => {
    const next = expand ? [...prev.filter((x) => x !== id), id] : prev.filter((x) => x !== id);
    localStorage.setItem('inbox-rail-open-emails-v1', JSON.stringify(next));
    return next;
  });

  const handleEmailClick = (ch: MessagingChannel) => {
    const wasOpen = isFolderOpen(ch.id);
    if (wasOpen) {
      // Collapse folder list (keeps email reader active if already selected).
      toggleFolderOpen(ch.id, false);
    } else {
      // Expand folder list; only switch caixa if it changed (avoids folderId reset flicker).
      toggleFolderOpen(ch.id, true);
      if (emailChannelId !== ch.id) {
        onSelectEmail(ch);
      }
    }
  };

  // Só os canais abertos aparecem — hoje email e WhatsApp por QR code; o
  // Instagram e o Messenger estão fechados. As caixas de um canal fechado continuam na base de
  // dados, apenas não são listadas (aqui e no seletor "Mostrar caixas", que lê
  // desta mesma lista).
  const visibleCaixas = caixas.filter((c) => isChannelEnabled(c.channel_type));
  const messaging = visibleCaixas.filter((c) => c.channel_type !== 'email' && !isHidden(c.id));
  const emails = caixas.filter((c) => c.channel_type === 'email' && !isHidden(c.id));
  const allActive = todasConversas === true;
  // As caixas da Meta e as do WhatsApp por QR code vivem nas nossas tabelas —
  // o contador delas vem de lá, não do Chatwoot. Sem isto ficavam sempre a
  // zero, e uma mensagem nova não dava sinal a quem não tivesse a caixa aberta.
  const unreadFor = (ch: MessagingChannel) =>
    usesInboxTables(ch)
      ? (metaUnread?.[ch.id] ?? 0)
      : ch.chatwoot_inbox_id != null ? (unreadByInbox?.get(ch.chatwoot_inbox_id) ?? 0) : 0;
  const totalUnread = messaging.reduce((s, ch) => s + unreadFor(ch), 0);

  return (
    <aside className={cn("hidden w-56 shrink-0 flex-col border-r bg-muted/20 lg:flex", className)}>
      <div className="flex items-center justify-between border-b px-3 py-3">
        <h1 className="px-1 text-sm font-semibold text-muted-foreground">Caixas</h1>
        {visibleCaixas.length > 1 && (
          <Popover>
            <PopoverTrigger asChild>
              <button title="Escolher caixas a mostrar" className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-60 p-1.5">
              <p className="px-2 py-1 text-xs font-semibold text-muted-foreground">Mostrar caixas</p>
              <div className="max-h-72 overflow-y-auto">
                {visibleCaixas.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => toggleHidden(c.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border', !isHidden(c.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                      {!isHidden(c.id) && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{c.label || (c.channel_type === 'email' ? 'Email' : 'WhatsApp')}</span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {/* Secção inteira escondida com os canais desligados: sem WhatsApp nem
            Instagram, "Todas as conversas" não teria nada para mostrar. */}
        {MESSAGING_CHANNELS_ENABLED && (
          <>
            <p className="px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mensagens</p>
            <button
              onClick={onSelectAll}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                allActive ? 'bg-primary/10 font-semibold text-primary' : 'text-foreground/80 hover:bg-accent',
              )}
            >
              <InboxIcon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">Todas as conversas</span>
              <CountBadge n={totalUnread} active={allActive} />
            </button>
          </>
        )}

        {messaging.map((ch) => {
          // Uma caixa da Meta identifica-se pelo id dela, não pelo do Chatwoot.
          // Comparar `caixaFilter === ch.chatwoot_inbox_id` dava `null === null`
          // em TODAS as caixas de Instagram ao mesmo tempo — e ficavam todas
          // acesas, incluindo "Todas as conversas".
          const active = usesInboxTables(ch)
            ? metaChannelId === ch.id
            : !emailChannelId && !metaChannelId && caixaFilter === ch.chatwoot_inbox_id;
          return (
            <button
              key={ch.id}
              onClick={() => onSelectMessaging(ch)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                active ? 'bg-primary/10 font-semibold text-primary' : 'text-foreground/80 hover:bg-accent',
              )}
            >
              <span
                className={cn('h-2.5 w-2.5 shrink-0 rounded-full', ch.archived_at && 'opacity-40')}
                style={{ background: dotColor(ch) }}
              />
              <span className={cn(
                'min-w-0 flex-1 truncate text-left',
                // Arquivada: continua na lista, porque as conversas continuam lá
                // para se lerem — mas não se confunde com uma caixa a receber.
                ch.archived_at && 'text-muted-foreground',
              )}>
                {ch.label || 'WhatsApp'}
              </span>
              {ch.archived_at
                ? <span className="shrink-0 text-[10px] text-muted-foreground">arquivada</span>
                : <CountBadge n={unreadFor(ch)} active={active} />}
            </button>
          );
        })}

        {emails.length > 0 && (
          <div className="mt-3 border-t pt-2">
            <p className="px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">E-mails</p>
            {emails.map((ch) => {
              const active = emailChannelId === ch.id;
              const expanded = isFolderOpen(ch.id);
              return (
                <div key={ch.id}>
                  <button
                    onClick={() => handleEmailClick(ch)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                      active ? 'font-semibold text-primary' : 'text-foreground/80 hover:bg-accent',
                    )}
                  >
                    <Mailbox className="h-4 w-4 shrink-0" style={ch.color ? { color: ch.color } : undefined} />
                    <span className="min-w-0 flex-1 truncate text-left">{ch.label || 'Email'}</span>
                    <EmailChannelBadge channelId={ch.id} />
                    {expanded
                      ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  </button>
                  {expanded && (
                    <EmailFolderList
                      channelId={ch.id}
                      activeFolderId={emailChannelId === ch.id ? emailFolderId : null}
                      isActive={emailChannelId === ch.id}
                      onSelect={(fid) => {
                        if (emailChannelId !== ch.id) onSelectEmail(ch);
                        onSelectFolder(fid);
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </nav>
    </aside>
  );
}
