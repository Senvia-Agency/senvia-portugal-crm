import { useState, useMemo, useRef, useEffect, useCallback, useId, useLayoutEffect } from 'react';
import {
  Loader2, Send, X, Paperclip, FileText, Bold, Italic, Underline,
  List, ListOrdered, Minus, BookmarkCheck, Trash2, Maximize2, UsersRound, Link2, Type, Palette, ChevronDown,
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { autoLinkBeforeCaret, normalizeLink } from '@/lib/email-links';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTeamMembers } from '@/hooks/useTeam';
import { useContactLists, useMailContacts, usePersonalSignatures } from '@/features/webmail/useWebmail';
import { rememberContacts, type ContactList } from '@/features/webmail/webmail-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { tr, useLanguage, intlLocale } from '@/i18n';
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
import { escapeEmailText, insertEmailPaste, quoteEmailHtml as quoteHtml, sanitizeEmailHtml, toEditorHtml } from '@/lib/email-html';
import { writeEmailRecovery, removeEmailRecovery, type EmailRecovery } from '@/lib/inbox-drafts';
import { resolveEmailSignatureHtml, resolveEmailSignatureSource } from '@/lib/email-signature';

import { useInboxWorkspace } from '@/components/inbox/workspace/InboxWorkspaceContext';

interface Attached { filename: string; contentType: string; b64: string; size: number; }
export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';

