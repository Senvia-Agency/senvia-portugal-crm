import { BadgeCheck, Crown, Flame, HandHeart, Heart, Lightbulb, PartyPopper, Rocket, Trophy, Users, type LucideIcon } from 'lucide-react';

export interface RecognitionType {
  readonly key: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Tile gradient as HSL channels, matching the dimensional module tiles. */
  readonly tile: readonly [string, string];
}

// Keys mirror the CHECK constraint in 20261026120000_workplace_recognitions_emoji_reactions.sql.
export const recognitionTypes = [
  { key: 'great_work', label: 'Excelente trabalho', icon: Trophy, tile: ['37 97% 61%', '23 95% 49%'] },
  { key: 'team_spirit', label: 'Espírito de equipa', icon: Users, tile: ['190 88% 51%', '204 88% 44%'] },
  { key: 'creativity', label: 'Criatividade', icon: Lightbulb, tile: ['48 96% 56%', '36 92% 47%'] },
  { key: 'leadership', label: 'Liderança', icon: Crown, tile: ['255 91% 72%', '243 75% 55%'] },
  { key: 'helpful', label: 'Ajuda importante', icon: HandHeart, tile: ['163 66% 50%', '173 80% 34%'] },
  { key: 'professional', label: 'Profissionalismo', icon: BadgeCheck, tile: ['199 97% 60%', '215 88% 50%'] },
  { key: 'innovation', label: 'Inovação', icon: Rocket, tile: ['292 84% 66%', '272 72% 50%'] },
  { key: 'dedication', label: 'Dedicação', icon: Flame, tile: ['28 96% 60%', '350 85% 55%'] },
  { key: 'congrats', label: 'Parabéns', icon: PartyPopper, tile: ['330 90% 68%', '345 85% 55%'] },
  { key: 'thanks', label: 'Obrigado', icon: Heart, tile: ['0 90% 70%', '355 80% 52%'] },
] as const satisfies readonly RecognitionType[];

export type RecognitionKey = (typeof recognitionTypes)[number]['key'];

export function isRecognitionKey(value: string | null | undefined): value is RecognitionKey {
  return recognitionTypes.some(type => type.key === value);
}

export function recognitionType(key: RecognitionKey): RecognitionType {
  return recognitionTypes.find(type => type.key === key) ?? recognitionTypes[0];
}

/** Same reason bounds as the database constraint. */
export const recognitionReason = { min: 30, max: 1000 } as const;

// Order mirrors the CHECK constraint on workplace_reactions.emoji.
export const reactionEmojis = ['👍', '❤️', '👏', '🎉', '😂', '😮', '😢', '🙏'] as const;
export type ReactionEmoji = (typeof reactionEmojis)[number];
export const isReactionEmoji = (value: string): value is ReactionEmoji => (reactionEmojis as readonly string[]).includes(value);
