import { useSyncExternalStore } from 'react';
import data from '@emoji-mart/data/sets/15/google.json';

const positions = new Map(Object.values(data.emojis).flatMap(emoji =>
  emoji.skins.map(skin => [skin.native, { x: skin.x, y: skin.y }] as const)));
export const EMOJI_SHEET = '/emoji/google/sheet.png';

// The sheet is 3 MB: until it has arrived, or when it could not be fetched,
// a glyph drawn from it is an empty square. The phone's own emoji stands in
// meanwhile, and a glyph that mounts after a failure tries the sheet again.
let sheetReady = false;
let sheetLoading = false;
const listeners = new Set<() => void>();

function loadSheet() {
  if (sheetReady || sheetLoading || typeof Image === 'undefined') return;
  sheetLoading = true;
  const image = new Image();
  const settle = (ready: boolean) => {
    sheetLoading = false;
    sheetReady = ready;
    listeners.forEach(listener => listener());
  };
  image.onload = () => settle(true);
  image.onerror = () => settle(false);
  image.src = EMOJI_SHEET;
  if (image.complete && image.naturalWidth > 0) settle(true);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  loadSheet();
  return () => { listeners.delete(listener); };
}

export function EmojiGlyph({ emoji, size = '1.3em' }: { readonly emoji: string; readonly size?: string }) {
  const ready = useSyncExternalStore(subscribe, () => sheetReady, () => true);
  const position = positions.get(emoji);
  if (!position) return <span>{emoji}</span>;
  if (!ready) return <span role="img" aria-label={emoji} className="inline-block shrink-0 align-[-0.15em] leading-none" style={{ fontSize: size }}>{emoji}</span>;
  return <span role="img" aria-label={emoji} className="inline-block shrink-0 align-[-0.15em]" style={{
    width: size, height: size,
    backgroundImage: `url(${EMOJI_SHEET})`,
    backgroundSize: `${data.sheet.cols * 100}% ${data.sheet.rows * 100}%`,
    backgroundPosition: `${position.x * 100 / (data.sheet.cols - 1)}% ${position.y * 100 / (data.sheet.rows - 1)}%`,
  }} />;
}
