import type { FeedAuthor } from './feed-storage';
import type { ReactionEmoji, RecognitionKey } from './recognition-types';
import type { FeedAttachment } from './feed-files';

export type FeedKind = 'publication' | 'announcement' | 'recognition';

export interface FeedReaction {
  readonly userId: string;
  readonly emoji: ReactionEmoji;
}

export interface FeedComment {
  readonly id: string;
  readonly author: FeedAuthor;
  readonly text: string;
  readonly createdAt: string;
}

/** A shared organization post as the Feed shows it (the browser-only draft schema lives in feed-storage). */
export interface FeedEntry {
  readonly id: string;
  readonly author: FeedAuthor;
  readonly text: string;
  readonly kind: FeedKind;
  readonly pinned: boolean;
  readonly createdAt: string;
  readonly reactions: readonly FeedReaction[];
  readonly comments: readonly FeedComment[];
  /** Recognitions only. */
  readonly recipient: FeedAuthor | null;
  readonly recognitionType: RecognitionKey | null;
  /** Photos and documents (up to four). */
  readonly attachments: readonly FeedAttachment[];
}
