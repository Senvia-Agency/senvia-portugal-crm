import { useEffect, useMemo, useRef, useState } from 'react';
import type { EmailAttachment } from '@/hooks/useEmail';

// 1x1 transparent GIF — placeholder src for images we haven't loaded (yet, or
// ever, if the user never unblocks remote images).
const BLANK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

// Matches an <img ...> tag's src attribute value (double or single quoted).
const IMG_SRC_RE = /(<img\b[^>]*?\ssrc=)(["'])(.*?)\2/gi;
// The sandboxed reader loads HTTPS images automatically and resolves inline CID images.
export function EmailBody({
  html, text, inlineAttachments, resolveAttachment, fitWidth = false, title = 'Email',
}: {
  html: string | null;
  text: string | null;
  inlineAttachments: EmailAttachment[];
  resolveAttachment: (id: string) => Promise<{ data_b64: string; content_type: string | null } | null>;
  /** Zooms out emails wider than the column (down to 45%), as in Realize. */
  fitWidth?: boolean;
  /** Printing looks for the iframe titled "Email"; other messages of a conversation use another title. */
  title?: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [cidUrls, setCidUrls] = useState<Record<string, string>>({});

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
            // Zoomed documents report their height through the box; others keep scrollHeight as before.
            const h = fitWidth ? doc.documentElement.getBoundingClientRect().height || doc.documentElement.scrollHeight : doc.documentElement.scrollHeight;
            if (h) frame.style.height = `${Math.ceil(h) + 12}px`;
          } catch { /* ignore */ }
        }}
      />
    </div>
  );
}
