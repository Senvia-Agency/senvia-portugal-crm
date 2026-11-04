import { Inbox as InboxIcon, Send, FileText, ShieldAlert, Trash2, Archive, Folder } from 'lucide-react';
import type { EmailFolder, EmailFolderRole, EmailAddress } from '@/hooks/useEmail';
import { tr, intlLocale } from '@/i18n';

export const ROLE_META: Record<EmailFolderRole, { label: string; Icon: typeof InboxIcon }> = {
  inbox: { label: 'Entrada', Icon: InboxIcon },
  drafts: { label: 'Rascunhos', Icon: FileText },
  sent: { label: 'Enviados', Icon: Send },
  archive: { label: 'Arquivo', Icon: Archive },
  junk: { label: 'Spam', Icon: ShieldAlert },
  trash: { label: 'Lixo', Icon: Trash2 },
  custom: { label: '', Icon: Folder },
};

export function folderLabel(f: EmailFolder) {
  return f.role === 'custom' ? f.name : tr(ROLE_META[f.role].label);
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = Array.from(parts[0])[0] ?? '';
  const second = parts[1] ? (Array.from(parts[1])[0] ?? '') : '';
  return (first + second).toUpperCase();
}

export function fmtListDate(value: string | null) {
  if (!value) return '';
  const d = new Date(value);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= startToday) return d.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(intlLocale(), { day: '2-digit', month: 'short' });
  return d.toLocaleDateString(intlLocale(), { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function fmtFullDate(value: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleString(intlLocale(), {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function fmtSize(bytes: number | null | undefined) {
  if (bytes == null) return '';
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function addrText(list: EmailAddress[]) {
  return (list || []).map((a) => a.name || a.address).join(', ');
}
