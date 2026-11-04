import { Fragment, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import {
  AlertTriangle, ArrowDownAZ, BellOff, Check, FolderPlus, GripVertical, Inbox, Layers, Loader2, MoreHorizontal, PenSquare, Pencil, Plus, Settings2, Trash2, UsersRound, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n';
import {
  SYSTEM_FOLDERS, countLabel, customFolderIcon, folderNameError, isSubfolderOf, syncState, type MailAccount, type MailFolderKey, type MailScope, type WebmailFolder,
} from './webmail-model';

/** Inline name field for a new or renamed folder: Enter saves, Escape cancels. */
function FolderNameField({ depth, initial, onSubmit, onCancel }: {
  readonly depth: number;
  readonly initial: string;
  readonly onSubmit: (name: string) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [value, setValue] = useState(initial);
  const error = value.trim() ? folderNameError(value) : null;
  const valid = !folderNameError(value) && value.trim() !== initial;
  return <form className="py-1 pr-1" style={{ paddingLeft: `${0.5 + depth * 0.875}rem` }}
    onSubmit={event => { event.preventDefault(); if (valid) onSubmit(value.trim()); }}>
    <div className="flex items-center gap-1">
      <Input autoFocus value={value} maxLength={60} onChange={event => setValue(event.target.value)}
        onKeyDown={event => { if (event.key === 'Escape') onCancel(); }}
        aria-label={initial ? t('Novo nome da pasta') : t('Nome da nova pasta')} aria-invalid={!!error}
        className="h-8 min-w-0 flex-1 rounded-lg px-2 text-sm" />
      <Button type="submit" size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-full" aria-label={t('Guardar pasta')} disabled={!valid}><Check className="h-4 w-4" /></Button>
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-full" aria-label={t('Cancelar')} onClick={onCancel}><X className="h-4 w-4" /></Button>
    </div>
    {error && <p className="mt-1 text-[11px] text-destructive" role="alert">{t(error)}</p>}
  </form>;
}

const WIDTH_KEY = 'webmail-sidebar-width-v1';
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 250;
export function readSidebarWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return saved >= MIN_WIDTH && saved <= MAX_WIDTH ? saved : DEFAULT_WIDTH;
  } catch { return DEFAULT_WIDTH; }
}

/** Drag, arrows (16px) or double-click (back to 250px); the width is remembered in this browser. */
export function SidebarResizer({ width, onWidth }: { width: number; onWidth: (width: number) => void }) {
  const { t } = useLanguage();
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; width: number } | null>(null);
  const clamp = (value: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)));
  const commit = (value: number) => {
    onWidth(value);
    try { localStorage.setItem(WIDTH_KEY, String(value)); } catch { /* private mode */ }
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width };
    setDragging(true);
  };
  return <div role="separator" aria-orientation="vertical" aria-label={t('Largura da barra lateral')} aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={width}
    tabIndex={0} className="webmail-resizer" data-dragging={dragging}
    onPointerDown={onPointerDown}
    onPointerMove={event => { if (start.current) onWidth(clamp(start.current.width + event.clientX - start.current.x)); }}
    onPointerUp={() => { if (start.current) commit(width); start.current = null; setDragging(false); }}
    onPointerCancel={() => { start.current = null; setDragging(false); }}
    onDoubleClick={() => commit(DEFAULT_WIDTH)}
    onKeyDown={event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        commit(clamp(width + (event.key === 'ArrowRight' ? 16 : -16)));
      }
    }} />;
}

interface SidebarProps {
  readonly accounts: readonly MailAccount[];
  readonly folders: readonly WebmailFolder[];
  readonly unreadByAccount: ReadonlyMap<string, number>;
  readonly scope: MailScope;
  readonly folderKey: MailFolderKey;
  readonly admin: boolean;
  readonly onScope: (scope: MailScope) => void;
  readonly onFolder: (key: MailFolderKey) => void;
  readonly onCompose: () => void;
  readonly onSettings: (account: MailAccount) => void;
  readonly onAddAccount: () => void;
  readonly onContactLists: () => void;
  readonly onReorder: (ids: readonly string[]) => void;
  readonly onCreateFolder: (channelId: string, name: string, parentFolderId: string | null) => void;
  readonly onRenameFolder: (folder: WebmailFolder, name: string) => void;
  readonly onDeleteFolder: (folder: WebmailFolder) => void;
}

type FolderEdit = { readonly mode: 'create'; readonly parentId: string | null } | { readonly mode: 'rename'; readonly folder: WebmailFolder };

