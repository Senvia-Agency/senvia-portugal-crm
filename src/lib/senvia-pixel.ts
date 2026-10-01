/**
 * Senvia's own Meta pixel — Senvia's marketing, on Senvia's pages.
 *
 * It used to sit in index.html, which every route shares, so it was also on
 * the clients' public lead forms. Even with its init skipped there, the ID
 * stayed in the page (the snippet and its <noscript> image), and Meta's pixel
 * helper listed it next to the pixel the form is configured with. Loaded from
 * here, it does not exist at all on a client's page.
 */
export const SENVIA_PIXEL_ID = '2027821837745963';

/** Pages that belong to a client: the public lead forms, and the unsubscribe page their contacts open. */
const CLIENT_PAGES = /^\/(f|c|unsubscribe)(\/|$)/;

/** Meta's base code: defines fbq and loads fbevents.js. A no-op when fbq already exists. */
const FBQ_BASE_CODE =
  "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?" +
  "n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;" +
  "n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;" +
  "t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}" +
  "(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');";

const EXTERNAL_ID_KEY = 'senvia_external_id';

/**
 * One id per visitor, shared with senvia.pt through a cookie on .senvia.pt,
 * so Meta can join a visit to the site with the sign-up in the app.
 */
function visitorExternalId(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('external_id');
  const cookie = document.cookie.match(new RegExp(`(?:^|; )${EXTERNAL_ID_KEY}=([^;]+)`));
  const fromCookie = cookie ? decodeURIComponent(cookie[1]) : '';
  let fromStorage = '';
  try { fromStorage = localStorage.getItem(EXTERNAL_ID_KEY) ?? ''; } catch { /* blocked storage */ }

  const value = fromUrl || fromStorage || fromCookie
    || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  try { localStorage.setItem(EXTERNAL_ID_KEY, value); } catch { /* blocked storage */ }
  document.cookie = `${EXTERNAL_ID_KEY}=${encodeURIComponent(value)}; path=/; domain=.senvia.pt; max-age=31536000; SameSite=Lax; Secure`;
  return value;
}

/** Starts Senvia's pixel and counts the page view — except on a client's page. */
export function loadSenviaPixel(): void {
  if (typeof window === 'undefined' || CLIENT_PAGES.test(window.location.pathname)) return;

  const script = document.createElement('script');
  script.text = FBQ_BASE_CODE;
  document.head.appendChild(script);

  const fbq = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;
  if (!fbq) return;
  fbq('init', SENVIA_PIXEL_ID, { external_id: visitorExternalId() });
  fbq('track', 'PageView');
}
