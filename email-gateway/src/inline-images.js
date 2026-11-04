// Signature images are links to Senvia's public storage. Outlook and many
// webmails block remote images by default, so the signature arrived broken.
// Each such image is fetched here and travels inside the email instead
// (Content-ID, `src="cid:…"`), the way Outlook itself sends signatures.
import { randomUUID } from 'node:crypto';

const STORAGE_HOST = process.env.INLINE_IMAGE_HOST || 'chhmfwlimtbsyjmgtokn.supabase.co';
const BUCKETS = ['email-signatures'];
const MAX_IMAGES = 10;
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

// Only Senvia's own storage: the gateway must never fetch arbitrary URLs.
export function isEmbeddable(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:' || parsed.host !== STORAGE_HOST || parsed.search || parsed.hash) return false;
  return BUCKETS.some((bucket) => parsed.pathname.startsWith(`/storage/v1/object/public/${bucket}/`))
    && !parsed.pathname.includes('..');
}

const IMG_SRC = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)\2/gi;

/**
 * Returns the HTML with every embeddable image pointing at a cid, plus the
 * attachments that carry them. An image that cannot be fetched keeps its
 * link: a slower signature is better than a failed send.
 */
export async function embedInlineImages(html, fetcher = fetch) {
  if (!html || !/<img\b/i.test(html)) return { html, attachments: [] };
  const urls = [...new Set([...html.matchAll(IMG_SRC)].map((m) => m[3]).filter(isEmbeddable))].slice(0, MAX_IMAGES);
  const byUrl = new Map();
  const attachments = [];
  for (const url of urls) {
    try {
      const res = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
      const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!res.ok || !TYPES.has(type)) continue;
      const content = Buffer.from(await res.arrayBuffer());
      if (!content.length || content.length > MAX_BYTES) continue;
      const cid = `${randomUUID()}@senvia`;
      const filename = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'imagem');
      byUrl.set(url, cid);
      attachments.push({ filename, content, contentType: type, cid, contentDisposition: 'inline' });
    } catch { /* keep the link */ }
  }
  if (!byUrl.size) return { html, attachments: [] };
  const out = html.replace(IMG_SRC, (whole, start, quote, src) =>
    byUrl.has(src) ? `${start}${quote}cid:${byUrl.get(src)}${quote}` : whole);
  return { html: out, attachments };
}
