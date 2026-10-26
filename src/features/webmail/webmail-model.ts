import {
  Archive, FileText, Inbox, MailWarning, Send, ShieldAlert, Star, Trash2, Folder, type LucideIcon,
} from 'lucide-react';
import type { EmailFolder, EmailFolderRole } from '@/hooks/useEmail';
import type { MessagingChannel } from '@/hooks/useMessagingChannels';

/** Swatches offered for a mailbox, as in the caixa settings. */
export const ACCOUNT_COLORS = ['#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#ef4444', '#f97316', '#f59e0b', '#22c55e', '#14b8a6', '#64748b'] as const;

export interface AccountPreference {
  readonly channel_id: string;
  readonly label: string | null;
  readonly color: string | null;
  readonly notify: boolean;
  readonly is_default: boolean;
  readonly position: number | null;
}

/** A caixa as one person sees it in the WebMail: the admin's caixa plus their own preferences. */
export interface MailAccount {
  readonly id: string;
  readonly address: string;
  /** The person's own name for it, else the caixa name, else the address. */
  readonly name: string;
  /** The caixa name every member sees (set by the admin). */
  readonly sharedName: string;
  readonly color: string;
  readonly notify: boolean;
  readonly isDefault: boolean;
  readonly position: number | null;
  readonly assignedUserIds: readonly string[];
  readonly status: string;
  readonly createdAt: string | null;
  readonly channel: MessagingChannel;
}

export type MailScope = 'all' | string;
/** Folder roles plus the two filters Realize shows as folders. */
export type MailFolderKey = 'inbox' | 'unread' | 'starred' | Exclude<EmailFolderRole, 'inbox' | 'custom'> | `custom:${string}`;

export interface SystemFolder {
  readonly key: MailFolderKey;
  readonly label: string;
  readonly icon: LucideIcon;
}

/** Realize's order: Entrada, Não lidos, Com estrela, Enviados, Rascunhos, Arquivo, Spam, Lixo. */
export const SYSTEM_FOLDERS: readonly SystemFolder[] = [
  { key: 'inbox', label: 'Entrada', icon: Inbox },
  { key: 'unread', label: 'Não lidos', icon: MailWarning },
  { key: 'starred', label: 'Com estrela', icon: Star },
  { key: 'sent', label: 'Enviados', icon: Send },
  { key: 'drafts', label: 'Rascunhos', icon: FileText },
  { key: 'archive', label: 'Arquivo', icon: Archive },
  { key: 'junk', label: 'Spam', icon: ShieldAlert },
  { key: 'trash', label: 'Lixo', icon: Trash2 },
];

export function folderTitle(key: MailFolderKey, folders: readonly WebmailFolder[]): string {
  if (key.startsWith('custom:')) return folders.find(folder => folder.id === key.slice(7))?.name ?? 'Pasta';
  return SYSTEM_FOLDERS.find(folder => folder.key === key)?.label ?? 'Entrada';
}
export const customFolderIcon = Folder;

export interface WebmailFolder extends EmailFolder {
  readonly last_synced_at: string | null;
}

/** Who may open a caixa's mail: same rule as `pode_aceder_caixa` (admins, assignees, or everyone when nobody is assigned). */
export function canOpenCaixa(channel: Pick<MessagingChannel, 'assigned_user_ids'>, userId: string, admin: boolean): boolean {
  const assigned = channel.assigned_user_ids ?? [];
  return admin || assigned.length === 0 || assigned.includes(userId);
}

export function buildAccounts(channels: readonly MessagingChannel[], preferences: readonly AccountPreference[], userId: string, admin: boolean): MailAccount[] {
  const byChannel = new Map(preferences.map(preference => [preference.channel_id, preference]));
  const accounts = channels
    .filter(channel => channel.channel_type === 'email' && !channel.archived_at && canOpenCaixa(channel, userId, admin))
    .map((channel, index): MailAccount => {
      const preference = byChannel.get(channel.id);
      const address = String((channel.metadata as { email_address?: unknown } | null)?.email_address ?? '');
      const sharedName = channel.label?.trim() || address || 'Email';
      return {
        id: channel.id, address, sharedName, channel,
        name: preference?.label?.trim() || sharedName,
        color: preference?.color || channel.color || ACCOUNT_COLORS[index % ACCOUNT_COLORS.length],
        notify: preference?.notify ?? true,
        isDefault: preference?.is_default ?? false,
        position: preference?.position ?? null,
        assignedUserIds: channel.assigned_user_ids ?? [],
        status: channel.status,
        createdAt: channel.created_at ?? null,
      };
    });
  // Saved order first; caixas never ordered go last, in the order they were connected.
  return accounts
    .map((account, index) => ({ account, index }))
    .sort((a, b) => (a.account.position ?? 10_000 + a.index) - (b.account.position ?? 10_000 + b.index))
    .map(({ account }) => account);
}

/** The caixa "Escrever" opens with: the chosen default, else the first. */
export function defaultAccount(accounts: readonly MailAccount[]): MailAccount | undefined {
  return accounts.find(account => account.isDefault) ?? accounts[0];
}

export type SyncState = 'ok' | 'connecting' | 'stale' | 'failed';
/** Connection health read from the gateway's folder heartbeat (every few minutes while connected). */
export function syncState(account: MailAccount, folders: readonly WebmailFolder[], now = Date.now()): { state: SyncState; since: string | null } {
  const own = folders.filter(folder => folder.channel_id === account.id);
  const created = account.createdAt ? Date.parse(account.createdAt) : 0;
  if (own.length === 0) return { state: now - created < 15 * 60_000 ? 'connecting' : 'failed', since: null };
  const last = own.reduce<number>((latest, folder) => Math.max(latest, folder.last_synced_at ? Date.parse(folder.last_synced_at) : 0), 0);
  if (last && now - last > 30 * 60_000) return { state: 'stale', since: new Date(last).toISOString() };
  return { state: 'ok', since: last ? new Date(last).toISOString() : null };
}

/** Folder ids of one role inside the scope. */
export function folderIdsFor(folders: readonly WebmailFolder[], scopeIds: readonly string[], role: EmailFolderRole): string[] {
  return folders.filter(folder => folder.role === role && scopeIds.includes(folder.channel_id)).map(folder => folder.id);
}

export function inboxUnread(folders: readonly WebmailFolder[], channelId: string): number {
  return folders.filter(folder => folder.channel_id === channelId && folder.role === 'inbox').reduce((sum, folder) => sum + (folder.unread_count || 0), 0);
}

export const countLabel = (value: number) => (value > 999 ? '999+' : String(value));
