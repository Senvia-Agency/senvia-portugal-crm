/** Finds IMAP/SMTP servers for an address, as Realize does in the browser: known hosts, Thunderbird's ISPDB, MX records, then a guess. */
export interface ServerSettings {
  readonly imapHost: string;
  readonly imapPort: number;
  readonly smtpHost: string;
  readonly smtpPort: number;
}
export type DiscoverySource = 'known' | 'ispdb' | 'mx' | 'guess';
export type Discovery =
  | { readonly kind: 'servers'; readonly servers: ServerSettings; readonly source: DiscoverySource; readonly note?: string }
  | { readonly kind: 'microsoft' };

export interface ProviderPreset {
  readonly key: string;
  readonly name: string;
  readonly subtitle: string;
  readonly mark: string;
  readonly tile: readonly [string, string];
  readonly servers: ServerSettings | null;
  /** Needs Microsoft sign-in (OAuth), which arrives in the next phase. */
  readonly microsoft?: boolean;
  readonly help?: string;
}

const GMAIL: ServerSettings = { imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 465 };
const ICLOUD: ServerSettings = { imapHost: 'imap.mail.me.com', imapPort: 993, smtpHost: 'smtp.mail.me.com', smtpPort: 587 };
const YAHOO: ServerSettings = { imapHost: 'imap.mail.yahoo.com', imapPort: 993, smtpHost: 'smtp.mail.yahoo.com', smtpPort: 465 };
const AOL: ServerSettings = { imapHost: 'imap.aol.com', imapPort: 993, smtpHost: 'smtp.aol.com', smtpPort: 465 };
const SAPO: ServerSettings = { imapHost: 'imap.sapo.pt', imapPort: 993, smtpHost: 'smtp.sapo.pt', smtpPort: 465 };

export const PROVIDERS: readonly ProviderPreset[] = [
  { key: 'gmail', name: 'Gmail', subtitle: 'e Google Workspace', mark: 'G', tile: ['4 90% 62%', '4 80% 50%'], servers: GMAIL,
    help: 'Na conta Google, ative a verificação em dois passos e crie uma "palavra-passe de aplicação" para usar aqui.' },
  { key: 'outlook', name: 'Outlook', subtitle: 'Outlook.com e Hotmail', mark: 'O', tile: ['207 90% 58%', '214 85% 46%'], servers: null, microsoft: true },
  { key: 'office365', name: 'Microsoft 365', subtitle: 'Contas de empresa', mark: 'M', tile: ['18 90% 58%', '12 85% 50%'], servers: null, microsoft: true },
  { key: 'icloud', name: 'iCloud', subtitle: 'Mail do iCloud', mark: 'i', tile: ['210 10% 60%', '215 14% 42%'], servers: ICLOUD,
    help: 'Em appleid.apple.com crie uma palavra-passe específica para apps e use-a aqui.' },
  { key: 'yahoo', name: 'Yahoo!', subtitle: 'Yahoo Mail', mark: 'Y', tile: ['268 75% 62%', '262 70% 48%'], servers: YAHOO,
    help: 'Nas definições de segurança do Yahoo, gere uma palavra-passe de aplicação.' },
  { key: 'aol', name: 'AOL', subtitle: 'AOL Mail', mark: 'A', tile: ['200 10% 40%', '205 14% 25%'], servers: AOL },
  { key: 'sapo', name: 'SAPO', subtitle: 'Mail do SAPO', mark: 'S', tile: ['145 63% 45%', '150 70% 32%'], servers: SAPO },
  { key: 'imap', name: 'Outra caixa', subtitle: 'IMAP e SMTP do seu domínio', mark: '@', tile: ['221 83% 60%', '226 70% 45%'], servers: null },
];

