import { useState, useMemo, useRef, useEffect, useCallback, useId } from 'react';
import {
  Loader2, Send, X, Paperclip, FileText, Bold, Italic, Underline,
  List, ListOrdered, Minus, BookmarkCheck, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useEmailActions } from '@/hooks/useEmailActions';
import { fmtSize } from './emailShared';
import type { EmailMessage, EmailAddress, EmailDraft, RecipientSuggestion } from '@/hooks/useEmail';
import { useEmailRecipientSuggestions } from '@/hooks/useEmail';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/contexts/AuthContext';
import { useEmailChannels } from '@/hooks/useEmailChannels';
import { useVisualViewport } from '@/hooks/useVisualViewport';
import { cn } from '@/lib/utils';
import type { EmailAttachment } from '@/hooks/useEmail';
import { insertEmailPaste, quoteEmailHtml as quoteHtml, sanitizeEmailHtml, toEditorHtml } from '@/lib/email-html';

interface Attached { filename: string; contentType: string; b64: string; size: number; }
export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';

const COMPOSER_W = 540;
const COMPOSER_GAP = 8;

function parseAddrs(s: string): EmailAddress[] {
  return s.split(/[,;]/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = p.match(/^(.*?)<([^>]+)>$/);
    if (m) return { name: m[1].trim(), address: m[2].trim() };
    return { name: '', address: p };
  });
}

function ensurePrefix(subject: string, prefix: 'Re:' | 'Fwd:') {
  const s = subject || '';
  return new RegExp(`^${prefix}`, 'i').test(s) ? s : `${prefix} ${s}`;
}

