import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { EmailComposer, type ComposeMode } from '@/components/email/EmailComposer';
import { EditEmailModal } from '@/components/settings/EmailManager';
import type { EmailChannel } from '@/hooks/useEmailChannels';
import { useTeamMembers } from '@/hooks/useTeam';
import { useAuth } from '@/contexts/AuthContext';
import type { EmailAttachment, EmailDraft, EmailMessage } from '@/hooks/useEmail';
import { readEmailRecoveries, type EmailRecovery } from '@/lib/inbox-drafts';
import { MailSidebar, SidebarResizer, readSidebarWidth } from '@/features/webmail/MailSidebar';
import { MailList } from '@/features/webmail/MailList';
import { MailReader, ReaderEmpty } from '@/features/webmail/MailReader';
import { MailAccountDialog } from '@/features/webmail/MailAccountDialog';
import { ContactListsDialog } from '@/features/webmail/ContactListsDialog';
import { ConnectMailDialog, ProviderGrid } from '@/features/webmail/ConnectMail';
import { fetchCachedAttachment } from '@/features/webmail/AttachmentTiles';
import type { ProviderPreset } from '@/features/webmail/autodiscover';
import {
  useMailAccounts, useMailboxActions, useMailDrafts, useMailList, usePreferenceActions, useWebmailRealtime, useWebmailUnread,
} from '@/features/webmail/useWebmail';
import { defaultAccount, folderIdsFor, folderTitle, type MailAccount, type MailFolderKey, type MailScope } from '@/features/webmail/webmail-model';
import type { ListQuery } from '@/features/webmail/webmail-api';
import '@/features/webmail/webmail.css';

interface ComposeState {
  readonly key: string;
  readonly mode: ComposeMode;
  readonly channelId: string;
  readonly original: EmailMessage | null;
  readonly draft: EmailDraft | null;
  readonly attachments: EmailAttachment[];
  readonly recovered?: EmailRecovery;
}

const SCOPE_KEY = 'webmail-scope-v1';
function readScope(): MailScope | null {
  try { return localStorage.getItem(SCOPE_KEY); } catch { return null; }
}