const KNOWN: Record<string, ServerSettings> = {
  'gmail.com': GMAIL, 'googlemail.com': GMAIL,
  'icloud.com': ICLOUD, 'me.com': ICLOUD, 'mac.com': ICLOUD,
  'yahoo.com': YAHOO, 'yahoo.pt': YAHOO, 'ymail.com': YAHOO,
  'aol.com': AOL, 'sapo.pt': SAPO,
};
const MICROSOFT_CONSUMER = /^(outlook|hotmail|live|msn)\.[a-z.]+$/;

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms = 4000): Promise<T | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  return run(controller.signal).catch(() => null).finally(() => window.clearTimeout(timer));
}

async function ispdb(domain: string): Promise<ServerSettings | null> {
  return withTimeout(async signal => {
    const response = await fetch(`https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`, { signal });
    if (!response.ok) return null;
    const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
    const incoming = xml.querySelector('incomingServer[type="imap"]');
    const outgoing = xml.querySelector('outgoingServer[type="smtp"]');
    const host = (node: Element | null) => node?.querySelector('hostname')?.textContent?.trim().replace('%EMAILDOMAIN%', domain) ?? '';
    const port = (node: Element | null) => Number(node?.querySelector('port')?.textContent ?? 0);
    if (!host(incoming) || !host(outgoing)) return null;
    return { imapHost: host(incoming), imapPort: port(incoming) || 993, smtpHost: host(outgoing), smtpPort: port(outgoing) || 465 };
  });
}

async function mxHosts(domain: string): Promise<string[]> {
  const read = (url: string) => withTimeout(async signal => {
    const response = await fetch(url, { signal, headers: { accept: 'application/dns-json' } });
    if (!response.ok) return null;
    const body = await response.json() as { Answer?: { data?: string }[] };
    return (body.Answer ?? []).map(answer => (answer.data ?? '').split(' ').pop()?.replace(/\.$/, '').toLowerCase() ?? '').filter(Boolean);
  });
  return (await read(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`))
    ?? (await read(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`)) ?? [];
}

const baseDomain = (host: string) => host.split('.').slice(-2).join('.');

/** Only the domain leaves the browser (to the DNS and Thunderbird directories), never the address or password. */
export async function discoverServers(email: string): Promise<Discovery | null> {
  const domain = email.split('@')[1]?.trim().toLowerCase();
  if (!domain || !domain.includes('.')) return null;
  if (KNOWN[domain]) return { kind: 'servers', servers: KNOWN[domain], source: 'known' };
  if (MICROSOFT_CONSUMER.test(domain)) return { kind: 'microsoft' };
  const [fromIspdb, mx] = await Promise.all([ispdb(domain), mxHosts(domain)]);
  if (mx.some(host => host.endsWith('protection.outlook.com') || host.endsWith('outlook.com'))) return { kind: 'microsoft' };
  if (mx.some(host => host.endsWith('google.com') || host.endsWith('googlemail.com'))) {
    return { kind: 'servers', servers: GMAIL, source: 'mx', note: 'O domínio usa Google Workspace: use uma palavra-passe de aplicação.' };
  }
  if (fromIspdb) return { kind: 'servers', servers: fromIspdb, source: 'ispdb' };
  const mxBase = mx[0] ? baseDomain(mx[0]) : null;
  if (mxBase && mxBase !== domain) {
    const shared = await ispdb(mxBase);
    if (shared) return { kind: 'servers', servers: shared, source: 'mx' };
    return { kind: 'servers', servers: { imapHost: mx[0], imapPort: 993, smtpHost: mx[0], smtpPort: 465 }, source: 'mx' };
  }
  return { kind: 'servers', servers: { imapHost: `mail.${domain}`, imapPort: 993, smtpHost: `mail.${domain}`, smtpPort: 465 }, source: 'guess' };
}

export const SOURCE_LABEL: Record<DiscoverySource, string> = {
  known: 'Servidores conhecidos deste fornecedor',
  ispdb: 'Encontrados no diretório da Mozilla Thunderbird',
  mx: 'Deduzidos dos registos MX do domínio',
  guess: 'Sugestão a partir do domínio — confirme com o seu fornecedor',
};