export function MailSidebar({ accounts, folders, unreadByAccount, scope, folderKey, admin, onScope, onFolder, onCompose, onSettings, onAddAccount, onContactLists, onReorder, onCreateFolder, onRenameFolder, onDeleteFolder }: SidebarProps) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState<FolderEdit | null>(null);
  useEffect(() => { setEditing(null); }, [scope]);
  const total = [...unreadByAccount.values()].reduce((sum, value) => sum + value, 0);
  const scopeIds = scope === 'all' ? accounts.map(account => account.id) : [scope];
  const scopeUnread = scopeIds.reduce((sum, id) => sum + (unreadByAccount.get(id) ?? 0), 0);
  // Subfolders right under their parent.
  const custom = scope === 'all' ? [] : folders.filter(folder => folder.channel_id === scope && folder.role === 'custom')
    .sort((a, b) => a.path.localeCompare(b.path, 'pt'));
  const CustomIcon = customFolderIcon;
  const nameField = (depth: number, initial = '') => <FolderNameField key="folder-name" depth={depth} initial={initial}
    onCancel={() => setEditing(null)}
    onSubmit={name => {
      if (editing?.mode === 'rename') onRenameFolder(editing.folder, name);
      else if (editing && scope !== 'all') onCreateFolder(scope, name, editing.parentId);
      setEditing(null);
    }} />;
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="p-3 pb-1">
      <Button data-otto-target="guide-email-compose" className="webmail-compose h-11 w-full justify-start gap-2 rounded-2xl px-4 text-sm font-semibold" onClick={onCompose} disabled={accounts.length === 0}>
        <PenSquare className="h-4 w-4" aria-hidden="true" />{t('Escrever')}
      </Button>
    </div>
    <nav aria-label={t('Caixas e pastas')} data-otto-target="guide-email-folders" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <div className="flex items-center justify-between pr-1">
        <p className="webmail-section">{t('Caixas')}</p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-muted-foreground" aria-label={t('Mais opções das caixas')}><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onSelect={() => onReorder([...accounts].sort((a, b) => a.address.localeCompare(b.address, 'pt')).map(account => account.id))}>
              <ArrowDownAZ className="mr-2 h-4 w-4" />{t('Ordenar por ordem alfabética')}
            </DropdownMenuItem>
            {admin && <DropdownMenuItem onSelect={onAddAccount}><Plus className="mr-2 h-4 w-4" />{t('Ligar outra caixa')}</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {accounts.length > 1 && <button type="button" className="webmail-nav-row" aria-current={scope === 'all'} onClick={() => onScope('all')}>
        <Layers aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{t('Todas as caixas')}</span>
        {total > 0 && <span className="webmail-count">{countLabel(total)}</span>}
      </button>}
      <AccountList accounts={accounts} folders={folders} unreadByAccount={unreadByAccount} scope={scope} onScope={onScope} onSettings={onSettings} onReorder={onReorder} />
      {admin && accounts.length === 0 && <button type="button" className="webmail-nav-row text-primary" onClick={onAddAccount}><Plus aria-hidden="true" />{t('Ligar caixa')}</button>}

      <div className="mt-2 flex items-center justify-between pr-1">
        <p className="webmail-section">{t('Pastas')}</p>
        {scope !== 'all' && <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-muted-foreground" aria-label={t('Nova pasta')} title={t('Nova pasta')}
          onClick={() => setEditing({ mode: 'create', parentId: null })}><FolderPlus className="h-4 w-4" /></Button>}
      </div>
      {SYSTEM_FOLDERS.map(folder => {
        const Icon = folder.icon;
        const count = folder.key === 'unread' ? scopeUnread : 0;
        return <button key={folder.key} type="button" className="webmail-nav-row" aria-current={folderKey === folder.key} onClick={() => onFolder(folder.key)}>
          <Icon aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{t(folder.label)}</span>
          {count > 0 && <span className="webmail-count">{countLabel(count)}</span>}
        </button>;
      })}
      {custom.map(folder => {
        const depth = custom.filter(other => isSubfolderOf(folder, other)).length;
        if (editing?.mode === 'rename' && editing.folder.id === folder.id) return nameField(depth, folder.name);
        // Deleting a mail-server folder deletes what is inside, so only an empty one goes.
        const deletable = folder.total_count === 0 && !custom.some(other => isSubfolderOf(other, folder));
        return <Fragment key={folder.id}>
          <div className="group/folder relative">
            <button type="button" className="webmail-nav-row" style={depth ? { paddingLeft: `${0.75 + depth * 0.875}rem` } : undefined}
              aria-current={folderKey === `custom:${folder.id}`} onClick={() => onFolder(`custom:${folder.id}`)}>
              <CustomIcon aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{folder.name}</span>
              {folder.unread_count > 0 && <span className="webmail-count group-hover/folder:opacity-0">{countLabel(folder.unread_count)}</span>}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t('Opções da pasta {{name}}', { name: folder.name })}
                  className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover/folder:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem onSelect={() => setEditing({ mode: 'create', parentId: folder.id })}><FolderPlus className="mr-2 h-4 w-4" />{t('Nova subpasta')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setEditing({ mode: 'rename', folder })}><Pencil className="mr-2 h-4 w-4" />{t('Renomear')}</DropdownMenuItem>
                <DropdownMenuItem disabled={!deletable} className="text-destructive focus:text-destructive" onSelect={() => onDeleteFolder(folder)}>
                  <Trash2 className="mr-2 h-4 w-4" />{deletable ? t('Apagar pasta') : t('Apagar (só se estiver vazia)')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {editing?.mode === 'create' && editing.parentId === folder.id && nameField(depth + 1)}
        </Fragment>;
      })}
      {editing?.mode === 'create' && editing.parentId === null && nameField(0)}

      <p className="webmail-section mt-2">{t('Contactos')}</p>
      <button type="button" className="webmail-nav-row" onClick={onContactLists}><UsersRound aria-hidden="true" />{t('Listas de contactos')}</button>
    </nav>
  </div>;
}

