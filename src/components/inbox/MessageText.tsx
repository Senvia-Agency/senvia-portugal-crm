import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A chat message's text the way WhatsApp Web shows it: links you can click,
 * *bold* / _italic_ / ~strike~ / ```mono```, and emoji drawn a little larger
 * than the text (and big when the message is nothing but one to three emoji).
 */

// http(s):// or www., stopping before trailing punctuation that is part of the sentence.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)\]'"»])/gi;

// An emoji with its variation selectors, skin tones and ZWJ joins; keycaps
// (1️⃣ is "1" + FE0F + 20E3, and "1" is no pictograph); flags.
const EMOJI_RE = /(\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic}️?)*|[0-9#*]️?⃣|[\u{1F1E6}-\u{1F1FF}]{2})/gu;
const ONLY_EMOJI_RE = /^(?:\s*(?:\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic}️?)*|[0-9#*]️?⃣|[\u{1F1E6}-\u{1F1FF}]{2})\s*){1,3}$/u;

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

// WhatsApp only formats when the markers hug the text and sit at a word edge,
// so "file_name_v2" stays as it is.
const FORMAT_RE = /```([\s\S]+?)```|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;
const isEdge = (ch: string | undefined) => ch === undefined || /[\s.,;:!?()[\]{}"'«»-]/.test(ch);

function withEmoji(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(EMOJI_RE)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(
      <span
        key={`${key}-e${at}`}
        className="inline-block align-[-0.12em] text-[1.3em] leading-none"
        style={{ fontFamily: EMOJI_FONT }}
      >
        {match[0]}
      </span>,
    );
    last = at + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function withFormatting(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  FORMAT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FORMAT_RE.exec(text))) {
    const at = match.index;
    const end = at + match[0].length;
    const inner = match[1] ?? match[2] ?? match[3] ?? match[4] ?? '';
    const hugs = inner.trim() === inner && inner.length > 0;
    if (!hugs || !isEdge(text[at - 1]) || !isEdge(text[end])) continue;
    if (at > last) out.push(...withEmoji(text.slice(last, at), `${key}-${last}`));
    const content = withEmoji(inner, `${key}-f${at}`);
    if (match[1] !== undefined) out.push(<code key={`${key}-m${at}`} className="rounded bg-black/10 px-1 font-mono text-[0.92em]">{inner}</code>);
    else if (match[2] !== undefined) out.push(<strong key={`${key}-b${at}`} className="font-semibold">{content}</strong>);
    else if (match[3] !== undefined) out.push(<em key={`${key}-i${at}`}>{content}</em>);
    else out.push(<s key={`${key}-s${at}`}>{content}</s>);
    last = end;
  }
  if (last < text.length) out.push(...withEmoji(text.slice(last), `${key}-${last}`));
  return out;
}

export function MessageText({ text, outgoing, className }: {
  text: string;
  /** Inside a coloured (sent) bubble, links keep the bubble's text colour. */
  outgoing?: boolean;
  className?: string;
}) {
  if (ONLY_EMOJI_RE.test(text)) {
    return (
      <p className={cn('text-4xl leading-tight', className)} style={{ fontFamily: EMOJI_FONT }}>
        {text.trim()}
      </p>
    );
  }

  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(...withFormatting(text.slice(last, at), `t${last}`));
    const href = /^https?:\/\//i.test(match[0]) ? match[0] : `https://${match[0]}`;
    parts.push(
      <a
        key={`u${at}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn('break-all underline underline-offset-2', outgoing ? 'text-current' : 'text-primary')}
      >
        {match[0]}
      </a>,
    );
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(...withFormatting(text.slice(last), `t${last}`));

  return (
    <p className={cn('whitespace-pre-wrap break-words', className)}>
      {parts.map((part, i) => <Fragment key={i}>{part}</Fragment>)}
    </p>
  );
}