// Email chip input — commit on Enter / comma / semicolon / Tab (when non-empty).
// Also autocompletes from sent recipients, CRM contacts and received senders.
// before (channelId/organizationId are optional — omit to fall back to plain
// free-text chips, e.g. if a future caller doesn't have that context).
function EmailChipInput({
  value, onChange, placeholder, channelId, organizationId, label,
}: {
  value: EmailAddress[];
  onChange: (addrs: EmailAddress[]) => void;
  placeholder?: string;
  label: string;
  channelId?: string | null;
  organizationId?: string;
}) {
  const [raw, setRaw] = useState('');
  const [focused, setFocused] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsId = useId();

  const { data: rawSuggestions = [] } = useEmailRecipientSuggestions(raw, channelId ?? null, organizationId);
  // Never suggest an address already picked.
  const suggestions = rawSuggestions.filter(
    (s) => !value.some((v) => v.address.toLowerCase() === s.address.toLowerCase()),
  );
  const showSuggestions = focused && raw.trim().length >= 2 && suggestions.length > 0;

  const commit = useCallback((picked?: EmailAddress) => {
    if (picked) {
      onChange([...value, picked]);
      setRaw('');
      setHighlightIndex(0);
      return;
    }
    const trimmed = raw.trim();
    if (!trimmed) return;
    onChange([...value, ...parseAddrs(trimmed)]);
    setRaw('');
    setHighlightIndex(0);
  }, [raw, value, onChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showSuggestions && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setHighlightIndex((i) => {
        const len = suggestions.length;
        return e.key === 'ArrowDown' ? (i + 1) % len : (i - 1 + len) % len;
      });
      return;
    }
    if (showSuggestions && (e.key === 'Enter' || e.key === 'Tab') && suggestions[highlightIndex]) {
      e.preventDefault();
      const s = suggestions[highlightIndex];
      commit({ name: s.name, address: s.address });
      return;
    }
    if (e.key === 'Escape' && showSuggestions) {
      e.preventDefault();
      setFocused(false);
      return;
    }
    if (e.key === ',' || e.key === ';') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Tab') {
      if (raw.trim()) { e.preventDefault(); commit(); }
      // empty → let Tab move focus naturally
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !raw && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));

  return (
    <div
      className="relative flex flex-1 min-w-0 flex-wrap items-center gap-1 cursor-text py-0.5"
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((a, i) => (
        <span key={i} className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
          <span className="max-w-[180px] truncate">{a.name || a.address}</span>
          <button type="button" onClick={(e) => { e.stopPropagation(); remove(i); }} className="text-primary/60 hover:text-primary">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={raw}
        onChange={(e) => { setRaw(e.target.value); setHighlightIndex(0); }}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit(); }}
        placeholder={value.length === 0 ? placeholder : ''}
        autoComplete="off"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={showSuggestions}
        aria-controls={showSuggestions ? suggestionsId : undefined}
        aria-activedescendant={showSuggestions && suggestions[highlightIndex] ? `${suggestionsId}-${highlightIndex}` : undefined}
        type="email"
        inputMode="email"
        className="flex-1 min-w-[120px] bg-transparent outline-none text-base md:text-sm placeholder:text-muted-foreground"
      />
      {showSuggestions && (
        <div id={suggestionsId} role="listbox" aria-label="Sugestões de destinatários" className="absolute left-0 top-full z-50 mt-1 max-h-56 w-72 max-w-[calc(100vw-3rem)] overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
          {suggestions.map((s, i) => (
            <button
              key={s.address}
              id={`${suggestionsId}-${i}`}
              role="option"
              aria-selected={i === highlightIndex}
              type="button"
              // onMouseDown (not onClick) + preventDefault: keeps the input focused
              // through the click so onBlur's commit() never fires and swallows the pick.
              onMouseDown={(e) => { e.preventDefault(); commit({ name: s.name, address: s.address }); }}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                i === highlightIndex ? "bg-accent" : "hover:bg-accent/60",
              )}
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{s.name}</span>{" "}
                <span className="text-muted-foreground">{s.address}</span>
              </span>
              {s.source === 'crm' && (
                <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">CRM</span>
              )}
              {s.source === 'sent' && (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Enviado</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EmailComposer — one instance per compose window. Positioned via stackIndex
// (0 = rightmost, 1 = one step left, etc.) so multiple windows stack visually.
// ─────────────────────────────────────────────────────────────────────────────
export function EmailComposer({
  onClose, channelId, folderId, mode, original, selfAddress, initialDraft, stackIndex,
  originalAttachments, resolveAttachment,
}: {
  onClose: () => void;
  channelId: string | null;
  folderId: string | null;
  mode: ComposeMode;
  original: EmailMessage | null;
  selfAddress?: string;
  initialDraft?: EmailDraft | null;
  stackIndex: number;
  // Forward-only: the original message's attachments (so they can be re-attached)
  // and a resolver to fetch their bytes on demand (shared with EmailListReader's
  // download logic — same DB-cache-then-gateway-fetch flow).
  originalAttachments?: EmailAttachment[];
  resolveAttachment?: (attachmentId: string) => Promise<{ data_b64: string; content_type: string | null } | null>;
}) {
  const { toast } = useToast();
  const { organization } = useAuth();
  const actions = useEmailActions(channelId, folderId);
  const { data: caixas = [] } = useEmailChannels();
  const caixa = channelId ? caixas.find((c) => c.id === channelId) : undefined;
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(initialDraft?.id ?? null);
  const draftOperation = useRef<Promise<unknown>>(Promise.resolve());
  const closingRef = useRef(false);
  const sendLock = useRef(false);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [bodyVersion, setBodyVersion] = useState(0);

  const [to, setTo] = useState<EmailAddress[]>([]);
  const [cc, setCc] = useState<EmailAddress[]>([]);
  const [bcc, setBcc] = useState<EmailAddress[]>([]);
  const [subject, setSubject] = useState('');
  const [attachments, setAttachments] = useState<Attached[]>([]);

  // The signature the gateway would apply on send (see commands.js applySignature)
  // — shown INLINE while composing instead of being a server-side surprise the
  // user only discovers after sending. 'reply'/'replyAll' use the reply default,
  // everything else (new, forward) uses the new-message default, mirroring the
  // gateway's own `p.inReplyTo ? reply : new` rule.
  const signatureHtml = useMemo(() => {
    const sigs = caixa?.metadata?.signatures || [];
    if (!sigs.length) return '';
    const sigId = (mode === 'reply' || mode === 'replyAll')
      ? caixa?.metadata?.signature_default_reply
      : caixa?.metadata?.signature_default_new;
    const sig = sigId ? sigs.find((s) => s.id === sigId) : null;
    if (!sig || !sig.html?.trim()) return '';
    return `<br><br><div class="senvia-signature">--<br>${toEditorHtml(sig.html)}</div>`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caixa, mode]);

  // Compute initial field values once on mount.
  const initial = useMemo(() => {
    if (initialDraft) {
      // A saved draft already carries its own signature (or the user removed
      // it on purpose) — never re-inject one.
      return {
        to: initialDraft.to_addresses || [],
        cc: initialDraft.cc_addresses || [],
        bcc: initialDraft.bcc_addresses || [],
        subject: initialDraft.subject || '',
        bodyHtml: toEditorHtml(initialDraft.body_html),
        attachments: (initialDraft.attachments || []).map(a => ({ ...a, size: a.size ?? Math.floor(a.b64.length * 3 / 4) })),
      };
    }
    if (!original || mode === 'new') {
      return { to: [], cc: [], bcc: [], subject: '', bodyHtml: signatureHtml, attachments: [] };
    }
    const from: EmailAddress = { name: original.from_name || '', address: original.from_address || '' };
    if (mode === 'forward') {
      return { to: [], cc: [], bcc: [], subject: ensurePrefix(original.subject || '', 'Fwd:'), bodyHtml: signatureHtml + quoteHtml(original), attachments: [] };
    }
    const self = (selfAddress || '').toLowerCase();
    const ccAddrs = mode === 'replyAll'
      ? [...(original.to_addresses || []), ...(original.cc_addresses || [])]
          .filter((a) => a.address && a.address.toLowerCase() !== self && a.address.toLowerCase() !== from.address.toLowerCase())
      : [];
    return { to: [from], cc: ccAddrs, bcc: [], subject: ensurePrefix(original.subject || '', 'Re:'), bodyHtml: signatureHtml + quoteHtml(original), attachments: [] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initialise fields on mount.
  useEffect(() => {
    setTo(initial.to);
    setCc(initial.cc);
    setBcc(initial.bcc);
    setSubject(initial.subject);
    setAttachments(initial.attachments);
    setShowCc(initial.cc.length > 0);
    setShowBcc(initial.bcc.length > 0);
    setDraftId(initialDraft?.id ?? null);
    requestAnimationFrame(() => {
      if (editorRef.current) editorRef.current.innerHTML = sanitizeEmailHtml(initial.bodyHtml);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Forward-only: re-attach the original message's non-inline attachments. Each
  // resolves independently (DB cache or a gateway fetch round-trip) and pops
  // into the attachments row as it's ready — the user can start writing/sending
  // immediately without waiting for every attachment to resolve first.
  useEffect(() => {
    if (mode !== 'forward' || !resolveAttachment || !originalAttachments?.length) return;
    let cancelled = false;
    setLoadingAttachments(true);
    let remaining = originalAttachments.filter((a) => !a.inline).length;
    if (!remaining) setLoadingAttachments(false);
    for (const att of originalAttachments.filter((a) => !a.inline)) {
      resolveAttachment(att.id).then((resolved) => {
        if (cancelled) return;
        if (!resolved) throw new Error('Anexo indisponível');
        setAttachments((prev) => (prev.some((a) => a.filename === att.filename && a.size === (att.size ?? 0))
          ? prev
          : [...prev, {
              filename: att.filename || 'anexo',
              contentType: resolved.content_type || att.content_type || 'application/octet-stream',
              b64: resolved.data_b64,
              size: att.size ?? 0,
            }]));
      }).catch(() => {
        toast({ title: `Não foi possível reencaminhar "${att.filename || 'um anexo'}"`, variant: 'destructive' });
      }).finally(() => { remaining--; if (!cancelled && remaining === 0) setLoadingAttachments(false); });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save draft (debounced 4 s).
  const draftIdRef = useRef(draftId);
  useEffect(() => { draftIdRef.current = draftId; }, [draftId]);
  // Serialize saves so autosave and a manual save cannot insert two drafts.
  const persistDraft = (payload: Parameters<typeof actions.saveDraft>[0]) => {
    const operation = draftOperation.current.catch(() => undefined).then(async () => {
      if (closingRef.current) return { id: draftIdRef.current! };
      const result = await actions.saveDraft({ ...payload, id: draftIdRef.current });
      draftIdRef.current = result.id;
      setDraftId(result.id);
      return result;
    });
    draftOperation.current = operation;
    return operation;
  };
  useEffect(() => {
    const html = editorRef.current?.innerHTML || '';
    const hasContent = to.length > 0 || cc.length > 0 || bcc.length > 0 || subject.trim() || html.replace(/<[^>]+>/g, '').trim();
    if (!hasContent) return;
    const t = setTimeout(async () => {
      try {
        const result = await persistDraft({
          id: draftIdRef.current,
          to, cc: showCc ? cc : [], bcc: showBcc ? bcc : [],
          subject, bodyHtml: sanitizeEmailHtml(editorRef.current?.innerHTML || ''),
          inReplyTo: original?.message_id ?? initialDraft?.in_reply_to ?? null,
          replyMessageId: (mode === 'reply' || mode === 'replyAll') ? original?.id ?? initialDraft?.reply_message_id ?? null : initialDraft?.reply_message_id ?? null,
          attachments: attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, b64: a.b64 })),
        });
        setDraftId(result.id);
      } catch { /* silent */ }
    }, 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, cc, bcc, subject, bodyVersion, attachments.length, showCc, showBcc]);

  const format = (cmd: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const supported = typeof document.queryCommandSupported === 'function' && document.queryCommandSupported(cmd);
    if (supported) {
      document.execCommand(cmd, false, undefined);
    } else {
      const tag = cmd === 'bold' ? 'strong' : cmd === 'italic' ? 'em' : cmd === 'underline' ? 'u' : null;
      if (tag) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          const range = sel.getRangeAt(0);
          const el = document.createElement(tag);
          range.surroundContents(el);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    }
    setBodyVersion((v) => v + 1);
  };

  const handleDiscard = async () => {
    closingRef.current = true;
    await draftOperation.current.catch(() => undefined);
    const idToDelete = draftIdRef.current ?? initialDraft?.id ?? null;
    if (idToDelete) { try { await actions.deleteDraft(idToDelete); } catch { /* non-critical */ } }
    onClose();
  };

  const handleSaveDraft = async () => {
    setSavingDraft(true);
    try {
      const result = await persistDraft({
        id: draftId, to, cc: showCc ? cc : [], bcc: showBcc ? bcc : [],
        subject, bodyHtml: sanitizeEmailHtml(editorRef.current?.innerHTML || ''),
        inReplyTo: original?.message_id ?? initialDraft?.in_reply_to ?? null,
        replyMessageId: (mode === 'reply' || mode === 'replyAll') ? original?.id ?? initialDraft?.reply_message_id ?? null : initialDraft?.reply_message_id ?? null,
        attachments: attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, b64: a.b64 })),
      });
      setDraftId(result.id);
      toast({ title: 'Rascunho guardado' });
    } catch (e) {
      toast({ title: 'Falha ao guardar rascunho', description: (e as Error).message, variant: 'destructive' });
    } finally { setSavingDraft(false); }
  };

  const handleSend = async () => {
    if (sendLock.current || loadingAttachments) return;
    if (to.length === 0) { toast({ title: 'Indica pelo menos um destinatário', variant: 'destructive' }); return; }
    if ([...to, ...(showCc ? cc : []), ...(showBcc ? bcc : [])].some(a => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(a.address))) {
      toast({ title: 'Verifica os endereços dos destinatários', variant: 'destructive' }); return;
    }
    sendLock.current = true;
    setSending(true);
    try {
      const html = sanitizeEmailHtml(editorRef.current?.innerHTML || '');
      const text = editorRef.current?.innerText || '';
      const refs = original && (mode === 'reply' || mode === 'replyAll')
        ? [...(original.email_references || []), original.message_id].filter(Boolean) as string[]
        : undefined;
      await actions.send({
        to, cc: showCc ? cc : [], bcc: showBcc ? bcc : [],
        subject, text, html,
        inReplyTo: mode === 'reply' || mode === 'replyAll' ? original?.message_id ?? initialDraft?.in_reply_to ?? null : initialDraft?.in_reply_to ?? null,
        references: refs,
        attachments: attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, b64: a.b64 })),
      });
      closingRef.current = true;
      await draftOperation.current.catch(() => undefined);
      const idToDelete = draftIdRef.current ?? initialDraft?.id ?? null;
      if (idToDelete) { try { await actions.deleteDraft(idToDelete); } catch { /* non-critical */ } }
      toast({ title: 'Email colocado na fila de envio', description: 'O estado do envio será atualizado na caixa de entrada.' });
      onClose();
    } catch (e) {
      toast({ title: 'Falha ao enviar', description: (e as Error).message, variant: 'destructive' });
    } finally { sendLock.current = false; setSending(false); }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const MAX = 25 * 1024 * 1024;
    let running = attachments.reduce((s, a) => s + a.size, 0);
    const added: Attached[] = [];
    for (const f of Array.from(files)) {
      if (running + f.size > MAX) { toast({ title: `${f.name} excede o limite (25 MB no total)`, variant: 'destructive' }); continue; }
      try {
        const b64 = await new Promise<string>((res, rej) => {
          const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(f);
        });
        added.push({ filename: f.name, contentType: f.type || 'application/octet-stream', b64, size: f.size });
        running += f.size;
      } catch {
        toast({ title: `Falha ao ler ${f.name}`, variant: 'destructive' });
      }
    }
    if (added.length) setAttachments((prev) => [...prev, ...added]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const baseTitle = mode === 'reply' ? 'Responder'
    : mode === 'replyAll' ? 'Responder a todos'
    : mode === 'forward' ? 'Reencaminhar'
    : 'Nova mensagem';
  const title = subject.trim() || baseTitle;

  const rightPx = 24 + stackIndex * (COMPOSER_W + COMPOSER_GAP);
  const isMobile = useIsMobile();
  const viewport = useVisualViewport();

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragEnter = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer?.files?.length) onFiles(e.dataTransfer.files);
  };

  return (
    <div
      role="dialog"
      aria-label={baseTitle}
      className="fixed bottom-0 z-50 flex max-h-[100dvh] flex-col shadow-2xl inset-x-0 md:inset-x-auto"
      style={isMobile ? { top: minimized ? undefined : viewport.offsetTop, height: minimized ? undefined : viewport.height, bottom: minimized ? 0 : undefined } : { width: COMPOSER_W, right: rightPx }}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div
        className="flex select-none items-center gap-2 rounded-t-xl bg-[#1f2937] px-4 py-2.5 text-white cursor-pointer"
        onDoubleClick={() => setMinimized((m) => !m)}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
        <button type="button" title="Minimizar" onClick={() => setMinimized((m) => !m)} className="rounded p-0.5 opacity-60 hover:opacity-100 transition-opacity">
          <Minus className="h-4 w-4" />
        </button>
        <button type="button" title="Fechar" onClick={onClose} className="rounded p-0.5 opacity-60 hover:opacity-100 transition-opacity">
          <X className="h-4 w-4" />
        </button>
      </div>

      {!minimized && (
        <div className="relative flex min-h-0 flex-1 flex-col border border-t-0 border-border bg-background overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {/* Para */}
          <div className="flex min-h-[44px] items-center border-b border-border px-4 py-1.5">
            <span className="w-12 shrink-0 text-xs text-muted-foreground">Para</span>
            <EmailChipInput label="Para" value={to} onChange={setTo} placeholder="nome@exemplo.com" channelId={channelId} organizationId={organization?.id} />
            <div className="ml-2 flex shrink-0 gap-2 text-xs text-muted-foreground">
              {!showCc && <button type="button" className="hover:text-foreground transition-colors" onClick={() => setShowCc(true)}>Cc</button>}
              {!showBcc && <button type="button" className="hover:text-foreground transition-colors" onClick={() => setShowBcc(true)}>Cco</button>}
            </div>
          </div>

          {showCc && (
            <div className="flex min-h-[44px] items-center border-b border-border px-4 py-1.5">
              <span className="w-12 shrink-0 text-xs text-muted-foreground">Cc</span>
              <EmailChipInput label="Cc" value={cc} onChange={setCc} placeholder="cc@exemplo.com" channelId={channelId} organizationId={organization?.id} />
              <button type="button" className="ml-2 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => { setShowCc(false); setCc([]); }}><X className="h-3.5 w-3.5" /></button>
            </div>
          )}

          {showBcc && (
            <div className="flex min-h-[44px] items-center border-b border-border px-4 py-1.5">
              <span className="w-12 shrink-0 text-xs text-muted-foreground">Cco</span>
              <EmailChipInput label="Cco" value={bcc} onChange={setBcc} placeholder="cco@exemplo.com" channelId={channelId} organizationId={organization?.id} />
              <button type="button" className="ml-2 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => { setShowBcc(false); setBcc([]); }}><X className="h-3.5 w-3.5" /></button>
            </div>
          )}

          {/* Assunto */}
          <div className="flex items-center border-b border-border px-4 py-1.5">
            <span className="w-12 shrink-0 text-xs text-muted-foreground">Assunto</span>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Assunto" autoComplete="off"
              className="border-0 p-0 shadow-none focus-visible:ring-0 text-base md:text-sm bg-transparent" />
          </div>

          {/* Rich-text body */}
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            tabIndex={0}
            onInput={() => setBodyVersion((v) => v + 1)}
            onPaste={(event) => { insertEmailPaste(event); setBodyVersion((v) => v + 1); }}
            role="textbox"
            aria-label="Corpo da mensagem"
            aria-multiline="true"
            className="min-h-[120px] flex-1 max-h-[40dvh] md:max-h-[400px] overflow-y-auto px-4 py-3 text-base md:text-sm outline-none [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
            style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif", lineHeight: '1.6' }}
          />

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-border px-4 py-2">
              {attachments.map((a, i) => (
                <span key={i} className="flex items-center gap-1.5 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-xs">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="max-w-[120px] truncate">{a.filename}</span>
                  <span className="text-muted-foreground">{fmtSize(a.size)}</span>
                  <button type="button" onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          )}

          {/* Bottom toolbar */}
          <div className="sticky bottom-0 flex flex-wrap items-center gap-1 border-t border-border bg-background px-3 py-2">
            <Button size="sm" onClick={handleSend} disabled={sending || savingDraft || loadingAttachments} className="rounded-full px-4 text-xs">
              {sending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
              Enviar
            </Button>
            <div className="mx-1 h-4 w-px bg-border" />
            {[
              { icon: Bold, cmd: 'bold', title: 'Negrito' },
              { icon: Italic, cmd: 'italic', title: 'Itálico' },
              { icon: Underline, cmd: 'underline', title: 'Sublinhado' },
              { icon: List, cmd: 'insertUnorderedList', title: 'Lista' },
              { icon: ListOrdered, cmd: 'insertOrderedList', title: 'Lista numerada' },
            ].map(({ icon: Icon, cmd, title }) => (
              <button key={cmd} type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={() => format(cmd)}
                className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
            <div className="mx-1 h-4 w-px bg-border" />
            <button type="button" title="Anexar" onClick={() => fileRef.current?.click()}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
              <Paperclip className="h-3.5 w-3.5" />
            </button>
            <button type="button" title="Guardar rascunho" onClick={handleSaveDraft} disabled={savingDraft}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-40">
              {savingDraft ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookmarkCheck className="h-3.5 w-3.5" />}
            </button>
            <button type="button" title="Descartar" onClick={handleDiscard}
              className="ml-auto rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />

      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-b-xl border-2 border-dashed border-primary bg-background/90">
          <div className="flex flex-col items-center gap-2 text-primary">
            <Paperclip className="h-8 w-8" />
            <span className="text-sm font-medium">Solte os ficheiros aqui para anexar</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Export the width constant so the parent can compute total stack width if needed.
export { COMPOSER_W, COMPOSER_GAP };