/** Accounts in the person's order: drag the grip (mouse or touch) or use arrow keys on it. */
function AccountList({ accounts, folders, unreadByAccount, scope, onScope, onSettings, onReorder }: Pick<SidebarProps, 'accounts' | 'folders' | 'unreadByAccount' | 'scope' | 'onScope' | 'onSettings' | 'onReorder'>) {
  const { t } = useLanguage();
  const [drag, setDrag] = useState<{ id: string; over: string | null; after: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const ids = accounts.map(account => account.id);
  const move = (id: string, target: string | null, after: boolean) => {
    if (!target || target === id) return;
    const rest = ids.filter(item => item !== id);
    const at = rest.indexOf(target) + (after ? 1 : 0);
    onReorder([...rest.slice(0, at), id, ...rest.slice(at)]);
  };
  useEffect(() => {
    if (!drag) return;
    const up = () => { move(drag.id, drag.over, drag.after); setDrag(null); };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  });
  return <div ref={listRef} role="list" onPointerMove={event => {
    if (!drag) return;
    const row = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-account-id]');
    if (!row || !listRef.current?.contains(row)) return;
    const box = row.getBoundingClientRect();
    setDrag({ ...drag, over: row.dataset.accountId ?? null, after: event.clientY > box.top + box.height / 2 });
  }}>
    {accounts.map(account => {
      const unread = unreadByAccount.get(account.id) ?? 0;
      const health = syncState(account, folders);
      const dropping = drag && drag.over === account.id && drag.id !== account.id ? (drag.after ? 'after' : 'before') : undefined;
      return <div key={account.id} role="listitem" className="webmail-account flex items-center" data-account-id={account.id}
        data-dragging={drag?.id === account.id} data-drop={dropping} data-active={scope === account.id}>
        <button type="button" aria-label={t('Mover {{name}}', { name: account.name })} className="webmail-grip -mr-1 flex h-9 w-5 shrink-0 items-center justify-center rounded text-muted-foreground"
          onPointerDown={event => { event.preventDefault(); setDrag({ id: account.id, over: null, after: false }); }}
          onKeyDown={event => {
            const index = ids.indexOf(account.id);
            if (event.key === 'ArrowUp' && index > 0) { event.preventDefault(); move(account.id, ids[index - 1], false); }
            if (event.key === 'ArrowDown' && index < ids.length - 1) { event.preventDefault(); move(account.id, ids[index + 1], true); }
          }}>
          <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button type="button" className="webmail-nav-row min-w-0 flex-1 pr-1" aria-current={scope === account.id} onClick={() => onScope(account.id)} title={account.address}>
          <span className="webmail-dot" style={{ background: account.color } as CSSProperties} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{account.name}</span>
          {!account.notify && <BellOff className="!h-3.5 !w-3.5 text-muted-foreground" aria-label={t('Avisos desligados')} />}
          {health.state === 'connecting' && <Loader2 className="!h-3.5 !w-3.5 animate-spin text-muted-foreground" aria-label={t('A ligar')} />}
          {(health.state === 'failed' || health.state === 'stale') && <Tooltip>
            <TooltipTrigger asChild><AlertTriangle className="!h-3.5 !w-3.5 text-amber-500" aria-label={t('Problema de ligação')} /></TooltipTrigger>
            <TooltipContent>{health.state === 'failed' ? t('Ainda não sincronizou. Verifique os dados de ligação.') : t('Sem sincronizar há mais de 30 minutos.')}</TooltipContent>
          </Tooltip>}
          {unread > 0 && <span className="webmail-count">{countLabel(unread)}</span>}
        </button>
        <button type="button" aria-label={t('Definições de {{name}}', { name: account.name })} className="webmail-gear flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          onClick={() => onSettings(account)}>
          <Settings2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>;
    })}
    {accounts.length === 0 && <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><Inbox className="h-4 w-4" aria-hidden="true" />{t('Sem caixas ligadas.')}</p>}
  </div>;
}