export default function WebMail() {
  const { user, organization } = useAuth();
  const client = useQueryClient();
  const { accounts, admin, isLoading, preferencesError } = useMailAccounts();
  const preferenceActions = usePreferenceActions();
  const ids = useMemo(() => accounts.map(account => account.id), [accounts]);
  const unread = useWebmailUnread(accounts);
  const folders = useMemo(() => unread.folders.data ?? [], [unread.folders.data]);
  useWebmailRealtime(ids);
  const actions = useMailboxActions();
  const { data: members = [] } = useTeamMembers();

  const [scopeChoice, setScopeChoice] = useState<MailScope | null>(readScope);
  // "Todas as caixas" by default when there are several; a removed caixa falls back to that.
  const scope: MailScope = scopeChoice && (scopeChoice === 'all' ? accounts.length > 1 : ids.includes(scopeChoice))
    ? scopeChoice : accounts.length > 1 ? 'all' : ids[0] ?? 'all';
  const scopeIds = useMemo(() => (scope === 'all' ? ids : [scope]), [scope, ids]);
  const [folderKey, setFolderKey] = useState<MailFolderKey>('inbox');
  const [search, setSearch] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  useEffect(() => { const timer = window.setTimeout(() => setSearchTerm(search.trim()), 400); return () => window.clearTimeout(timer); }, [search]);
  const [openId, setOpenId] = useState<string | null>(null);
  // In "Não lidos" an opened email stays listed (now read) until the view changes, as in Realize.
  const [kept, setKept] = useState<ReadonlyMap<string, EmailMessage>>(new Map());
  const viewKey = `${scope}|${folderKey}|${searchTerm}`;
  useEffect(() => { setOpenId(null); setKept(new Map()); }, [viewKey]);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [width, setWidth] = useState(readSidebarWidth);
  const [settingsFor, setSettingsFor] = useState<MailAccount | null>(null);
  const [editing, setEditing] = useState<MailAccount | null>(null);
  const [picking, setPicking] = useState(false);
  const [provider, setProvider] = useState<ProviderPreset | null>(null);
  const [listsOpen, setListsOpen] = useState(false);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [deleteForever, setDeleteForever] = useState<readonly EmailMessage[] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const chooseScope = (next: MailScope) => {
    setScopeChoice(next);
    try { localStorage.setItem(SCOPE_KEY, next); } catch { /* private mode */ }
    setSheetOpen(false);
  };
  const chooseFolder = (key: MailFolderKey) => { setFolderKey(key); setSearch(''); setSheetOpen(false); };

  // What the list shows -----------------------------------------------------------------------
  const searching = searchTerm.length >= 2;
  const isDrafts = folderKey === 'drafts' && !searching;
  const viewFolderIds = useMemo(() => {
    if (folderKey === 'inbox' || folderKey === 'unread') return folderIdsFor(folders, scopeIds, 'inbox');
    if (folderKey.startsWith('custom:')) return [folderKey.slice(7)];
    if (folderKey === 'starred' || folderKey === 'drafts') return [];
    return folderIdsFor(folders, scopeIds, folderKey as 'sent' | 'archive' | 'junk' | 'trash');
  }, [folderKey, folders, scopeIds]);
  const query: ListQuery = searching ? { channelIds: scopeIds, folderIds: null, search: searchTerm }
    : folderKey === 'starred' ? { channelIds: scopeIds, folderIds: null, starred: true }
    : { channelIds: scopeIds, folderIds: viewFolderIds, unread: folderKey === 'unread' };
  const list = useMailList(query, !isDrafts && scopeIds.length > 0 && (searching || folderKey === 'starred' || viewFolderIds.length > 0));
  const drafts = useMailDrafts(scopeIds, isDrafts);
  const messages = useMemo(() => {
    const fromServer = (list.data ?? []).filter(message => !actions.hidden.has(message.id));
    if (folderKey !== 'unread' || searching || kept.size === 0) return fromServer;
    const merged = new Map(fromServer.map(message => [message.id, message]));
    kept.forEach((message, id) => { if (!merged.has(id) && !actions.hidden.has(id)) merged.set(id, { ...message, seen: true }); });
    return [...merged.values()].sort((a, b) => (Date.parse(b.date || '') || 0) - (Date.parse(a.date || '') || 0));
  }, [list.data, actions.hidden, folderKey, searching, kept]);

  // "Carregar mais" asks the gateway for the next older batch; the spinner stops when the list grows.
  const previousCount = useRef(messages.length);
  useEffect(() => { if (messages.length !== previousCount.current) { previousCount.current = messages.length; setLoadingMore(false); } }, [messages.length]);
  const viewFolders = folders.filter(folder => viewFolderIds.includes(folder.id));
  const loadMore = !searching && !isDrafts && folderKey !== 'starred' && viewFolders.length > 0 ? () => {
    setLoadingMore(true);
    void (folderKey === 'unread' ? actions.syncUnread(viewFolders) : actions.loadOlder(viewFolders));
    window.setTimeout(() => setLoadingMore(false), 15_000);
  } : null;
  const unreadInView = viewFolders.reduce((sum, folder) => sum + (folder.unread_count || 0), 0);
  const markAllRead = !searching && (folderKey === 'inbox' || folderKey === 'unread' || folderKey.startsWith('custom:')) && unreadInView > 0
    ? () => actions.markFolderRead(viewFolders) : null;

  // Composer ------------------------------------------------------------------------------------
  const composeAccounts = useMemo(() => accounts.map(account => ({ id: account.id, name: account.name, address: account.address })), [accounts]);
  const openComposer = (next: Omit<ComposeState, 'key'>) => {
    if (compose) { toast.info('Já tem uma mensagem aberta', { description: 'Envie ou feche essa mensagem antes de escrever outra.' }); return; }
    setCompose({ ...next, key: crypto.randomUUID() });
  };
  const writeNew = () => {
    const from = scope !== 'all' ? accounts.find(account => account.id === scope) : defaultAccount(accounts);
    if (from) openComposer({ mode: 'new', channelId: from.id, original: null, draft: null, attachments: [] });
  };
  // A message being written when the page was left comes back once.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !user || !organization || accounts.length === 0) return;
    restored.current = true;
    for (const account of accounts) {
      const recovered = readEmailRecoveries(`${user.id}:${organization.id}`, account.id)[0];
      if (recovered) { setCompose({ key: recovered.id, mode: 'new', channelId: account.id, original: null, draft: null, attachments: [], recovered }); break; }
    }
  }, [accounts, user, organization]);

  const onOpened = useCallback((message: EmailMessage) => {
    if (folderKey === 'unread') setKept(previous => (previous.has(message.id) ? previous : new Map(previous).set(message.id, message)));
  }, [folderKey]);

  const showGrid = !isLoading && (picking || accounts.length === 0);
  const openAccount = accounts.find(account => account.id === (list.data ?? []).find(message => message.id === openId)?.channel_id);

  if (!user || !organization) return <p className="p-6 text-muted-foreground">Selecione uma organização para abrir o email.</p>;

  const sidebar = <MailSidebar accounts={accounts} folders={folders} unreadByAccount={unread.byAccount} scope={scope} folderKey={folderKey} admin={admin}
    onScope={chooseScope} onFolder={chooseFolder} onCompose={() => { setSheetOpen(false); writeNew(); }}
    onSettings={account => { setSheetOpen(false); setSettingsFor(account); }}
    onAddAccount={() => { setSheetOpen(false); setPicking(true); }} onContactLists={() => { setSheetOpen(false); setListsOpen(true); }}
    onReorder={order => preferenceActions.reorder.mutate(order, { onError: () => toast.error('Não foi possível guardar a ordem das caixas.') })} />;

  return <div className="webmail-page">
    {preferencesError && <p role="status" className="shrink-0 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      {preferencesError} Até lá, o email funciona, mas nomes, cores, ordem, avisos, assinaturas pessoais e listas de contactos não são guardados.
    </p>}
    <div className="webmail" style={{ '--webmail-sidebar': `${width}px` } as CSSProperties} data-open={openId ? 'message' : 'list'} data-selecting={selecting}>
      <aside className="webmail-sidebar" aria-label="Email">
        {sidebar}
        <SidebarResizer width={width} onWidth={setWidth} />
      </aside>
      {isLoading ? <div className="col-span-full flex items-center justify-center lg:col-span-2"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="A carregar" /></div>
        : showGrid ? <div className="col-span-full min-h-0 overflow-y-auto lg:col-span-2">
          <ProviderGrid admin={admin} onPick={setProvider} onBack={accounts.length > 0 ? () => setPicking(false) : undefined} />
        </div>
        : <>
          <MailList title={searching ? `Resultados para "${searchTerm}"` : folderTitle(folderKey, folders)} resetKey={viewKey}
            accounts={accounts} unified={scope === 'all'} sentView={folderKey === 'sent' && !searching} trashView={folderKey === 'trash' && !searching}
            messages={messages} drafts={isDrafts ? drafts.data ?? [] : null}
            loading={isDrafts ? drafts.isLoading : list.isLoading || unread.folders.isLoading} refreshing={list.isFetching || drafts.isFetching}
            search={search} onSearch={setSearch} activeId={openId} onOpen={message => setOpenId(message.id)}
            onOpenDraft={draft => openComposer({ mode: 'new', channelId: draft.channel_id, original: null, draft, attachments: [] })}
            onRefresh={() => { void client.invalidateQueries({ queryKey: ['email-messages'] }); void client.invalidateQueries({ queryKey: ['email-folders'] }); void client.invalidateQueries({ queryKey: ['email-drafts'] }); }}
            onMenu={() => setSheetOpen(true)} onLoadMore={loadMore} loadingMore={loadingMore} onMarkAllRead={markAllRead}
            onDeleteForever={setDeleteForever} actions={actions} onSelecting={setSelecting}
            emptyText={searching ? 'Nenhum email encontrado.' : folderKey === 'unread' ? 'Não há emails por ler.' : folderKey === 'starred' ? 'Sem emails com estrela.' : 'Esta pasta está vazia.'} />
          <section className="webmail-reader" aria-label="Leitura">
            {openId ? <MailReader key={openId} messageId={openId} account={openAccount} showAccount={scope === 'all'} folders={folders} actions={actions}
              onBack={() => setOpenId(null)} onClose={() => setOpenId(null)} onOpened={onOpened} onDeleteForever={setDeleteForever}
              onCompose={(mode, message, attachments) => openComposer({ mode, channelId: message.channel_id, original: message, draft: null, attachments: mode === 'forward' ? [...attachments] : [] })} />
              : <ReaderEmpty />}
          </section>
        </>}
    </div>

    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
      <SheetContent side="left" className="webmail-sheet top-[calc(3.5rem+env(safe-area-inset-top,0px))] h-[calc(100dvh-3.5rem-env(safe-area-inset-top,0px))] w-80 p-0 lg:top-0 lg:h-full [&>button]:right-2 [&>button]:top-2 [&>button]:h-10 [&>button]:w-10" aria-describedby={undefined}>
        <SheetHeader className="border-b px-4 py-3 pr-14 text-left"><SheetTitle>Email</SheetTitle></SheetHeader>
        <div className="flex h-[calc(100%-3.5rem)] flex-col">{sidebar}</div>
      </SheetContent>
    </Sheet>

    {compose && <EmailComposer key={compose.key} onClose={() => { setCompose(null); void client.invalidateQueries({ queryKey: ['email-drafts'] }); }} channelId={compose.channelId} folderId={null} mode={compose.mode}
      original={compose.original} initialDraft={compose.draft} recoveryId={compose.key} recovered={compose.recovered} stackIndex={0}
      selfAddress={accounts.find(account => account.id === compose.channelId)?.address}
      originalAttachments={compose.attachments}
      resolveAttachment={attachmentId => fetchCachedAttachment(compose.channelId, attachmentId, actions.fetchAttachment)}
      webmail={{ accounts: composeAccounts }} />}
    {settingsFor && <MailAccountDialog key={settingsFor.id} account={settingsFor} folders={folders} admin={admin} onClose={() => setSettingsFor(null)}
      onEditConnection={() => { setEditing(settingsFor); setSettingsFor(null); }} />}
    {editing && <EditEmailModal open channel={editing.channel as unknown as EmailChannel} onOpenChange={open => { if (!open) setEditing(null); }}
      members={members.map(member => ({ id: member.id, user_id: member.user_id, full_name: member.full_name }))} />}
    {listsOpen && <ContactListsDialog onClose={() => setListsOpen(false)} />}
    {provider && <ConnectMailDialog provider={provider} onClose={() => setProvider(null)}
      onConnected={channelId => { setProvider(null); setPicking(false); chooseScope(channelId); setFolderKey('inbox'); }} />}
    <AlertDialog open={deleteForever !== null} onOpenChange={open => { if (!open) setDeleteForever(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Eliminar definitivamente?</AlertDialogTitle>
          <AlertDialogDescription>{deleteForever?.length === 1 ? 'Este email é apagado do servidor de correio e não pode ser recuperado.' : `Estes ${deleteForever?.length ?? 0} emails são apagados do servidor de correio e não podem ser recuperados.`}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => {
            const targets = deleteForever ?? [];
            setDeleteForever(null);
            if (targets.some(message => message.id === openId)) setOpenId(null);
            void actions.deletePermanently(targets);
          }}>Eliminar definitivamente</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