// Fonts every mail client has; <font face/size/color> is what they all render.
const EMAIL_FONTS = [
  { label: 'Sans Serif', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Largura fixa', value: '"Courier New", Courier, monospace' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Trebuchet', value: '"Trebuchet MS", sans-serif' },
];
const EMAIL_SIZES = [
  { label: 'Pequeno', value: '2' },
  { label: 'Normal', value: '3' },
  { label: 'Grande', value: '5' },
  { label: 'Enorme', value: '6' },
];
// How each size looks in the menu.
const SIZE_PX: Record<string, string> = { '2': '12px', '3': '14px', '5': '18px', '6': '22px' };
const EMAIL_COLORS = ['#111827', '#6b7280', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#2563eb', '#7c3aed'];

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

/** WebMail extras for the recipient fields: the person's contact lists, contacts and colleagues. */
interface ComposerExtras {
  readonly lists: readonly ContactList[];
  readonly people: readonly RecipientSuggestion[];
}

const normalizeText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Realize's order: contact lists, contacts already written to, the usual history and CRM, colleagues. Prefix matches first. */
function webmailSuggestions(term: string, extra: ComposerExtras, base: readonly RecipientSuggestion[]): RecipientSuggestion[] {
  const search = normalizeText(term.trim());
  if (search.length < 2) return [];
  const matches = (item: RecipientSuggestion) => normalizeText(`${item.name} ${item.address}`).includes(search);
  const lists: RecipientSuggestion[] = extra.lists
    .filter((list) => normalizeText(list.name).includes(search))
    .map((list) => ({ name: list.name, address: `lista:${list.id}`, source: 'list', members: list.members }));
  const ordered = [
    ...lists,
    ...extra.people.filter((item) => item.source === 'contact' && matches(item)),
    ...base,
    ...extra.people.filter((item) => item.source === 'team' && matches(item)),
  ];
  const seen = new Set<string>();
  const unique = ordered.filter((item) => (seen.has(item.address) ? false : (seen.add(item.address), true)));
  const prefix = (item: RecipientSuggestion) => (normalizeText(item.name).startsWith(search) || item.address.startsWith(search) ? 0 : 1);
  return unique.map((item, index) => ({ item, index }))
    .sort((a, b) => prefix(a.item) - prefix(b.item) || a.index - b.index)
    .map(({ item }) => item).slice(0, 8);
}

// Email chip input — commit on Enter / comma / semicolon / Tab (when non-empty).
// Also autocompletes from sent recipients, CRM contacts and received senders.
// before (channelId/organizationId are optional — omit to fall back to plain
// free-text chips, e.g. if a future caller doesn't have that context).
function EmailChipInput({
  value, onChange, placeholder, channelId, organizationId, label, extra,
}: {
  value: EmailAddress[];
  onChange: (addrs: EmailAddress[]) => void;
  placeholder?: string;
  label: string;
  channelId?: string | null;
  organizationId?: string;
  extra?: ComposerExtras;
}) {
  const { t } = useLanguage();
  const [raw, setRaw] = useState('');
  const [focused, setFocused] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsId = useId();

  const { data: rawSuggestions = [] } = useEmailRecipientSuggestions(raw, channelId ?? null, organizationId);
  // Never suggest an address already picked.
  const merged = useMemo(() => (extra ? webmailSuggestions(raw, extra, rawSuggestions) : rawSuggestions), [extra, raw, rawSuggestions]);
  const suggestions = merged.filter(
    (s) => s.source === 'list' || !value.some((v) => v.address.toLowerCase() === s.address.toLowerCase()),
  );
  const showSuggestions = focused && raw.trim().length >= 2 && suggestions.length > 0;

  const commit = useCallback((picked?: EmailAddress & { members?: RecipientSuggestion['members'] }) => {
    if (picked?.members) {
      // A contact list adds all its members (without repeating anyone already there).
      const known = new Set(value.map((v) => v.address.toLowerCase()));
      const added = picked.members.filter((member) => !known.has(member.address.toLowerCase()) && (known.add(member.address.toLowerCase()), true));
      onChange([...value, ...added.map((member) => ({ name: member.name, address: member.address }))]);
      setRaw('');
      setHighlightIndex(0);
      return;
    }
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
      commit({ name: s.name, address: s.address, members: s.members });
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
        <div id={suggestionsId} role="listbox" aria-label={t("Sugestões de destinatários")} className="absolute left-0 top-full z-50 mt-1 max-h-56 w-72 max-w-[calc(100vw-3rem)] overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
          {suggestions.map((s, i) => (
            <button
              key={s.address}
              id={`${suggestionsId}-${i}`}
              role="option"
              aria-selected={i === highlightIndex}
              type="button"
              // onMouseDown (not onClick) + preventDefault: keeps the input focused
              // through the click so onBlur's commit() never fires and swallows the pick.
              onMouseDown={(e) => { e.preventDefault(); commit({ name: s.name, address: s.address, members: s.members }); }}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                i === highlightIndex ? "bg-accent" : "hover:bg-accent/60",
              )}
            >
              <span className="min-w-0 flex-1 truncate">
                {s.source === 'list' && <UsersRound className="mr-1 inline h-3.5 w-3.5 text-primary" aria-hidden="true" />}
                <span className="font-medium">{s.name}</span>{" "}
                <span className="text-muted-foreground">{s.source === 'list' ? t(s.members?.length === 1 ? '{{n}} pessoa' : '{{n}} pessoas', { n: s.members?.length ?? 0 }) : s.address}</span>
              </span>
              {s.source === 'list' && (
                <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{t('Lista')}</span>
              )}
              {s.source === 'contact' && (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t('Já enviado')}</span>
              )}
              {s.source === 'team' && (
                <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">{t('Equipa')}</span>
              )}
              {s.source === 'crm' && (
                <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">CRM</span>
              )}
              {s.source === 'sent' && (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t('Enviado')}</span>
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
/** WebMail mode: Realize-style window, "De" between the person's caixas, personal signatures, contacts and lists, and a check before sending. */
export interface WebmailComposerOptions {
  readonly accounts: ReadonlyArray<{ readonly id: string; readonly name: string; readonly address: string }>;
}

export function EmailComposer({
  onClose, channelId, folderId, mode, original, selfAddress, initialDraft, stackIndex, recoveryId, recovered,
  originalAttachments, resolveAttachment, webmail,
}: {
  recoveryId: string;
  recovered?: EmailRecovery;
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
  webmail?: WebmailComposerOptions;
}) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const { organization, profile, user } = useAuth();
  const queryClient = useQueryClient();
  // The caixa this message goes out from; only the WebMail lets it change ("De").
  const [activeChannelId, setActiveChannelId] = useState(channelId);
  const actions = useEmailActions(activeChannelId, folderId);
  const { data: caixas = [] } = useEmailChannels();
  const caixa = activeChannelId ? caixas.find((c) => c.id === activeChannelId) : undefined;
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(recovered?.savedDraftId ?? initialDraft?.id ?? null);
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

  const recoveryScope = user && organization ? `${user.id}:${organization.id}` : null;
  const recoveryReady = useRef(false);
  const recoveryProtected = useRef(false);
  const autosaveWarningShown = useRef(false);
  const storageWarningShown = useRef(false);
  const checkpointRef = useRef<() => void>(() => undefined);
  const checkpoint = () => {
    if (!recoveryReady.current || closingRef.current || !recoveryScope || !activeChannelId) return;
    const protectedDraft = writeEmailRecovery(recoveryScope, activeChannelId, {
      id: recoveryId, savedDraftId: draftId,
      to, cc: showCc ? cc : [], bcc: showBcc ? bcc : [], subject,
      bodyHtml: sanitizeEmailHtml(editorRef.current?.innerHTML || ''),
      inReplyTo: (mode === 'reply' || mode === 'replyAll') ? original?.message_id ?? initialDraft?.in_reply_to ?? recovered?.inReplyTo ?? null : initialDraft?.in_reply_to ?? recovered?.inReplyTo ?? null,
      replyMessageId: (mode === 'reply' || mode === 'replyAll') ? original?.id ?? initialDraft?.reply_message_id ?? recovered?.replyMessageId ?? null : initialDraft?.reply_message_id ?? recovered?.replyMessageId ?? null,
    });
    recoveryProtected.current = protectedDraft;
    if (!protectedDraft && !storageWarningShown.current) {
      storageWarningShown.current = true;
      toast({ title: t('Não foi possível proteger o rascunho neste navegador'), description: t('Guarda o texto antes de sair.'), variant: 'destructive' });
    }
  };
  useLayoutEffect(() => { checkpointRef.current = checkpoint; checkpoint(); });
  useEffect(() => {
    const protect = () => checkpointRef.current();
    window.addEventListener('pagehide', protect);
    window.addEventListener('beforeunload', protect);
    return () => { protect(); window.removeEventListener('pagehide', protect); window.removeEventListener('beforeunload', protect); };
  }, []);
  const clearRecovery = () => {
    if (recoveryScope && activeChannelId) removeEmailRecovery(recoveryScope, activeChannelId, recoveryId);
  };

  const signatureHtml = useMemo(() => {
    return resolveEmailSignatureHtml({
      mode,
      metadata: caixa?.metadata,
      profileSignature: profile?.email_signature,
    });
  }, [caixa?.metadata, mode, profile?.email_signature]);
  // The WebMail fills an empty signature slot once the person's signatures are known.
  const signatureSlot = webmail ? '<br><br><div class="senvia-signature"></div>' : signatureHtml;
  const caixaSignature = useMemo(() => resolveEmailSignatureSource({
    mode, metadata: caixa?.metadata, profileSignature: profile?.email_signature,
  }), [caixa?.metadata, mode, profile?.email_signature]);
  const personalSignatures = usePersonalSignatures(webmail ? activeChannelId : null);
  const [signatureChoice, setSignatureChoice] = useState<string | null>(() => (initialDraft || recovered ? 'kept' : null));
  const [editorReady, setEditorReady] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [sendCheck, setSendCheck] = useState<string[] | null>(null);
  const contacts = useMailContacts(!!webmail);
  const contactLists = useContactLists(!!webmail);
  const { data: teamMembers } = useTeamMembers();
  const extras = useMemo<ComposerExtras | undefined>(() => (webmail ? {
    lists: contactLists.data ?? [],
    people: [
      ...(contacts.data ?? []).map((c) => ({ name: c.name || c.email, address: c.email, source: 'contact' as const })),
      ...(teamMembers ?? []).filter((m) => m.email && m.user_id !== user?.id && !m.is_banned)
        .map((m) => ({ name: m.full_name || m.email!, address: m.email!.toLowerCase(), source: 'team' as const })),
    ],
  } : undefined), [webmail, contactLists.data, contacts.data, teamMembers, user?.id]);

  /** Puts the chosen signature in the body, above any quoted message ("none" leaves an empty marker so the server adds nothing). */
  const applySignature = (choice: string) => {
    setSignatureChoice(choice);
    const editor = editorRef.current;
    if (!editor || choice === 'kept') return;
    const html = choice === 'none' ? ''
      : choice === 'caixa' ? caixaSignature
      : personalSignatures.data?.find((signature) => signature.id === choice)?.html ?? '';
    const holder = editor.ownerDocument.createElement('div');
    holder.innerHTML = sanitizeEmailHtml(`<div class="senvia-signature">${html.trim() ? `--<br>${html}` : ''}</div>`);
    const block = holder.firstElementChild;
    if (!block) return;
    const current = Array.from(editor.querySelectorAll('.senvia-signature')).find((node) => !node.closest('.senvia-quote'));
    const quote = Array.from(editor.children).find((node) => node.classList.contains('senvia-quote'));
    if (current) current.replaceWith(block);
    else if (quote) editor.insertBefore(block, quote);
    else editor.append(block);
    setBodyVersion((v) => v + 1);
    checkpointRef.current();
  };
  useEffect(() => {
    if (!webmail || !editorReady || signatureChoice !== null || personalSignatures.isLoading) return;
    const preferred = personalSignatures.data?.find((signature) => signature.is_default) ?? personalSignatures.data?.[0];
    applySignature(preferred ? preferred.id : caixaSignature ? 'caixa' : 'none');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webmail, editorReady, signatureChoice, personalSignatures.isLoading, personalSignatures.data, caixaSignature]);

  // Compute initial field values once on mount.
  const initial = useMemo(() => {
    if (recovered) {
      return { to: recovered.to, cc: recovered.cc, bcc: recovered.bcc, subject: recovered.subject,
        bodyHtml: toEditorHtml(recovered.bodyHtml), attachments: (initialDraft?.attachments ?? []).map(a => ({ ...a, size: a.size ?? Math.floor(a.b64.length * 3 / 4) })) };
    }
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
      return { to: [], cc: [], bcc: [], subject: '', bodyHtml: signatureSlot, attachments: [] };
    }
    const from: EmailAddress = { name: original.from_name || '', address: original.from_address || '' };
    if (mode === 'forward') {
      return { to: [], cc: [], bcc: [], subject: ensurePrefix(original.subject || '', 'Fwd:'), bodyHtml: signatureSlot + quoteHtml(original), attachments: [] };
    }
    const self = (selfAddress || '').toLowerCase();
    const ccAddrs = mode === 'replyAll'
      ? [...(original.to_addresses || []), ...(original.cc_addresses || [])]
          .filter((a) => a.address && a.address.toLowerCase() !== self && a.address.toLowerCase() !== from.address.toLowerCase())
      : [];
    return { to: [from], cc: ccAddrs, bcc: [], subject: ensurePrefix(original.subject || '', 'Re:'), bodyHtml: signatureSlot + quoteHtml(original), attachments: [] };
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
    setDraftId(recovered?.savedDraftId ?? initialDraft?.id ?? null);
    requestAnimationFrame(() => {
      if (editorRef.current) editorRef.current.innerHTML = sanitizeEmailHtml(initial.bodyHtml);
      recoveryReady.current = true;
      setEditorReady(true);
      checkpointRef.current();
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
        if (!resolved) throw new Error(t('Anexo indisponível'));
        setAttachments((prev) => (prev.some((a) => a.filename === att.filename && a.size === (att.size ?? 0))
          ? prev
          : [...prev, {
              filename: att.filename || t('anexo'),
              contentType: resolved.content_type || att.content_type || 'application/octet-stream',
              b64: resolved.data_b64,
              size: att.size ?? 0,
            }]));
      }).catch(() => {
        toast({ title: t('Não foi possível reencaminhar "{{name}}"', { name: att.filename || t('um anexo') }), variant: 'destructive' });
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
      setSavedAt(new Date());
      return result;
    });
    draftOperation.current = operation;
    return operation;
  };
  useEffect(() => {
    const html = editorRef.current?.innerHTML || '';
    // In the WebMail the signature and the quoted message are filled in automatically: they alone never make a draft.
    const hasContent = to.length > 0 || cc.length > 0 || bcc.length > 0 || subject.trim()
      || (webmail ? writtenText() || attachments.length > 0 : html.replace(/<[^>]+>/g, '').trim());
    if (!hasContent) return;
    const t = setTimeout(async () => {
      try {
        const result = await persistDraft({
          id: draftIdRef.current,
          to, cc: showCc ? cc : [], bcc: showBcc ? bcc : [],
          subject, bodyHtml: sanitizeEmailHtml(editorRef.current?.innerHTML || ''),
          inReplyTo: original?.message_id ?? initialDraft?.in_reply_to ?? recovered?.inReplyTo ?? null,
          replyMessageId: (mode === 'reply' || mode === 'replyAll') ? original?.id ?? initialDraft?.reply_message_id ?? recovered?.replyMessageId ?? null : initialDraft?.reply_message_id ?? recovered?.replyMessageId ?? null,
          attachments: attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, b64: a.b64 })),
        });
        setDraftId(result.id);
        autosaveWarningShown.current = false;
      } catch (error) {
        if (!autosaveWarningShown.current) {
          autosaveWarningShown.current = true;
          toast({ title: tr('Não foi possível sincronizar o rascunho'), description: recoveryProtected.current ? tr('O texto está protegido neste separador. Mantém o separador aberto até guardar no servidor.') : tr('Copia o texto antes de sair desta página.'), variant: 'destructive' });
        }
        console.warn('[Email draft] Server save failed', error instanceof Error ? error.name : 'unknown');
      }
    }, 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, cc, bcc, subject, bodyVersion, attachments.length, showCc, showBcc]);

  const format = (cmd: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const document = editorRef.current?.ownerDocument ?? globalThis.document;
    const window = document.defaultView ?? globalThis.window;
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

  // Menus and the link box take the focus away from the body; the selection is
  // kept here and put back before the change is applied to it.
  const savedRange = useRef<Range | null>(null);
  const saveSelection = () => {
    const editor = editorRef.current;
    const selection = editor?.ownerDocument.getSelection();
    if (editor && selection && selection.rangeCount > 0 && editor.contains(selection.anchorNode)) {
      savedRange.current = selection.getRangeAt(0).cloneRange();
    }
  };
  const restoreSelection = () => {
    const editor = editorRef.current;
    if (!editor) return null;
    editor.focus();
    const selection = editor.ownerDocument.getSelection();
    if (selection && savedRange.current) {
      selection.removeAllRanges();
      selection.addRange(savedRange.current);
    }
    return editor.ownerDocument;
  };
  const applyStyle = (cmd: 'fontName' | 'fontSize' | 'foreColor', value: string) => {
    const doc = restoreSelection();
    if (!doc) return;
    doc.execCommand('styleWithCSS', false, 'false');
    doc.execCommand(cmd, false, value);
    checkpointRef.current();
    setBodyVersion((v) => v + 1);
  };

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [linkError, setLinkError] = useState(false);
  const openLink = () => {
    saveSelection();
    const current = savedRange.current?.startContainer.parentElement?.closest('a');
    setLinkValue(current?.getAttribute('href')?.replace(/^mailto:/, '') ?? '');
    setLinkError(false);
    setLinkOpen(true);
  };
  const applyLink = () => {
    const href = normalizeLink(linkValue);
    if (!href) { setLinkError(true); return; }
    const doc = restoreSelection();
    if (!doc) return;
    const selection = doc.getSelection();
    if (selection && !selection.isCollapsed) {
      doc.execCommand('createLink', false, href);
    } else {
      // Nothing selected: the address itself becomes the link text.
      doc.execCommand('insertHTML', false, `<a href="${escapeEmailText(href)}">${escapeEmailText(linkValue.trim())}</a>&nbsp;`);
    }
    setLinkOpen(false);
    checkpointRef.current();
    setBodyVersion((v) => v + 1);
  };

  const handleDiscard = async () => {
    closingRef.current = true;
    await draftOperation.current.catch(() => undefined);
    const idToDelete = draftIdRef.current ?? initialDraft?.id ?? null;
    if (idToDelete) { try { await actions.deleteDraft(idToDelete); } catch { /* non-critical */ } }
    clearRecovery();
    onClose();
  };

  const handleSaveDraft = async () => {
    setSavingDraft(true);
    try {
      const result = await persistDraft({
        id: draftId, to, cc: showCc ? cc : [], bcc: showBcc ? bcc : [],
        subject, bodyHtml: sanitizeEmailHtml(editorRef.current?.innerHTML || ''),
        inReplyTo: original?.message_id ?? initialDraft?.in_reply_to ?? recovered?.inReplyTo ?? null,
        replyMessageId: (mode === 'reply' || mode === 'replyAll') ? original?.id ?? initialDraft?.reply_message_id ?? recovered?.replyMessageId ?? null : initialDraft?.reply_message_id ?? recovered?.replyMessageId ?? null,
        attachments: attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, b64: a.b64 })),
      });
      setDraftId(result.id);
      toast({ title: t('Rascunho guardado') });
    } catch (e) {
      toast({ title: t('Falha ao guardar rascunho'), description: (e as Error).message, variant: 'destructive' });
    } finally { setSavingDraft(false); }
  };

  /** Text the person wrote, without the signature and the quoted message. */
  const writtenText = () => {
    const clone = editorRef.current?.cloneNode(true) as HTMLElement | undefined;
    clone?.querySelectorAll('.senvia-signature, .senvia-quote').forEach((node) => node.remove());
    return (clone?.textContent || '').trim();
  };
  const handleSend = async () => {
    if (sendLock.current || loadingAttachments) return;
    const everyone = [...to, ...(showCc ? cc : []), ...(showBcc ? bcc : [])];
    if (webmail ? everyone.length === 0 : to.length === 0) { toast({ title: t('Indica pelo menos um destinatário'), variant: 'destructive' }); return; }
    if (everyone.some(a => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(a.address))) {
      toast({ title: t('Verifica os endereços dos destinatários'), variant: 'destructive' }); return;
    }
    if (webmail) {
      // As in Realize: these only ask for confirmation; nothing here blocks the send.
      const issues = [
        ...(to.length === 0 ? [t('Ninguém em "Para": a mensagem só vai em Cc/Cco.')] : []),
        ...(!subject.trim() ? [t('A mensagem não tem assunto.')] : []),
        ...(!writtenText() && attachments.length === 0 ? [t('A mensagem não tem texto nem anexos.')] : []),
      ];
      if (issues.length) { setSendCheck(issues); return; }
    }
    await doSend();
  };
  const doSend = async () => {
    if (sendLock.current || loadingAttachments) return;
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
        inReplyTo: mode === 'reply' || mode === 'replyAll' ? original?.message_id ?? initialDraft?.in_reply_to ?? recovered?.inReplyTo ?? null : initialDraft?.in_reply_to ?? recovered?.inReplyTo ?? null,
        references: refs,
        attachments: attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, b64: a.b64 })),
      });
      closingRef.current = true;
      await draftOperation.current.catch(() => undefined);
      const idToDelete = draftIdRef.current ?? initialDraft?.id ?? null;
      if (idToDelete) { try { await actions.deleteDraft(idToDelete); } catch { /* non-critical */ } }
      clearRecovery();
      toast({ title: t('Email colocado na fila de envio'), description: t('O estado do envio será atualizado na caixa de entrada.') });
      if (webmail && organization?.id) {
        // Suggestions learn from every send; a failure here never affects the email.
        void rememberContacts(organization.id, [...to, ...(showCc ? cc : []), ...(showBcc ? bcc : [])])
          .then(() => queryClient.invalidateQueries({ queryKey: ['email-contacts'] }))
          .catch(() => undefined);
      }
      onClose();
    } catch (e) {
      toast({ title: t('Falha ao enviar'), description: (e as Error).message, variant: 'destructive' });
    } finally { sendLock.current = false; setSending(false); }
  };

  const currentDraft = () => ({
    id: draftIdRef.current, to, cc: showCc ? cc : [], bcc: showBcc ? bcc : [],
    subject, bodyHtml: sanitizeEmailHtml(editorRef.current?.innerHTML || ''),
    inReplyTo: original?.message_id ?? initialDraft?.in_reply_to ?? recovered?.inReplyTo ?? null,
    replyMessageId: (mode === 'reply' || mode === 'replyAll') ? original?.id ?? initialDraft?.reply_message_id ?? recovered?.replyMessageId ?? null : initialDraft?.reply_message_id ?? recovered?.replyMessageId ?? null,
    attachments: attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, b64: a.b64 })),
  });
  /** WebMail closing: something written is kept as a draft ("Rascunho guardado"); an empty message leaves nothing behind. */
  const handleClose = async () => {
    if (!webmail) { onClose(); return; }
    const hasContent = to.length > 0 || cc.length > 0 || bcc.length > 0 || !!subject.trim() || !!writtenText() || attachments.length > 0;
    if (hasContent) {
      try {
        await persistDraft(currentDraft());
        toast({ title: t('Rascunho guardado') });
      } catch (e) {
        toast({ title: t('Não foi possível guardar o rascunho'), description: (e as Error).message, variant: 'destructive' });
        return;
      }
    } else {
      await draftOperation.current.catch(() => undefined);
      if (draftIdRef.current) { try { await actions.deleteDraft(draftIdRef.current); } catch { /* non-critical */ } }
    }
    closingRef.current = true;
    clearRecovery();
    onClose();
  };
  /** Sending from another caixa: the draft moves with it and that caixa's default signature applies. */
  const changeAccount = async (nextId: string) => {
    if (!nextId || nextId === activeChannelId) return;
    await draftOperation.current.catch(() => undefined);
    const previousDraft = draftIdRef.current;
    if (previousDraft) { try { await actions.deleteDraft(previousDraft); } catch { /* non-critical */ } }
    if (recoveryScope && activeChannelId) removeEmailRecovery(recoveryScope, activeChannelId, recoveryId);
    draftIdRef.current = null;
    setDraftId(null);
    setActiveChannelId(nextId);
    setSignatureChoice(null);
  };

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const MAX = 25 * 1024 * 1024;
    let running = attachments.reduce((s, a) => s + a.size, 0);
    const added: Attached[] = [];
    for (const f of Array.from(files)) {
      if (running + f.size > MAX) { toast({ title: t('{{name}} excede o limite (25 MB no total)', { name: f.name }), variant: 'destructive' }); continue; }
      try {
        const b64 = await new Promise<string>((res, rej) => {
          const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(f);
        });
        added.push({ filename: f.name, contentType: f.type || 'application/octet-stream', b64, size: f.size });
        running += f.size;
      } catch {
        toast({ title: t('Falha ao ler {{name}}', { name: f.name }), variant: 'destructive' });
      }
    }
    if (added.length) setAttachments((prev) => [...prev, ...added]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const baseTitle = mode === 'reply' ? t('Responder')
    : mode === 'replyAll' ? t('Responder a todos')
    : mode === 'forward' ? t('Reencaminhar')
    : t('Nova mensagem');
  const title = subject.trim() || baseTitle;

  const workspace = useInboxWorkspace();
  const compact = workspace?.compact ?? false;
  const rightPx = 24 + stackIndex * (COMPOSER_W + COMPOSER_GAP);
  const isMobile = useIsMobile();
  const viewport = useVisualViewport();

  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragging(true);
  };
  const handleDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setMinimized(false);
    if (e.dataTransfer.files.length) void onFiles(e.dataTransfer.files);
  };

  const activeAccount = webmail?.accounts.find((account) => account.id === activeChannelId);
  const personalList = personalSignatures.data ?? [];

  return (
    <>
    {webmail && !minimized && <div className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-[1px]" aria-hidden="true" />}
    <div
      role="dialog"
      aria-label={baseTitle}
      className={cn(
        "fixed z-50 flex flex-col shadow-2xl",
        webmail
          ? minimized
            ? "bottom-4 right-4 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl"
            : "inset-0 overflow-hidden md:inset-auto md:left-1/2 md:top-1/2 md:h-[min(920px,calc(100dvh-3rem))] md:w-[min(1120px,calc(100vw-3rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl"
          : "bottom-0 max-h-[100dvh] inset-x-0 md:inset-x-auto",
      )}
      style={webmail ? undefined : compact ? { width: "100%", right: 0, bottom: 0, maxHeight: "calc(100% - 5rem)" } : isMobile ? { top: minimized ? undefined : viewport.offsetTop, height: minimized ? undefined : viewport.height, bottom: minimized ? 0 : undefined } : { width: COMPOSER_W, right: rightPx }}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDropCapture={handleDrop}
    >
      {/* Header */}
      <div
        className={cn("flex select-none items-center gap-2 bg-[#1f2937] px-4 py-2.5 text-white cursor-pointer", webmail ? (minimized ? "" : "md:rounded-t-2xl") : "rounded-t-xl")}
        onDoubleClick={() => setMinimized((m) => !m)}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{webmail && !minimized ? baseTitle : title}</span>
        <button type="button" title={minimized ? t("Restaurar") : t("Minimizar")} aria-label={minimized ? t("Restaurar") : t("Minimizar")} onClick={() => setMinimized((m) => !m)} className="rounded p-0.5 opacity-60 hover:opacity-100 transition-opacity">
          {webmail && minimized ? <Maximize2 className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
        </button>
        <button type="button" title={t("Fechar")} aria-label={t("Fechar")} onClick={() => void handleClose()} className="rounded p-0.5 opacity-60 hover:opacity-100 transition-opacity">
          <X className="h-4 w-4" />
        </button>
      </div>

      {!minimized && (
        <div className={cn("relative flex min-h-0 flex-1 flex-col border-border bg-background overflow-y-auto pb-[env(safe-area-inset-bottom)]", webmail ? "md:rounded-b-2xl" : "border border-t-0")}>
          {/* De + Assinatura (WebMail) */}
          {webmail && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-1.5">
              <div className="flex min-h-[36px] min-w-0 flex-1 items-center">
                <span className="w-12 shrink-0 text-xs text-muted-foreground">{t('De')}</span>
                {webmail.accounts.length > 1 ? (
                  <Select value={activeChannelId ?? undefined} onValueChange={(value) => void changeAccount(value)}>
                    <SelectTrigger aria-label={t("Enviar de")} className="h-9 min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus:ring-0 md:max-w-md"><SelectValue /></SelectTrigger>
                    <SelectContent className="z-[80]">
                      {webmail.accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name} &lt;{account.address}&gt;</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="truncate text-sm">{activeAccount ? `${activeAccount.name} <${activeAccount.address}>` : ''}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{t('Assinatura:')}</span>
                <Select value={signatureChoice ?? undefined} onValueChange={applySignature}>
                  <SelectTrigger aria-label={t("Assinatura")} className="h-9 w-auto min-w-[9rem] max-w-[14rem] border-0 bg-transparent px-1 shadow-none focus:ring-0"><SelectValue placeholder={t("A carregar…")} /></SelectTrigger>
                  <SelectContent className="z-[80]">
                    {signatureChoice === 'kept' && <SelectItem value="kept">{t('A do rascunho')}</SelectItem>}
                    {personalList.map((signature) => <SelectItem key={signature.id} value={signature.id}>{signature.name}{signature.is_default ? ' ' + t('(predefinida)') : ''}</SelectItem>)}
                    {personalList.length === 0 && caixaSignature && <SelectItem value="caixa">{t('Assinatura da caixa')}</SelectItem>}
                    <SelectItem value="none">{t('Sem assinatura')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Para */}
          <div className="flex min-h-[44px] items-center border-b border-border px-4 py-1.5">
            <span className="w-12 shrink-0 text-xs text-muted-foreground">{t('Para')}</span>
            <EmailChipInput label={t("Para")} value={to} onChange={setTo} placeholder={t("nome@exemplo.com")} channelId={activeChannelId} organizationId={organization?.id} extra={extras} />
            <div className="ml-2 flex shrink-0 gap-2 text-xs text-muted-foreground">
              {!showCc && <button type="button" className="hover:text-foreground transition-colors" onClick={() => setShowCc(true)}>Cc</button>}
              {!showBcc && <button type="button" className="hover:text-foreground transition-colors" onClick={() => setShowBcc(true)}>{t('Cco')}</button>}
            </div>
          </div>

          {showCc && (
            <div className="flex min-h-[44px] items-center border-b border-border px-4 py-1.5">
              <span className="w-12 shrink-0 text-xs text-muted-foreground">Cc</span>
              <EmailChipInput label="Cc" value={cc} onChange={setCc} placeholder={t("cc@exemplo.com")} channelId={activeChannelId} organizationId={organization?.id} extra={extras} />
              <button type="button" className="ml-2 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => { setShowCc(false); setCc([]); }}><X className="h-3.5 w-3.5" /></button>
            </div>
          )}

          {showBcc && (
            <div className="flex min-h-[44px] items-center border-b border-border px-4 py-1.5">
              <span className="w-12 shrink-0 text-xs text-muted-foreground">{t('Cco')}</span>
              <EmailChipInput label={t("Cco")} value={bcc} onChange={setBcc} placeholder={t("cco@exemplo.com")} channelId={activeChannelId} organizationId={organization?.id} extra={extras} />
              <button type="button" className="ml-2 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => { setShowBcc(false); setBcc([]); }}><X className="h-3.5 w-3.5" /></button>
            </div>
          )}

          {/* Assunto */}
          <div className="flex items-center border-b border-border px-4 py-1.5">
            <span className="w-12 shrink-0 text-xs text-muted-foreground">{t('Assunto')}</span>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("Assunto")} autoComplete="off"
              className="border-0 p-0 shadow-none focus-visible:ring-0 text-base md:text-sm bg-transparent" />
          </div>

          {/* Rich-text body */}
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            tabIndex={0}
            onInput={() => { checkpointRef.current(); setBodyVersion((v) => v + 1); }}
            onPaste={(event) => { insertEmailPaste(event); checkpointRef.current(); setBodyVersion((v) => v + 1); }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openLink(); return; }
              // An address typed and followed by a space or Enter becomes a link, as in Gmail.
              if ((event.key === ' ' || event.key === 'Enter') && autoLinkBeforeCaret(event.currentTarget.ownerDocument)) {
                checkpointRef.current();
                setBodyVersion((v) => v + 1);
              }
            }}
            role="textbox"
            aria-label={t("Corpo da mensagem")}
            aria-multiline="true"
            className={cn("flex-1 overflow-y-auto px-4 py-3 text-base md:text-sm outline-none [&_a]:text-primary [&_a]:underline [&_table_img]:max-w-none [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5", webmail ? "min-h-[240px]" : "min-h-[120px] max-h-[40dvh] md:max-h-[400px]")}
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

          {/* The link box: an address, email or phone for the selected text (Ctrl+K). */}
          {linkOpen && (
            <div className="flex items-center gap-2 border-t border-border bg-background px-3 py-2">
              <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <Input autoFocus value={linkValue} placeholder={t("Site, email ou telefone (ex.: senvia.pt)")} aria-label={t("Endereço do link")}
                aria-invalid={linkError}
                onChange={(e) => { setLinkValue(e.target.value); setLinkError(false); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } if (e.key === 'Escape') { e.preventDefault(); setLinkOpen(false); restoreSelection(); } }}
                className={cn('h-8 flex-1 text-sm', linkError && 'border-destructive focus-visible:ring-destructive')} />
              {linkError && <span className="shrink-0 text-xs text-destructive">{t('Endereço inválido')}</span>}
              <Button size="sm" className="h-8 rounded-full px-3 text-xs" onClick={applyLink}>{t('Inserir')}</Button>
              <button type="button" aria-label={t("Fechar")} onClick={() => { setLinkOpen(false); restoreSelection(); }}
                className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}

          {/* Bottom toolbar */}
          <div className="sticky bottom-0 flex flex-wrap items-center gap-1 border-t border-border bg-background px-3 py-2">
            <Button size="sm" onClick={handleSend} disabled={sending || savingDraft || loadingAttachments} className="rounded-full px-4 text-xs">
              {sending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
              {t('Enviar')}
            </Button>
            <div className="mx-1 h-4 w-px bg-border" />
            {/* Font, size and colour: the menus steal the focus, so the selection is kept first. */}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger onPointerDown={saveSelection} title={t("Tipo de letra")} aria-label={t("Tipo de letra")}
                className="flex items-center gap-0.5 rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                <Type className="h-3.5 w-3.5" /><ChevronDown className="h-3 w-3 opacity-60" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-44" onCloseAutoFocus={(e) => e.preventDefault()}>
                {EMAIL_FONTS.map((font) => (
                  <DropdownMenuItem key={font.label} onSelect={() => applyStyle('fontName', font.value)} style={{ fontFamily: font.value }}>{t(font.label)}</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger onPointerDown={saveSelection} title={t("Tamanho do texto")} aria-label={t("Tamanho do texto")}
                className="flex items-center gap-0.5 rounded px-1.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                Aa<ChevronDown className="h-3 w-3 opacity-60" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-36" onCloseAutoFocus={(e) => e.preventDefault()}>
                {EMAIL_SIZES.map((size) => (
                  <DropdownMenuItem key={size.value} onSelect={() => applyStyle('fontSize', size.value)}>
                    <span style={{ fontSize: SIZE_PX[size.value] }}>{t(size.label)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger onPointerDown={saveSelection} title={t("Cor do texto")} aria-label={t("Cor do texto")}
                className="flex items-center gap-0.5 rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                <Palette className="h-3.5 w-3.5" /><ChevronDown className="h-3 w-3 opacity-60" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="grid w-auto grid-cols-4 gap-1 p-2" onCloseAutoFocus={(e) => e.preventDefault()}>
                {EMAIL_COLORS.map((color) => (
                  <DropdownMenuItem key={color} aria-label={t('Cor {{color}}', { color })} onSelect={() => applyStyle('foreColor', color)}
                    className="h-7 w-7 justify-center rounded-full p-0">
                    <span className="h-5 w-5 rounded-full border border-black/10" style={{ background: color }} />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {[
              { icon: Bold, cmd: 'bold', title: 'Negrito' },
              { icon: Italic, cmd: 'italic', title: 'Itálico' },
              { icon: Underline, cmd: 'underline', title: 'Sublinhado' },
              { icon: List, cmd: 'insertUnorderedList', title: 'Lista' },
              { icon: ListOrdered, cmd: 'insertOrderedList', title: 'Lista numerada' },
            ].map(({ icon: Icon, cmd, title }) => (
              <button key={cmd} type="button" title={t(title)} onMouseDown={(e) => e.preventDefault()} onClick={() => format(cmd)}
                className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
            <button type="button" title={t("Inserir link (Ctrl+K)")} aria-label={t("Inserir link")} onMouseDown={(e) => e.preventDefault()} onClick={openLink}
              className={cn('rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors', linkOpen && 'bg-accent text-foreground')}>
              <Link2 className="h-3.5 w-3.5" />
            </button>
            <div className="mx-1 h-4 w-px bg-border" />
            <button type="button" title={t("Anexar")} onClick={() => fileRef.current?.click()}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
              <Paperclip className="h-3.5 w-3.5" />
            </button>
            <button type="button" title={t("Guardar rascunho")} onClick={handleSaveDraft} disabled={savingDraft}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-40">
              {savingDraft ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookmarkCheck className="h-3.5 w-3.5" />}
            </button>
            {webmail && (
              <span className="ml-2 text-[11px] text-muted-foreground" aria-live="polite">
                {savingDraft ? t('A guardar…') : savedAt ? t('Guardado às {{time}}', { time: savedAt.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }) }) : ''}
              </span>
            )}
            <button type="button" title={t("Descartar")} onClick={handleDiscard}
              className="ml-auto rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />

      {/* Drag overlay */}
      {isDragging && (
        <div role="status" className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-b-xl border-2 border-dashed border-primary bg-background/90">
          <div className="flex flex-col items-center gap-2 text-primary">
            <Paperclip className="h-8 w-8" />
            <span className="text-sm font-medium">{t('Largue os ficheiros aqui para anexar')}</span>
          </div>
        </div>
      )}

      <AlertDialog open={sendCheck !== null} onOpenChange={(open) => { if (!open) setSendCheck(null); }}>
        <AlertDialogContent className="z-[90]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Enviar mesmo assim?')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {(sendCheck ?? []).map((issue) => <li key={issue}>{issue}</li>)}
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Rever')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setSendCheck(null); void doSend(); }}>{t('Enviar')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </>
  );
}

// Export the width constant so the parent can compute total stack width if needed.
export { COMPOSER_W, COMPOSER_GAP };
