import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { AlertTriangle, ArrowDownAZ, BellOff, GripVertical, Inbox, Layers, Loader2, MoreHorizontal, PenSquare, Plus, Settings2, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  SYSTEM_FOLDERS, countLabel, customFolderIcon, syncState, type MailAccount, type MailFolderKey, type MailScope, type WebmailFolder,
} from './webmail-model';

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
  return <div role="separator" aria-orientation="vertical" aria-label="Largura da barra lateral" aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={width}
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
}

export function MailSidebar({ accounts, folders, unreadByAccount, scope, folderKey, admin, onScope, onFolder, onCompose, onSettings, onAddAccount, onContactLists, onReorder }: SidebarProps) {
  const total = [...unreadByAccount.values()].reduce((sum, value) => sum + value, 0);
  const scopeIds = scope === 'all' ? accounts.map(account => account.id) : [scope];
  const scopeUnread = scopeIds.reduce((sum, id) => sum + (unreadByAccount.get(id) ?? 0), 0);
  const custom = scope === 'all' ? [] : folders.filter(folder => folder.channel_id === scope && folder.role === 'custom');
  const CustomIcon = customFolderIcon;
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="p-3 pb-1">
      <Button className="webmail-compose h-11 w-full justify-start gap-2 rounded-2xl px-4 text-sm font-semibold" onClick={onCompose} disabled={accounts.length === 0}>
        <PenSquare className="h-4 w-4" aria-hidden="true" />Escrever
      </Button>
    </div>
    <nav aria-label="Caixas e pastas" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <div className="flex items-center justify-between pr-1">
        <p className="webmail-section">Caixas</p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-muted-foreground" aria-label="Mais opções das caixas"><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onSelect={() => onReorder([...accounts].sort((a, b) => a.address.localeCompare(b.address, 'pt')).map(account => account.id))}>
              <ArrowDownAZ className="mr-2 h-4 w-4" />Ordenar por ordem alfabética
            </DropdownMenuItem>
            {admin && <DropdownMenuItem onSelect={onAddAccount}><Plus className="mr-2 h-4 w-4" />Ligar outra caixa</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {accounts.length > 1 && <button type="button" className="webmail-nav-row" aria-current={scope === 'all'} onClick={() => onScope('all')}>
        <Layers aria-hidden="true" /><span className="min-w-0 flex-1 truncate">Todas as caixas</span>
        {total > 0 && <span className="webmail-count">{countLabel(total)}</span>}
      </button>}
      <AccountList accounts={accounts} folders={folders} unreadByAccount={unreadByAccount} scope={scope} onScope={onScope} onSettings={onSettings} onReorder={onReorder} />
      {admin && accounts.length === 0 && <button type="button" className="webmail-nav-row text-primary" onClick={onAddAccount}><Plus aria-hidden="true" />Ligar caixa</button>}

      <p className="webmail-section mt-2">Pastas</p>
      {SYSTEM_FOLDERS.map(folder => {
        const Icon = folder.icon;
        const count = folder.key === 'unread' ? scopeUnread : 0;
        return <button key={folder.key} type="button" className="webmail-nav-row" aria-current={folderKey === folder.key} onClick={() => onFolder(folder.key)}>
          <Icon aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{folder.label}</span>
          {count > 0 && <span className="webmail-count">{countLabel(count)}</span>}
        </button>;
      })}
      {custom.map(folder => <button key={folder.id} type="button" className="webmail-nav-row" aria-current={folderKey === `custom:${folder.id}`} onClick={() => onFolder(`custom:${folder.id}`)}>
        <CustomIcon aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{folder.name}</span>
        {folder.unread_count > 0 && <span className="webmail-count">{countLabel(folder.unread_count)}</span>}
      </button>)}

      <p className="webmail-section mt-2">Contactos</p>
      <button type="button" className="webmail-nav-row" onClick={onContactLists}><UsersRound aria-hidden="true" />Listas de contactos</button>
    </nav>
  </div>;
}

/** Accounts in the person's order: drag the grip (mouse or touch) or use arrow keys on it. */
function AccountList({ accounts, folders, unreadByAccount, scope, onScope, onSettings, onReorder }: Pick<SidebarProps, 'accounts' | 'folders' | 'unreadByAccount' | 'scope' | 'onScope' | 'onSettings' | 'onReorder'>) {
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
        <button type="button" aria-label={`Mover ${account.name}`} className="webmail-grip -mr-1 flex h-9 w-5 shrink-0 items-center justify-center rounded text-muted-foreground"
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
          {!account.notify && <BellOff className="!h-3.5 !w-3.5 text-muted-foreground" aria-label="Avisos desligados" />}
          {health.state === 'connecting' && <Loader2 className="!h-3.5 !w-3.5 animate-spin text-muted-foreground" aria-label="A ligar" />}
          {(health.state === 'failed' || health.state === 'stale') && <Tooltip>
            <TooltipTrigger asChild><AlertTriangle className="!h-3.5 !w-3.5 text-amber-500" aria-label="Problema de ligação" /></TooltipTrigger>
            <TooltipContent>{health.state === 'failed' ? 'Ainda não sincronizou. Verifique os dados de ligação.' : 'Sem sincronizar há mais de 30 minutos.'}</TooltipContent>
          </Tooltip>}
          {unread > 0 && <span className="webmail-count">{countLabel(unread)}</span>}
        </button>
        <button type="button" aria-label={`Definições de ${account.name}`} className="webmail-gear flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          onClick={() => onSettings(account)}>
          <Settings2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>;
    })}
    {accounts.length === 0 && <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><Inbox className="h-4 w-4" aria-hidden="true" />Sem caixas ligadas.</p>}
  </div>;
}
