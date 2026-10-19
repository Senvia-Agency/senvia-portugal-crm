export function emojiShortcutAt(text: string, cursor: number) {
  const match = /(?:^|\s):([\p{L}_+-]*)$/u.exec(text.slice(0, cursor));
  if (!match) return null;
  return { start: cursor - match[1].length - 1, end: cursor, query: match[1] };
}

export function insertComposerEmoji(text: string, start: number, end: number, emoji: string) {
  return { text: text.slice(0, start) + emoji + text.slice(end), cursor: start + emoji.length };
}
