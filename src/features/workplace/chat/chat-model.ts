export type ChatKind = 'direct' | 'group' | 'channel';
export type ChatMessageKind = 'text' | 'image' | 'file' | 'audio';
export type ChatFilter = 'all' | 'unread' | 'groups' | 'archived';

export interface ChatConversation {
  readonly id: string;
  readonly kind: ChatKind;
  readonly title: string | null;
  readonly isDefault: boolean;
  readonly createdAt: string;
  readonly lastMessageAt: string | null;
  readonly myRole: 'owner' | 'admin' | 'member';
  readonly isPinned: boolean;
  readonly isMuted: boolean;
  readonly isArchived: boolean;
  readonly memberCount: number;
  readonly unread: number;
  /** The other person in a 1:1 conversation. */
  readonly peerUserId: string | null;
  readonly last: { senderId: string | null; kind: ChatMessageKind; body: string | null; attachmentName: string | null; deleted: boolean } | null;
}

export interface ChatAttachment {
  readonly path: string;
  readonly name: string;
  readonly size: number | null;
  readonly mime: string | null;
  readonly durationSec: number | null;
}

export interface ChatMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly senderId: string | null;
  readonly kind: ChatMessageKind;
  readonly body: string | null;
  readonly attachment: ChatAttachment | null;
  readonly replyToId: string | null;
  readonly forwarded: boolean;
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly deletedAt: string | null;
}

export interface ChatMember {
  readonly userId: string;
  readonly role: 'owner' | 'admin' | 'member';
  readonly lastReadAt: string;
}

export interface ChatReaction {
  readonly messageId: string;
  readonly userId: string;
  readonly emoji: string;
}

export const CHAT_BUCKET = 'workplace-chat-files';
export const CHAT_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const CHAT_MESSAGE_MAX = 4000;
/** Same MIME list as the bucket (20261026150000_workplace_chat.sql). */
export const CHAT_ACCEPT = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
  'application/pdf', 'text/plain', 'text/csv', 'application/zip', 'application/x-zip-compressed',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav',
] as const;
export const isAcceptedFile = (file: File) => (CHAT_ACCEPT as readonly string[]).includes(file.type);
export const kindForFile = (file: File): ChatMessageKind =>
  file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'file';
