import data from '@emoji-mart/data/sets/15/google.json';

const positions = new Map(Object.values(data.emojis).flatMap(emoji =>
  emoji.skins.map(skin => [skin.native, { x: skin.x, y: skin.y }] as const)));
export const EMOJI_SHEET = '/emoji/google/sheet.png';

export function EmojiGlyph({ emoji, size = '1.3em' }: { readonly emoji: string; readonly size?: string }) {
  const position = positions.get(emoji);
  if (!position) return <span>{emoji}</span>;
  return <span role="img" aria-label={emoji} className="inline-block shrink-0 align-[-0.15em]" style={{
    width: size, height: size,
    backgroundImage: `url(${EMOJI_SHEET})`,
    backgroundSize: `${data.sheet.cols * 100}% ${data.sheet.rows * 100}%`,
    backgroundPosition: `${position.x * 100 / (data.sheet.cols - 1)}% ${position.y * 100 / (data.sheet.rows - 1)}%`,
  }} />;
}
