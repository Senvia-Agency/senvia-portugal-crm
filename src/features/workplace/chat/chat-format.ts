import { format, isToday, isYesterday, isSameYear, differenceInCalendarDays } from 'date-fns';
import { dateLocale, tr } from '@/i18n';
import type { ChatConversation, ChatMessage } from './chat-model';

/** List time: hours today, "Ontem", weekday this week, then the date. */
export function listTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (isToday(date)) return format(date, 'HH:mm');
  if (isYesterday(date)) return tr('Ontem');
  if (differenceInCalendarDays(new Date(), date) < 7) return format(date, 'EEE', { locale: dateLocale() });
  return format(date, isSameYear(date, new Date()) ? 'd MMM' : 'dd/MM/yy', { locale: dateLocale() });
}

export function dayLabel(value: string) {
  const date = new Date(value);
  if (isToday(date)) return tr('Hoje');
  if (isYesterday(date)) return tr('Ontem');
  return format(date, isSameYear(date, new Date()) ? tr("EEEE, d 'de' MMMM") : tr("d 'de' MMMM 'de' yyyy"), { locale: dateLocale() });
}

export function fileSize(bytes: number | null) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export const duration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** One-line summary of a message, as the conversation list and quotes show it. */
export function messageSummary(message: Pick<ChatMessage, 'kind' | 'body' | 'deletedAt'> & { attachmentName?: string | null }) {
  if (message.deletedAt) return tr('Mensagem eliminada');
  if (message.kind === 'image') return `📷 ${message.body || tr('Fotografia')}`;
  if (message.kind === 'audio') return `🎤 ${tr('Nota de voz')}`;
  if (message.kind === 'file') return `📎 ${message.attachmentName || message.body || tr('Ficheiro')}`;
  return message.body ?? '';
}

export function conversationTitle(conversation: Pick<ChatConversation, 'kind' | 'title' | 'peerUserId'>, nameFor: (id: string | null) => string) {
  if (conversation.kind === 'direct') return nameFor(conversation.peerUserId);
  return conversation.title || tr('Grupo');
}

export function lastPreview(conversation: ChatConversation, firstName: (id: string | null) => string) {
  const last = conversation.last;
  if (!last) return conversation.kind === 'channel' ? tr('Canal de toda a organização') : tr('Sem mensagens ainda');
  const text = messageSummary({ kind: last.kind, body: last.body, deletedAt: last.deleted ? 'yes' : null, attachmentName: last.attachmentName });
  const showSender = conversation.kind !== 'direct' || firstName(last.senderId) === tr('Eu');
  return showSender ? `${firstName(last.senderId)}: ${text}` : text;
}
