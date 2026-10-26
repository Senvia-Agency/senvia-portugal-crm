import { format, isToday, isYesterday, isSameYear, differenceInCalendarDays } from 'date-fns';
import { pt } from 'date-fns/locale';
import type { ChatConversation, ChatMessage } from './chat-model';

/** List time: hours today, "Ontem", weekday this week, then the date. */
export function listTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (isToday(date)) return format(date, 'HH:mm');
  if (isYesterday(date)) return 'Ontem';
  if (differenceInCalendarDays(new Date(), date) < 7) return format(date, 'EEE', { locale: pt });
  return format(date, isSameYear(date, new Date()) ? 'd MMM' : 'dd/MM/yy', { locale: pt });
}

export function dayLabel(value: string) {
  const date = new Date(value);
  if (isToday(date)) return 'Hoje';
  if (isYesterday(date)) return 'Ontem';
  return format(date, isSameYear(date, new Date()) ? "EEEE, d 'de' MMMM" : "d 'de' MMMM 'de' yyyy", { locale: pt });
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
  if (message.deletedAt) return 'Mensagem eliminada';
  if (message.kind === 'image') return `📷 ${message.body || 'Fotografia'}`;
  if (message.kind === 'audio') return '🎤 Nota de voz';
  if (message.kind === 'file') return `📎 ${message.attachmentName || message.body || 'Ficheiro'}`;
  return message.body ?? '';
}

export function conversationTitle(conversation: Pick<ChatConversation, 'kind' | 'title' | 'peerUserId'>, nameFor: (id: string | null) => string) {
  if (conversation.kind === 'direct') return nameFor(conversation.peerUserId);
  return conversation.title || 'Grupo';
}

export function lastPreview(conversation: ChatConversation, firstName: (id: string | null) => string) {
  const last = conversation.last;
  if (!last) return conversation.kind === 'channel' ? 'Canal de toda a organização' : 'Sem mensagens ainda';
  const text = messageSummary({ kind: last.kind, body: last.body, deletedAt: last.deleted ? 'yes' : null, attachmentName: last.attachmentName });
  const showSender = conversation.kind !== 'direct' || firstName(last.senderId) === 'Eu';
  return showSender ? `${firstName(last.senderId)}: ${text}` : text;
}
