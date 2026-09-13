import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Paperclip, Star, Loader2, Mail, FileText, Download, Inbox as InboxIcon,
  Reply, ReplyAll, Forward, Archive, Trash2, ShieldAlert, MailOpen, PenSquare,
  Search, X, FileEdit, FolderInput, CheckCheck, ArrowLeft, MoreVertical, Mailbox,
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  useEmailFolders, useEmailMessages, useEmailMessage, useEmailRealtime,
  useEmailSearch, useEmailDrafts, useEmailCommandFailures, useEmailCommandActivity, COMMAND_LABELS, emailCommandErrorMessage,
  type EmailAttachment, type EmailDraft, type EmailMessage,
} from '@/hooks/useEmail';
import { useEmailChannels } from '@/hooks/useEmailChannels';
import { useEmailActions } from '@/hooks/useEmailActions';
import { EmailComposer, type ComposeMode } from './EmailComposer';
import { initials, fmtListDate, fmtFullDate, fmtSize, addrText, folderLabel, ROLE_META } from './emailShared';

// 1x1 transparent GIF — placeholder src for images we haven't loaded (yet, or
// ever, if the user never unblocks remote images).
const BLANK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

// Matches an <img ...> tag's src attribute value (double or single quoted).
const IMG_SRC_RE = /(<img\b[^>]*?\ssrc=)(["'])(.*?)\2/gi;
// Standalone (non-global) check for "does this body have at least one remote
// <img>" — used only to decide whether to show the unblock banner at all.
function hasRemoteImage(html: string): boolean {
  // Não chega procurar `<img src>`: com a política de segurança a bloquear tudo
  // o que vem de fora, um email que só rastreie por CSS (`background:url(...)`)
  // também fica bloqueado — e sem isto não aparecia o botão para o desbloquear.
  return /<img\b[^>]*\ssrc=["']https?:\/\//i.test(html)
    || /url\(\s*["']?https?:\/\//i.test(html)
    || /\bsrcset=["'][^"']*https?:\/\//i.test(html)
    || /\bbackground=["']https?:\/\//i.test(html)
    || /<video\b[^>]*\sposter=["']https?:\/\//i.test(html);
}

// HTML body in a sandboxed, auto-sized iframe (consistent fonts). Blocks remote
// images by default (Gmail/Outlook-style anti-tracking-pixel behaviour — a
// sender can otherwise tell you opened the email the instant it loads) and
// resolves `cid:` embedded images (logos, signatures) from the message's own
// inline attachments, which the browser can never fetch directly.
function EmailBody({
  html, text, inlineAttachments, resolveAttachment,
}: {
  html: string | null;
  text: string | null;
  inlineAttachments: EmailAttachment[];
  resolveAttachment: (id: string) => Promise<{ data_b64: string; content_type: string | null } | null>;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  // Blocked by default per message view (EmailListReader remounts this with a
  // `key` per message id, so a freshly opened email always starts blocked).
  const [imagesBlocked, setImagesBlocked] = useState(true);
  const [cidUrls, setCidUrls] = useState<Record<string, string>>({});
  const hadRemoteImages = useMemo(() => (html ? hasRemoteImage(html) : false), [html]);

  // Resolve every cid: reference actually used in this body, once, from the
  // message's own inline attachments (never a network fetch to a 3rd party).
  useEffect(() => {
    if (!html || inlineAttachments.length === 0) return;
    const referenced = new Set<string>();
    for (const m of html.matchAll(/cid:([^"'\s)]+)/gi)) referenced.add(m[1].toLowerCase());
    if (referenced.size === 0) return;
    let cancelled = false;
    (async () => {
      for (const att of inlineAttachments) {
        const cid = (att.content_id || '').replace(/^<|>$/g, '').toLowerCase();
        if (!cid || !referenced.has(cid) || cidUrls[cid]) continue;
        const resolved = await resolveAttachment(att.id);
        if (cancelled || !resolved) continue;
        const url = `data:${resolved.content_type || 'application/octet-stream'};base64,${resolved.data_b64}`;
        setCidUrls((prev) => ({ ...prev, [cid]: url }));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, inlineAttachments]);

  const srcDoc = useMemo(() => {
    const font = "-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif";
    let body: string;
    if (html) {
      body = html.replace(IMG_SRC_RE, (full, prefix, quote, src) => {
        const cidMatch = /^cid:(.+)$/i.exec(src);
        if (cidMatch) {
          const url = cidUrls[cidMatch[1].toLowerCase()];
          return `${prefix}${quote}${url || BLANK_PIXEL}${quote}`;
        }
        if (/^https?:\/\//i.test(src) && imagesBlocked) {
          return `${prefix}${quote}${BLANK_PIXEL}${quote} data-original-src=${quote}${src}${quote}`;
        }
        return full;
      });
    } else {
      body = (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    }
    // A política de segurança é o que fecha mesmo o rastreio.
    //
    // A reescrita acima só toca em `<img src>`. Um email pode ir buscar ao
    // servidor do remetente por CSS (`background:url(...)`), por `srcset`, por
    // `background=`, por `<video poster>` — e 188 dos 368 emails desta caixa
    // têm blocos `<style>`. O aviso dizia "imagens bloqueadas" e o pixel de
    // rastreio passava à mesma.
    //
    // Aqui é o browser que recusa TODAS as ligações para fora, sejam quais
    // forem. Ao carregar em "Mostrar imagens" abre-se só o necessário.
    const csp = imagesBlocked
      ? "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"
      : "default-src 'none'; img-src data: https:; style-src 'unsafe-inline' https:; font-src data: https:";

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="${csp}">
      <base target="_blank"><style>
      *{box-sizing:border-box}
      body{margin:0;padding:0;font-family:${font};font-size:14px;line-height:1.6;color:#1a1a1a;word-break:break-word;overflow-wrap:break-word;${html ? '' : 'white-space:pre-wrap'}}
      a{color:#2563eb}img{max-width:100%;height:auto}
      blockquote{margin:0 0 0 12px;padding-left:12px;border-left:3px solid #e5e7eb;color:#6b7280}
    </style></head><body>${body}</body></html>`;
  }, [html, text, cidUrls, imagesBlocked]);

  return (
    <div>
      {hadRemoteImages && imagesBlocked && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <span>Imagens externas bloqueadas (proteção contra rastreio).</span>
          <button
            type="button"
            onClick={() => setImagesBlocked(false)}
            className="shrink-0 rounded-md bg-amber-200/70 px-2 py-1 font-medium text-amber-900 hover:bg-amber-200 dark:bg-amber-500/20 dark:text-amber-200"
          >
            Mostrar imagens
          </button>
        </div>
      )}
      <iframe
        ref={ref}
        srcDoc={srcDoc}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        title="Email"
        className="w-full border-0"
        style={{ height: 200 }}
        onLoad={() => {
          try {
            const doc = ref.current?.contentDocument;
            const h = doc?.documentElement?.scrollHeight ?? 0;
            if (h && ref.current) ref.current.style.height = `${h + 12}px`;
          } catch { /* ignore */ }
        }}
      />
    </div>
  );
}

// Trigger a browser download from base64 content.
function triggerB64Download(filename: string, contentType: string | null, b64: string) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const blob = new Blob([arr], { type: contentType || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename || 'anexo'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const attachDb = supabase as unknown as { from: (t: string) => any };

// Draft list row (shown when the Rascunhos folder is active).
function DraftRow({ draft, active, onClick }: { draft: EmailDraft; active: boolean; onClick: () => void }) {
  const to = (draft.to_addresses || []).map((a) => a.name || a.address).join(', ') || '(sem destinatário)';
  const snippet = (draft.body_html || '').replace(/<[^>]+>/g, '').slice(0, 120);
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full flex-col gap-0.5 border-b px-4 py-3 text-left transition-colors',
        active ? 'bg-accent' : 'hover:bg-accent/50',
      )}
    >
      <div className="flex items-center gap-2">
        <FileEdit className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">Para: {to}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{fmtListDate(draft.updated_at)}</span>
      </div>
      <span className="truncate text-sm font-semibold text-foreground">{draft.subject || '(sem assunto)'}</span>
      <span className="truncate text-xs text-muted-foreground">{snippet || '(sem conteúdo)'}</span>
    </button>
  );
}

// Stable per-sender avatar colour so each contact is recognisable at a glance.
const AVATAR_COLORS = [
  'bg-rose-100 text-rose-700', 'bg-amber-100 text-amber-700', 'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700', 'bg-violet-100 text-violet-700', 'bg-fuchsia-100 text-fuchsia-700',
  'bg-teal-100 text-teal-700', 'bg-orange-100 text-orange-700',
];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

const DEFAULT_LIST_W = 416; // 26rem
const MIN_LIST_W = 240;
const MAX_LIST_W = 640;

// Message list + reader for one folder. The folder rail lives in the caixa rail.
export function EmailListReader({ channelId, folderId, onOpenRail }: { channelId: string | null; folderId: string | null; onOpenRail?: () => void }) {
  const [messageId, setMessageId] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const isMobile = useIsMobile();

  // Resizable list column ─────────────────────────────────────────────────────
  const [listWidth, setListWidth] = useState<number>(() => {
    try { return parseInt(localStorage.getItem('email-list-width-v1') || '', 10) || DEFAULT_LIST_W; } catch { return DEFAULT_LIST_W; }
  });
  const listWidthRef = useRef(listWidth);
  useEffect(() => { listWidthRef.current = listWidth; }, [listWidth]);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: listWidthRef.current };
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const w = Math.max(MIN_LIST_W, Math.min(MAX_LIST_W, dragRef.current.startWidth + e.clientX - dragRef.current.startX));
      setListWidth(w);
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      localStorage.setItem('email-list-width-v1', String(listWidthRef.current));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => { setMessageId(null); }, [folderId, channelId]);
  useEmailRealtime(channelId);
  const { data: falhas = [] } = useEmailCommandFailures(channelId);
  const { data: activity } = useEmailCommandActivity(channelId);
  const actions = useEmailActions(channelId, folderId);
  const { toast } = useToast();

  // Falhas já vistas. Sem isto, o aviso reaparecia a cada recarga durante 24
  // horas por causa de uma ação que já ninguém consegue repetir — que foi
  // exatamente o que aconteceu.
  const [dispensadas, setDispensadas] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('email-falhas-dispensadas-v1') || '[]'); } catch { return []; }
  });
  const dispensarFalhas = (ids: string[]) => setDispensadas((prev) => {
    // Só se guardam as recentes: a lista não pode crescer para sempre, e uma
    // falha de ontem já saiu da janela das 24h de qualquer forma.
    const next = [...new Set([...prev, ...ids])].slice(-200);
    localStorage.setItem('email-falhas-dispensadas-v1', JSON.stringify(next));
    return next;
  });
  const falhasVisiveis = useMemo(
    () => falhas.filter((f) => !dispensadas.includes(f.id)),
    [falhas, dispensadas],
  );

  // Detect if current folder is Rascunhos.
  const { data: folders = [] } = useEmailFolders(channelId);
  const isDraftsFolder = !!folderId && folders.find((f) => f.id === folderId)?.role === 'drafts';

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDebounced(search), 350); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setSearch(''); setDebounced(''); setUnreadOnly(false); setStarredOnly(false); }, [folderId, channelId]);
  const searching = debounced.trim().length >= 2;

  const { data: folderMessages = [], isLoading: loadingFolder } = useEmailMessages(isDraftsFolder ? null : folderId);

  // Uma mensagem escondida deixa de o estar quando o servidor confirma: ou
  // porque já não vem na lista (foi mesmo apagada), ou porque a ação falhou e
  // ela tem de voltar a aparecer. Sem isto, uma ação que falhasse deixava a
  // mensagem invisível até recarregar a página — e o email continuava na caixa.
  const { libertar } = actions;
  useEffect(() => {
    const presentes = new Set(folderMessages.map((m) => m.id));
    const sumiram = [...actions.pendentes].filter((id) => !presentes.has(id));
    if (sumiram.length) libertar(sumiram);
  }, [folderMessages, actions.pendentes, libertar]);

  useEffect(() => {
    // A body-download failure must not undo unrelated optimistic deletions.
    const failedIds = new Set(falhas.filter(f => ['delete', 'archive', 'spam', 'move'].includes(f.type)).map(f => f.message_id));
    const failedPending = [...actions.pendentes].filter(id => failedIds.has(id));
    if (failedPending.length) libertar(failedPending);
  }, [falhas, actions.pendentes, libertar]);
  const { data: searchResults = [], isLoading: loadingSearch } = useEmailSearch(channelId, debounced);
  const { data: drafts = [], isLoading: loadingDrafts } = useEmailDrafts(isDraftsFolder ? channelId : null);

  const unreadCount = folderMessages.filter((m) => !m.seen && !actions.pendentes.has(m.id)).length;
  const baseMessages = searching ? searchResults : folderMessages;
  const messages = useMemo(() => {
    if (searching) return baseMessages.filter((m) => !actions.pendentes.has(m.id));
    let list = baseMessages;
    // As que ja foram mandadas apagar/arquivar ficam fora ate desaparecerem
    // mesmo. Sem isto voltavam a aparecer a cada releitura durante os ~2s que
    // o gateway leva a executar.
    list = list.filter((m) => !actions.pendentes.has(m.id));
    if (unreadOnly) list = list.filter((m) => !m.seen);
    if (starredOnly) list = list.filter((m) => m.flagged);
    return list;
  }, [baseMessages, searching, unreadOnly, starredOnly, actions.pendentes]);
  // One row per message: the reader and checkboxes operate on message IDs.
  // Grouping without a thread reader hid replies and made counts misleading.
  const isLoading = isDraftsFolder ? loadingDrafts : (searching ? loadingSearch : loadingFolder);
  const { data: opened, isLoading: loadingMessage } = useEmailMessage(messageId);
  const requestedBodyRef = useRef<string | null>(null);
  const [bodyRequestError, setBodyRequestError] = useState<string | null>(null);
  useEffect(() => { requestedBodyRef.current = null; setBodyRequestError(null); }, [messageId]);
  const failedBodyCommand = falhas.find(f => f.type === 'fetch_body' && f.message_id === messageId);

  useEffect(() => {
    const message = opened?.message;
    if (!message || message.body_fetched || requestedBodyRef.current === message.id) return;
    requestedBodyRef.current = message.id;
    void actions.fetchBody(message.id).catch((error: unknown) => {
      setBodyRequestError(error instanceof Error ? error.message : 'Não foi possível pedir o conteúdo.');
      toast({
        title: 'Falha ao carregar o email',
        description: error instanceof Error ? error.message : 'Tenta novamente.',
        variant: 'destructive',
      });
    });
  }, [opened?.message, actions, toast]);

  const { data: caixas = [] } = useEmailChannels();
  const selfAddress = caixas.find((c) => c.id === channelId)?.metadata?.email_address;

  // Multi-select ──────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  useEffect(() => { setSelectedIds(new Set()); }, [folderId, channelId]);
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
  const runBatch = async (fn: (id: string) => Promise<unknown>, label: string) => {
    const ids = [...selectedIds];
    clearSelection();
    const results = await Promise.allSettled(ids.map((id) => fn(id)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) toast({ title: `${failed} de ${ids.length} operações falharam (${label})`, variant: 'destructive' });
  };
  const batchArchive = () => { runBatch(actions.archive, 'arquivar'); };
  const batchTrash = () => { runBatch(actions.trash, 'apagar'); };
  const batchSpam = () => { runBatch(actions.spam, 'spam'); };
  const batchSetRead = (read: boolean) => { runBatch((id) => actions.setRead(id, read), 'marcar'); };
  const markAllRead = () => { if (folderId) actions.markFolderRead(folderId); };
  // ───────────────────────────────────────────────────────────────────────────

  // "Carregar mais antigos" — asks the gateway to sync the next older batch.
  const [loadingOlder, setLoadingOlder] = useState(false);
  const prevCountRef = useRef(folderMessages.length);
  useEffect(() => {
    // Clear both spinners once the gateway synced more (list grew).
    if (folderMessages.length !== prevCountRef.current) {
      prevCountRef.current = folderMessages.length;
      setLoadingOlder(false);
      setSyncingUnread(false);
    }
  }, [folderMessages.length]);
  useEffect(() => { setLoadingOlder(false); }, [folderId, channelId]);
  const loadOlder = () => {
    if (!folderId || loadingOlder) return;
    setLoadingOlder(true);
    actions.loadOlder(folderId);
    // Safety timeout in case nothing new comes back (already fully synced).
    setTimeout(() => setLoadingOlder(false), 15000);
  };

  // "Não lidos" filter: the folder badge counts ALL unread on IMAP, but only the
  // recent window is synced — so unread mail can live outside it. When the filter
  // is turned on and the folder has more unread than we've loaded, pull them.
  const currentFolder = folders.find((f) => f.id === folderId);
  const folderUnread = currentFolder?.unread_count ?? 0;
  const [syncingUnread, setSyncingUnread] = useState(false);
  useEffect(() => { setSyncingUnread(false); }, [folderId, channelId]);
  const toggleUnread = () => {
    const next = !unreadOnly;
    setUnreadOnly(next);
    if (next && folderId && folderUnread > unreadCount) {
      setSyncingUnread(true);
      actions.syncUnread(folderId);
      setTimeout(() => setSyncingUnread(false), 15000);
    }
  };

  interface ComposeInstance {
    id: string;
    mode: ComposeMode;
    original: EmailMessage | null;
    initialDraft: EmailDraft | null;
    // Forward-only: the original message's attachments, so the composer can
    // re-attach them (see EmailComposer's originalAttachments prop).
    originalAttachments: EmailAttachment[];
  }
  const [composes, setComposes] = useState<ComposeInstance[]>([]);
  const addCompose = (
    mode: ComposeMode,
    original: EmailMessage | null = null,
    initialDraft: EmailDraft | null = null,
    originalAttachments: EmailAttachment[] = [],
  ) => {
    setComposes((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, mode, original, initialDraft, originalAttachments }]);
  };
  const closeCompose = (id: string) => setComposes((prev) => prev.filter((c) => c.id !== id));

  // Auto-mark-read when opening an unread message (standard email behaviour).
  useEffect(() => {
    if (opened?.message && !opened.message.seen) actions.setRead(opened.message.id, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened?.message?.id]);

  const act = (fn: () => void) => { fn(); setMessageId(null); };

  // Keyboard navigation ───────────────────────────────────────────────────────
  // j/k or ↓/↑ to navigate; e=archive, #=delete, r=reply, u=mark unread, Esc=deselect
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true') return;
      const idx = messages.findIndex((m) => m.id === messageId);
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = messages[idx + 1];
        if (next) setMessageId(next.id);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = messages[idx - 1];
        if (prev) setMessageId(prev.id);
      } else if (e.key === 'e' && messageId && !isDraftsFolder) {
        act(() => actions.archive(messageId));
      } else if (e.key === '#' && messageId && !isDraftsFolder) {
        act(() => actions.trash(messageId));
      } else if (e.key === 'r' && opened?.message) {
        addCompose('reply', opened.message);
      } else if (e.key === 'u' && messageId && !isDraftsFolder) {
        actions.setRead(messageId, false);
        setMessageId(null);
      } else if (e.key === 'Escape') {
        clearSelection();
        setMessageId(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, messageId, opened, isDraftsFolder, selectedIds]);
  // ───────────────────────────────────────────────────────────────────────────

  const [dlId, setDlId] = useState<string | null>(null);
  // Shared attachment-body resolver: checks the DB cache first, else asks the
  // gateway to fetch it (fetch_attachment command) and polls briefly for the
  // result. Used both for explicit downloads and for resolving inline `cid:`
  // images in the message body (EmailBody below).
  const resolveAttachment = useCallback(async (attachmentId: string): Promise<{ data_b64: string; content_type: string | null } | null> => {
    const read = () => attachDb.from('email_attachments').select('data_b64, content_type').eq('id', attachmentId).single();
    let { data } = await read();
    if (!data?.data_b64) {
      await actions.fetchAttachment(attachmentId);
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1200));
        const r = await read();
        if (r.data?.data_b64) { data = r.data; break; }
      }
    }
    return data?.data_b64 ? { data_b64: data.data_b64, content_type: data.content_type ?? null } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions.fetchAttachment]);

  const downloadAttachment = async (a: EmailAttachment) => {
    setDlId(a.id);
    try {
      const resolved = await resolveAttachment(a.id);
      if (!resolved) throw new Error('Tempo esgotado a obter o anexo');
      triggerB64Download(a.filename || 'anexo', resolved.content_type || a.content_type, resolved.data_b64);
    } catch (e) {
      toast({ title: 'Falha ao descarregar', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setDlId(null);
    }
  };

  const hasSelection = selectedIds.size > 0;

  return (
    <>
      {/* Message list — full-width single column on mobile; resizable side column on md+ */}
      <section
        className={cn(
          'relative w-full flex-col border-r lg:shrink-0',
          messageId ? 'hidden lg:flex' : 'flex',
        )}
        style={isMobile ? undefined : { width: listWidth }}
      >
        {/* Drag handle (desktop only) */}
        <div
          onMouseDown={onResizeStart}
          className="absolute inset-y-0 right-0 z-10 hidden w-[4px] cursor-col-resize transition-colors hover:bg-primary/40 active:bg-primary/60 lg:block"
        />
        <header className="border-b px-4 pt-5 pb-3 space-y-2">
          {hasSelection ? (
            /* Batch action bar */
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={clearSelection}
                className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
                title="Cancelar seleção"
              >
                <X className="h-4 w-4" />
              </button>
              <span className="text-sm text-muted-foreground">
                {selectedIds.size} selecionado{selectedIds.size !== 1 ? 's' : ''}
              </span>
              <div className="flex-1" />
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => batchSetRead(true)}>
                Lido
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" title="Arquivar" onClick={batchArchive}>
                <Archive className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" title="Spam" onClick={batchSpam}>
                <ShieldAlert className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" title="Apagar" onClick={batchTrash}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {/* Mobile: reopen the caixa rail (the conversation list with its rail
                    button is hidden in email mode, so without this you can't get back). */}
                {onOpenRail && (
                  <Button size="icon" variant="outline" className="h-8 w-8 shrink-0 lg:hidden" title="Caixas" onClick={onOpenRail}>
                    <Mailbox className="h-4 w-4" />
                  </Button>
                )}
                <Button size="sm" onClick={() => addCompose('new')}>
                  <PenSquare className="mr-1.5 h-4 w-4" /> Novo email
                </Button>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {isDraftsFolder
                  ? `${drafts.length} ${drafts.length === 1 ? 'rascunho' : 'rascunhos'}`
                  : searching
                    ? `${messages.length} resultado(s)`
                    : `${messages.length} ${messages.length === 1 ? 'email' : 'emails'}`}
              </span>
            </div>
          )}
          {/* Ações que ficaram por fazer. O aviso de falha era só um evento em
              tempo real — quem não estivesse a olhar nunca soube, e a lista já
              tinha removido a mensagem como se a ação tivesse resultado. */}
          {falhasVisiveis.length > 0 && (
            <div className="relative rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 pr-8 text-xs">
              {/* Dispensar. Um aviso que não se pode calar deixa de ser um aviso
                  e passa a ser um estorvo — ficava ali um dia inteiro por causa
                  de uma ação que já ninguém consegue repetir. */}
              <button
                type="button"
                onClick={() => dispensarFalhas(falhasVisiveis.map((f) => f.id))}
                title="Dispensar"
                className="absolute right-1.5 top-1.5 rounded p-1 text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <p className="font-medium text-destructive">
                {falhasVisiveis.length === 1
                  ? '1 ação de email não foi concluída'
                  : `${falhasVisiveis.length} ações de email não foram concluídas`}
              </p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {falhasVisiveis.slice(0, 3).map((f) => (
                  <li key={f.id} className="truncate">
                    {COMMAND_LABELS[f.type] ?? f.type}
                    {f.error ? ` — ${emailCommandErrorMessage(f.error)}` : ''}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-muted-foreground">
                Estas ações falharam. As restantes podem ter sido concluídas; verifica o estado antes de repetir.
              </p>
            </div>
          )}
          {!!activity?.pending && (
            <div role="status" className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              <span>{activity.pending} {activity.pending === 1 ? 'ação de email em curso' : 'ações de email em curso'} nesta caixa.
                {activity.sends > 0 ? ' Há envios a aguardar confirmação.' : ' A lista é atualizada à medida que terminam.'}</span>
            </div>
          )}
          {!isDraftsFolder && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Procurar emails..."
                autoComplete="new-password"
                className="h-8 pl-8 pr-8 text-sm"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          {/* Unread / starred filters + mark-all-read */}
          {!isDraftsFolder && !searching && !hasSelection && (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={toggleUnread}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                    unreadOnly ? 'border-primary bg-primary/10 text-primary' : 'border-input text-muted-foreground hover:bg-accent',
                  )}
                >
                  Não lidos{folderUnread > 0 ? ` (${folderUnread})` : ''}
                </button>
                <button
                  type="button"
                  onClick={() => setStarredOnly((s) => !s)}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                    starredOnly ? 'border-amber-400 bg-amber-400/10 text-amber-600' : 'border-input text-muted-foreground hover:bg-accent',
                  )}
                >
                  Com estrela
                </button>
              </div>
              {folderUnread > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <CheckCheck className="h-3.5 w-3.5" /> Marcar todas como lidas
                </button>
              )}
            </div>
          )}
          {/* Select all row — shown when items are selected */}
          {hasSelection && messages.length > 0 && (
            <div className="flex items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => selectedIds.size === messages.length ? clearSelection() : setSelectedIds(new Set(messages.map((m) => m.id)))}
                className="flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                {selectedIds.size === messages.length ? 'Desselecionar todos' : `Selecionar todos (${messages.length})`}
              </button>
            </div>
          )}
        </header>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-3">
                  <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : isDraftsFolder ? (
            drafts.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
                <FileEdit className="h-8 w-8 opacity-30" /><span className="text-sm">Sem rascunhos</span>
              </div>
            ) : (
              drafts.map((d) => (
                <DraftRow key={d.id} draft={d} active={composes.some((c) => c.initialDraft?.id === d.id)} onClick={() => addCompose('new', null, d)} />
              ))
            )
          ) : messages.length === 0 ? (
            syncingUnread ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin opacity-50" /><span className="text-sm">A procurar não lidos...</span>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
                <InboxIcon className="h-8 w-8 opacity-30" />
                <span className="text-sm">{unreadOnly ? 'Sem emails não lidos' : 'Pasta vazia'}</span>
              </div>
            )
          ) : (
            messages.map((m) => {
              const active = m.id === messageId;
              const selected = selectedIds.has(m.id);
              const who = m.from_name || m.from_address || '(desconhecido)';
              return (
                <div
                  key={m.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setMessageId(m.id)}
                  onKeyDown={(e) => e.key === 'Enter' && setMessageId(m.id)}
                  className={cn(
                    'group flex w-full cursor-pointer items-start border-b text-left transition-colors',
                    active ? 'bg-accent' : 'hover:bg-accent/50',
                    !m.seen && !active && 'bg-primary/[0.03]',
                    selected && 'bg-primary/10',
                  )}
                >
                  {/* Checkbox — visible on hover or when any row is selected */}
                  <div
                    className={cn(
                      'flex shrink-0 items-center self-stretch pl-3 pr-1 pt-[14px] transition-opacity',
                      !hasSelection && 'opacity-0 group-hover:opacity-100',
                    )}
                    onClick={(e) => { e.stopPropagation(); toggleSelect(m.id); }}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => {}}
                      className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-primary focus:ring-0 focus:ring-offset-0"
                    />
                  </div>
                  {/* Sender avatar (coloured initials) */}
                  <div className="flex shrink-0 items-center self-stretch pl-2 pt-3">
                    <span className={cn('flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold', avatarColor(who))}>
                      {initials(who)}
                    </span>
                  </div>
                  {/* Message content */}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-3 pl-2.5 pr-4">
                    <div className="flex items-center gap-2">
                      {!m.seen && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
                      <span className={cn('min-w-0 flex-1 truncate text-sm', !m.seen ? 'font-bold' : 'font-medium')}>{who}</span>
                      {/* Star: always clickable, visible on hover (or always if already starred) */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); actions.setFlag(m.id, !m.flagged); }}
                        className={cn('shrink-0 transition-opacity', m.flagged ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
                        title={m.flagged ? 'Remover estrela' : 'Marcar com estrela'}
                      >
                        <Star className={cn('h-3.5 w-3.5', m.flagged ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground hover:text-amber-500')} />
                      </button>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{fmtListDate(m.date)}</span>
                    </div>
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className={cn('min-w-0 truncate text-sm', !m.seen ? 'font-semibold text-foreground' : 'text-foreground/80')}>
                        {m.subject || '(sem assunto)'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {m.has_attachments && <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />}
                      <span className="truncate text-xs text-muted-foreground">{m.snippet || ''}</span>
                    </div>
                  </div>
                  {/* Quick actions — appear on hover (archive skipped in Rascunhos, which never reaches here) */}
                  <div className="flex shrink-0 items-start gap-0.5 self-start pt-1.5 pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); actions.archive(m.id); }}
                      className="text-muted-foreground hover:text-foreground"
                      title="Arquivar"
                    >
                      <Archive className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); actions.trash(m.id); }}
                      className="text-muted-foreground hover:text-destructive"
                      title="Apagar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
          {/* Load older — asks the gateway to sync the next batch from IMAP */}
          {!isDraftsFolder && !searching && !isLoading && messages.length > 0 && (
            <div className="p-3">
              <button
                type="button"
                onClick={loadOlder}
                disabled={loadingOlder}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
              >
                {loadingOlder
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> A carregar mais antigos...</>
                  : 'Carregar mais antigos'}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Reader — full-width on mobile (shown when a message is open), side column on md+ */}
      <section className={cn('min-w-0 flex-1 flex-col bg-muted/10', messageId ? 'flex' : 'hidden lg:flex')}>
        {isDraftsFolder ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <FileEdit className="h-10 w-10 opacity-20" />
            <p className="text-sm">Clica num rascunho para continuar a escrever</p>
          </div>
        ) : !opened ? (
          messageId && loadingMessage ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin opacity-50" />
              <span className="text-sm">A abrir email...</span>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                <Mail className="h-8 w-8 text-primary" />
              </div>
              <div>
                <p className="text-base font-semibold text-foreground">Os teus emails</p>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">Escolhe um email à esquerda para o ler aqui.</p>
                <p className="mt-2 hidden text-xs text-muted-foreground/60 lg:block">j/k navegar · e arquivar · # apagar · r responder</p>
              </div>
            </div>
          )
        ) : (
          <>
            <div className="flex items-center gap-1 border-b bg-background px-2 pt-5 pb-2 sm:px-3">
              <Button size="sm" variant="outline" className="px-2 lg:hidden" onClick={() => setMessageId(null)}>
                <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
              </Button>
              <Button size="sm" onClick={() => addCompose('reply', opened.message)}>
                <Reply className="mr-1.5 h-4 w-4" /> Responder
              </Button>
              <Button size="sm" variant="outline" className="hidden sm:inline-flex" onClick={() => addCompose('forward', opened.message, null, opened.attachments)}>
                <Forward className="mr-1.5 h-4 w-4" /> Reencaminhar
              </Button>
              <div className="flex-1" />
              {/* Star: common toggle, kept one tap away */}
              <Button
                size="icon"
                variant="ghost"
                title={opened.message.flagged ? 'Remover estrela' : 'Marcar com estrela'}
                onClick={() => actions.setFlag(opened.message.id, !opened.message.flagged)}
              >
                <Star className={cn('h-4 w-4', opened.message.flagged && 'fill-amber-400 text-amber-400')} />
              </Button>
              {/* Everything else, LABELLED, in one menu (no more guessing icons). */}
              <Popover open={actionsOpen} onOpenChange={setActionsOpen}>
                <PopoverTrigger asChild>
                  <Button size="icon" variant="ghost" title="Mais ações"><MoreVertical className="h-4 w-4" /></Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56 p-1">
                  {([
                    { icon: ReplyAll, label: 'Responder a todos', run: () => addCompose('replyAll', opened.message) },
                    { icon: Forward, label: 'Reencaminhar', run: () => addCompose('forward', opened.message, null, opened.attachments), mobileOnly: true },
                    { icon: MailOpen, label: 'Marcar como não lida', run: () => act(() => actions.setRead(opened.message.id, false)) },
                    { icon: Archive, label: 'Arquivar', run: () => act(() => actions.archive(opened.message.id)) },
                    { icon: ShieldAlert, label: 'Marcar como spam', run: () => act(() => actions.spam(opened.message.id)) },
                  ]).map((it) => (
                    <button
                      key={it.label}
                      onClick={() => { it.run(); setActionsOpen(false); }}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent',
                        it.mobileOnly && 'sm:hidden',
                      )}
                    >
                      <it.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      {it.label}
                    </button>
                  ))}
                  <button
                    onClick={() => { act(() => actions.trash(opened.message.id)); setActionsOpen(false); }}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4 shrink-0" /> Apagar
                  </button>
                  {folders.length > 1 && (
                    <>
                      <div className="my-1 border-t" />
                      <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mover para</p>
                      {folders.filter((f) => f.id !== folderId).map((f) => {
                        const { Icon } = ROLE_META[f.role];
                        return (
                          <button
                            key={f.id}
                            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                            onClick={() => { act(() => actions.move(opened.message.id, f.id)); setActionsOpen(false); }}
                          >
                            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            {folderLabel(f)}
                          </button>
                        );
                      })}
                    </>
                  )}
                </PopoverContent>
              </Popover>
            </div>
        <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl p-6">
              <h1 className="mb-4 text-xl font-semibold leading-snug">{opened.message.subject || '(sem assunto)'}</h1>
              <div className="mb-4 flex items-start gap-3 border-b pb-4">
                <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold', avatarColor(opened.message.from_name || opened.message.from_address || '?'))}>
                  {initials(opened.message.from_name || opened.message.from_address || '?')}
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-semibold">{opened.message.from_name || opened.message.from_address}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{fmtFullDate(opened.message.date)}</span>
                  </div>
                  {opened.message.from_name && (
                    <div className="truncate text-xs text-muted-foreground">{opened.message.from_address}</div>
                  )}
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    Para: {addrText(opened.message.to_addresses) || '—'}
                    {opened.message.cc_addresses?.length > 0 && <>  ·  Cc: {addrText(opened.message.cc_addresses)}</>}
                  </div>
                </div>
              </div>

              {opened.attachments.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-2">
                  {opened.attachments.filter((a) => !a.inline).map((a: EmailAttachment) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => downloadAttachment(a)}
                      disabled={dlId === a.id}
                      title="Descarregar"
                      className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm transition-colors hover:bg-accent disabled:opacity-60"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="max-w-[180px] truncate">{a.filename}</span>
                      <span className="text-xs text-muted-foreground">{fmtSize(a.size)}</span>
                      {dlId === a.id ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-60" />}
                    </button>
                  ))}
                </div>
              )}

              <div className="rounded-lg border bg-white p-4 dark:bg-card">
                {opened.message.body_fetched
                  ? (
                    <EmailBody
                      key={opened.message.id}
                      html={opened.message.html_body}
                      text={opened.message.text_body}
                      inlineAttachments={opened.attachments.filter((a) => a.inline)}
                      resolveAttachment={resolveAttachment}
                    />
                  )
                  : failedBodyCommand || bodyRequestError
                    ? <div role="alert" className="py-6 text-sm text-destructive">Não foi possível carregar o conteúdo. {emailCommandErrorMessage(failedBodyCommand?.error) || bodyRequestError}</div>
                    : <div className="flex items-center gap-2 py-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">A carregar conteúdo...</span></div>}
              </div>
            </div>
          </div>
          </>
        )}
      </section>

      {composes.map((c, i) => (
        <EmailComposer
          key={c.id}
          onClose={() => closeCompose(c.id)}
          channelId={channelId}
          folderId={folderId}
          mode={c.mode}
          original={c.original}
          selfAddress={selfAddress}
          initialDraft={c.initialDraft}
          stackIndex={i}
          originalAttachments={c.originalAttachments}
          resolveAttachment={resolveAttachment}
        />
      ))}
    </>
  );
}
