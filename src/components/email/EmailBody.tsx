import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Mail } from 'lucide-react';
import { toast } from 'sonner';
import type { EmailAttachment } from '@/hooks/useEmail';
import { useLanguage } from '@/i18n';

// 1x1 transparent GIF — placeholder src for images we haven't loaded (yet, or
// ever, if the user never unblocks remote images).
const BLANK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

// Matches an <img ...> tag's src attribute value (double or single quoted).
const IMG_SRC_RE = /(<img\b[^>]*?\ssrc=)(["'])(.*?)\2/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/**
 * Plain-text addresses (the "De:"/"Para:" lines of a quoted message, a signature)
 * become mailto links, so every address in the email can be clicked like in Outlook.
 */
function linkifyAddresses(doc: Document) {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (text.parentElement?.closest('a, style, script, title') || !text.data.match(EMAIL_RE)) continue;
    nodes.push(text);
  }
  for (const text of nodes) {
    const fragment = doc.createDocumentFragment();
    let last = 0;
    for (const match of text.data.matchAll(EMAIL_RE)) {
      const at = match.index ?? 0;
      if (at > last) fragment.append(text.data.slice(last, at));
      const link = doc.createElement('a');
      link.href = `mailto:${match[0]}`;
      link.textContent = match[0];
      fragment.append(link);
      last = at + match[0].length;
    }
    if (last < text.data.length) fragment.append(text.data.slice(last));
    text.replaceWith(fragment);
  }
}

const mailtoAddress = (href: string) => {
  try { return decodeURIComponent(href.replace(/^mailto:/i, '').split('?')[0]).trim(); }
  catch { return href.replace(/^mailto:/i, '').split('?')[0].trim(); }
};
// The sandboxed reader loads HTTPS images automatically and resolves inline CID images.
export function EmailBody({
  html, text, inlineAttachments, resolveAttachment, fitWidth = false, title = 'Email', onComposeTo,
}: {
  html: string | null;
  text: string | null;
  inlineAttachments: EmailAttachment[];
  resolveAttachment: (id: string) => Promise<{ data_b64: string; content_type: string | null } | null>;
  /** Zooms out emails wider than the column (down to 45%), as in Realize. */
  fitWidth?: boolean;
  /** Printing looks for the iframe titled "Email"; other messages of a conversation use another title. */
  title?: string;
  /** "Escrever email" on a clicked address; without it the system's mail app opens. */
  onComposeTo?: (address: string) => void;
}) {
  const { t } = useLanguage();
  const ref = useRef<HTMLIFrameElement>(null);
  const [cidUrls, setCidUrls] = useState<Record<string, string>>({});
  // The menu of a clicked address, at its position on the page.
  const [addressMenu, setAddressMenu] = useState<{ address: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addressMenu) return;
    const close = (event: Event) => { if (!(event.target instanceof Node && menuRef.current?.contains(event.target))) setAddressMenu(null); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setAddressMenu(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
    };
  }, [addressMenu]);

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
        return full;
      });
    } else {
      body = (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    }
    // Images load automatically by user choice; scripts remain blocked.
    const csp = "default-src 'none'; img-src data: https:; style-src 'unsafe-inline' https:; font-src data: https:";

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="${csp}">
      <base target="_blank"><style>
      *{box-sizing:border-box}
      body{margin:0;padding:0;font-family:${font};font-size:14px;line-height:1.6;color:#1a1a1a;word-break:break-word;overflow-wrap:break-word;${html ? '' : 'white-space:pre-wrap'}}
      a{color:#2563eb}img{max-width:100%;height:auto}
      blockquote{margin:0 0 0 12px;padding-left:12px;border-left:3px solid #e5e7eb;color:#6b7280}
    </style></head><body>${body}</body></html>`;
  }, [html, text, cidUrls]);

  const copyAddress = async (address: string) => {
    setAddressMenu(null);
    try { await navigator.clipboard.writeText(address); toast.success(t('Endereço copiado')); }
    catch { toast.error(t('Não foi possível copiar.')); }
  };
  const writeTo = (address: string) => {
    setAddressMenu(null);
    if (onComposeTo) onComposeTo(address);
    else window.open(`mailto:${address}`, '_blank');
  };

  return (
    <div>
      <iframe
        ref={ref}
        srcDoc={srcDoc}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        title={title}
        className="w-full border-0"
        style={{ height: 200 }}
        onLoad={() => {
          try {
            const frame = ref.current;
            const doc = frame?.contentDocument;
            if (!frame || !doc) return;
            if (fitWidth) {
              const wide = doc.documentElement.scrollWidth;
              const room = frame.clientWidth;
              const zoom = wide > room + 4 ? Math.max(0.45, room / wide) : 1;
              doc.documentElement.style.zoom = zoom === 1 ? '' : String(zoom);
            }
            linkifyAddresses(doc);
            // A click on an address opens the menu instead of the system's mail app.
            doc.addEventListener('click', (event) => {
              const link = (event.target as Element | null)?.closest?.('a[href^="mailto:" i]');
              if (!link) { setAddressMenu(null); return; }
              event.preventDefault();
              const address = mailtoAddress(link.getAttribute('href') || '');
              if (!address) return;
              const zoom = Number(doc.documentElement.style.zoom) || 1;
              const box = link.getBoundingClientRect();
              const frameBox = frame.getBoundingClientRect();
              setAddressMenu({ address, x: frameBox.left + box.left * zoom, y: frameBox.top + box.bottom * zoom + 4 });
            });
            // Zoomed documents report their height through the box; others keep scrollHeight as before.
            const h = fitWidth ? doc.documentElement.getBoundingClientRect().height || doc.documentElement.scrollHeight : doc.documentElement.scrollHeight;
            if (h) frame.style.height = `${Math.ceil(h) + 12}px`;
          } catch { /* ignore */ }
        }}
      />
      {addressMenu && (
        <div ref={menuRef} role="menu" aria-label={addressMenu.address}
          className="fixed z-[60] w-60 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
          style={{ left: Math.min(addressMenu.x, window.innerWidth - 248), top: Math.min(addressMenu.y, window.innerHeight - 120) }}>
          <p className="truncate px-2.5 py-1.5 text-xs text-muted-foreground">{addressMenu.address}</p>
          <button type="button" role="menuitem" onClick={() => void copyAddress(addressMenu.address)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
            <Copy className="h-4 w-4 text-muted-foreground" />{t('Copiar endereço')}
          </button>
          <button type="button" role="menuitem" onClick={() => writeTo(addressMenu.address)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
            <Mail className="h-4 w-4 text-muted-foreground" />{t('Escrever email')}
          </button>
        </div>
      )}
    </div>
  );
}
