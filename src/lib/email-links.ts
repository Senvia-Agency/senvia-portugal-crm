// Same rule as safeEmailLink in email-html.ts (kept here so this file has no
// DOMPurify dependency and runs under node:test on its own).
// eslint-disable-next-line no-control-regex -- control characters are exactly what it rejects
const safeEmailLink = (value: string) => /^(https?:\/\/|mailto:|tel:)/i.test(value) && !/[\u0000- \u007f]/.test(value);

const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i;

/**
 * A word typed in the composer that should become a link when followed by a
 * space or Enter: an email address (mailto:), an http(s) address, or one
 * starting with www. Bare words like "senvia.pt" stay text, to avoid linking
 * file names and abbreviations.
 */
export function linkFromTypedWord(word: string): string | null {
  if (EMAIL_RE.test(word)) return `mailto:${word}`;
  if (/^https?:\/\/[^\s.]+\.\S+/i.test(word)) return safeEmailLink(word) ? word : null;
  if (/^www\.[^\s.]+\.\S+/i.test(word)) return `https://${word}`;
  return null;
}

/** What the person typed in the link box, as a link the email can carry (or null). */
export function normalizeLink(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (EMAIL_RE.test(value)) return `mailto:${value}`;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(value)) return safeEmailLink(value) ? value : null;
  if (/^\+?[\d\s()-]{6,}$/.test(value)) return `tel:${value.replace(/[\s()-]/g, '')}`;
  if (/^[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(value)) return `https://${value}`;
  return null;
}

/**
 * Turns the word right before the caret into a link when it is one
 * (see linkFromTypedWord). Called just before a space or Enter is typed.
 */
export function autoLinkBeforeCaret(doc: Document): boolean {
  const selection = doc.getSelection();
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return false;
  const node = selection.anchorNode;
  if (!node || node.nodeType !== Node.TEXT_NODE || node.parentElement?.closest('a')) return false;
  const before = (node.textContent ?? '').slice(0, selection.anchorOffset);
  const match = /(\S+)$/.exec(before);
  if (!match) return false;
  // Punctuation closing the sentence is not part of the address.
  const word = match[1].replace(/[.,;:!?)\]]+$/, '');
  const href = linkFromTypedWord(word);
  if (!href) return false;
  const range = doc.createRange();
  range.setStart(node, match.index);
  range.setEnd(node, match.index + word.length);
  const anchor = doc.createElement('a');
  anchor.href = href;
  range.surroundContents(anchor);
  // Keep typing after the address, outside the link.
  const caret = doc.createRange();
  const rest = anchor.nextSibling;
  if (rest && rest.nodeType === Node.TEXT_NODE && before.length > match.index + word.length) caret.setStart(rest, before.length - match.index - word.length);
  else caret.setStartAfter(anchor);
  caret.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caret);
  return true;
}
