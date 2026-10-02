import DOMPurify from 'dompurify';

const EMAIL_TAGS = ['a', 'b', 'blockquote', 'br', 'caption', 'code', 'div', 'em', 'font', 'h1', 'h2', 'h3', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'span', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul'];
const EMAIL_ATTRIBUTES = ['align', 'alt', 'border', 'cellpadding', 'cellspacing', 'class', 'colspan', 'color', 'face', 'height', 'href', 'rowspan', 'size', 'src', 'style', 'title', 'width'];
const EMAIL_STYLES = new Set(['border', 'border-left', 'border-collapse', 'color', 'background-color', 'font-family', 'font-size', 'font-style', 'font-weight', 'height', 'line-height', 'margin', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom', 'max-width', 'padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom', 'text-align', 'text-decoration', 'vertical-align', 'white-space', 'width']);

export function safeEmailLink(value: string): boolean {
  return /^(https?:\/\/|mailto:|tel:)/i.test(value) && !/[\u0000-\u0020\u007f]/.test(value);
}

export function escapeEmailText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function sanitizeEmailHtml(html: string): string {
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: EMAIL_TAGS,
    ALLOWED_ATTR: EMAIL_ATTRIBUTES,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  for (const element of fragment.querySelectorAll('*')) {
    const href = element.getAttribute('href');
    if (href !== null && !safeEmailLink(href)) element.removeAttribute('href');
    const src = element.getAttribute('src');
    const signatureImage = element.tagName === 'IMG' && element.closest('.senvia-signature') !== null;
    if (src !== null
      && !/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(src)
      && !(signatureImage && /^https:\/\//i.test(src))) element.removeAttribute('src');
    const classes = (element.getAttribute('class') || '').split(/\s+/).filter(value => value === 'senvia-quote' || value === 'senvia-signature');
    element.removeAttribute('class');
    if (classes.length) element.setAttribute('class', classes.join(' '));
    if (element instanceof window.HTMLElement) {
      for (const property of Array.from(element.style)) {
        const value = element.style.getPropertyValue(property);
        if (!EMAIL_STYLES.has(property) || /url\s*\(|expression\s*\(|[\\@]/i.test(value)) element.style.removeProperty(property);
      }
      if (!element.style.cssText) element.removeAttribute('style');
    }
  }
  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML;
}

export function toEditorHtml(value: string | null): string {
  if (!value) return '';
  return /<(br|p|div|b|i|u|ol|ul|blockquote|strong|em|pre|table|img|span|a)\b/i.test(value)
    ? sanitizeEmailHtml(value)
    : escapeEmailText(value).replace(/\n/g, '<br>');
}

interface QuotedEmail {
  readonly from_name: string | null;
  readonly from_address: string | null;
  readonly date: string | null;
  readonly html_body: string | null;
  readonly text_body: string | null;
}

export function quoteEmailHtml(original: QuotedEmail): string {
  const address = escapeEmailText(original.from_address || '');
  const who = original.from_name ? `${escapeEmailText(original.from_name)} &lt;${address}&gt;` : address;
  const when = original.date ? new Date(original.date).toLocaleString('pt-PT') : '';
  const body = original.html_body || escapeEmailText(original.text_body || '').replace(/\n/g, '<br>');
  return sanitizeEmailHtml(`<br><br><div class="senvia-quote" style="border-left:3px solid #e5e7eb;padding-left:10px;margin-left:4px;color:#6b7280"><p style="margin:0 0 6px;font-size:13px">Em ${when}, ${who} escreveu:</p><div style="font-size:13px">${body}</div></div>`);
}

export function insertEmailPaste(event: { preventDefault(): void; readonly clipboardData: DataTransfer }): void {
  event.preventDefault();
  const html = event.clipboardData.getData('text/html');
  document.execCommand('insertHTML', false, html ? sanitizeEmailHtml(html) : escapeEmailText(event.clipboardData.getData('text/plain')).replace(/\n/g, '<br>'));
}
