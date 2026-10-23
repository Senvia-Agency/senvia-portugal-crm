import { lazy, Suspense, useEffect, useId, useState } from 'react';
import type { ComponentProps, RefObject } from 'react';
import { Smile } from 'lucide-react';
import { EmojiGlyph } from './EmojiGlyph';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { searchEmojis } from '@/lib/emoji';
import { emojiShortcutAt, insertComposerEmoji } from './emoji-shortcut';

const FullPicker = lazy(() => import('./EmojiPicker').then(module => ({ default: module.EmojiPicker })));
const FREQUENT = ['😀', '😂', '😊', '❤️', '👍', '🙏', '🎉', '☀️'];

type Props = Omit<ComponentProps<typeof Textarea>, 'value' | 'onChange'> & {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly composerRef: RefObject<HTMLTextAreaElement>;
};

export function EmojiComposer({ value, onValueChange, composerRef, onKeyDown, onSelect, ...props }: Props) {
  const [cursor, setCursor] = useState(0);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [results, setResults] = useState<readonly string[]>([]);
  const [selected, setSelected] = useState(0);
  const listId = useId();
  const shortcut = emojiShortcutAt(value, cursor);
  const query = shortcut?.query;
  useEffect(() => {
    let current = true;
    setSelected(0);
    setResults([]);
    if (query === undefined) return;
    if (query.length < 2) { setResults(FREQUENT); return; }
    void searchEmojis(query).then(items => { if (current) setResults(items); });
    return () => { current = false; };
  }, [query]);
  const suggestionsOpen = focused && !dismissed && !pickerOpen && shortcut !== null && results.length > 0;
  const insert = (emoji: string, replaceShortcut: boolean) => {
    const field = composerRef.current;
    if (!field) return;
    const start = replaceShortcut && shortcut ? shortcut.start : field.selectionStart;
    const end = replaceShortcut && shortcut ? shortcut.end : field.selectionEnd;
    const next = insertComposerEmoji(value, start, end, emoji);
    onValueChange(next.text);
    setDismissed(true);
    setPickerOpen(false);
    requestAnimationFrame(() => {
      field.focus({ preventScroll: true });
      field.setSelectionRange(next.cursor, next.cursor);
      setCursor(next.cursor);
    });
  };
  return <>
    <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0" aria-label="Escolher emoji" title="Escolher emoji">
          <Smile className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-auto max-w-[calc(100vw-1rem)] overflow-auto p-0" style={{ maxHeight: 'var(--radix-popover-content-available-height)' }}
        onCloseAutoFocus={event => { event.preventDefault(); composerRef.current?.focus({ preventScroll: true }); }}>
        <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">A carregar emojis…</p>}><FullPicker onSelect={emoji => insert(emoji, false)} /></Suspense>
      </PopoverContent>
    </Popover>
    <div className="relative min-w-0 flex-1">
      {suggestionsOpen && <div id={listId} role="listbox" aria-label="Sugestões de emojis" className="absolute bottom-full left-0 z-50 mb-2 flex max-w-full flex-wrap gap-1 rounded-xl border border-border bg-popover p-2 shadow-lg">
        {results.map((emoji, index) => <button key={emoji} id={`${listId}-${index}`} type="button" role="option" aria-label={emoji} aria-selected={index === selected}
          className={`flex h-10 w-10 items-center justify-center rounded-lg text-2xl focus-visible:ring-2 focus-visible:ring-primary ${index === selected ? 'bg-primary/15' : 'hover:bg-secondary'}`}
          onMouseDown={event => event.preventDefault()} onClick={() => insert(emoji, true)}><EmojiGlyph emoji={emoji} size="1.5rem" /></button>)}
      </div>}
      <Textarea {...props} ref={composerRef} value={value} aria-label="Mensagem" aria-autocomplete="list" aria-controls={suggestionsOpen ? listId : undefined}
        aria-activedescendant={suggestionsOpen ? `${listId}-${selected}` : undefined}
        onChange={event => { onValueChange(event.target.value); setCursor(event.target.selectionStart); setDismissed(false); }}
        onSelect={event => { setCursor(event.currentTarget.selectionStart); onSelect?.(event); }}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (suggestionsOpen) {
            if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) {
              event.preventDefault();
              setSelected(index => (index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1) + results.length) % results.length);
              return;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              const emoji = results[selected];
              if (emoji) { event.preventDefault(); insert(emoji, true); return; }
            }
            if (event.key === 'Escape') { event.preventDefault(); setDismissed(true); return; }
          }
          onKeyDown?.(event);
        }} />
    </div>
  </>;
}
