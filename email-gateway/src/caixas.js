// Per-caixa credentials. Production reads IMAP/SMTP settings from the email
// caixa's metadata in messaging_channels (one connection manager per caixa).
// Credentials never leave the server.
import nodemailer from 'nodemailer';
import { q } from './db.js';
import { mailEndpoint } from './egress.js';

// As passwords vivem em `messaging_channel_secrets`, não no metadata.
//
// Estavam em `messaging_channels.metadata`, que o CRM lia com `select('*')` —
// ou seja, a password da caixa de correio da empresa era descarregada para o
// browser de qualquer membro da organização. Saíram para uma tabela com RLS e
// zero políticas: só o service_role e este gateway (que liga por Postgres
// direto) lá chegam.
//
// O `COALESCE` com o metadata é a rede de segurança da transição: enquanto uma
// caixa antiga ainda não tiver sido copiada para o cofre, continua a funcionar
// em vez de deixar de receber email em silêncio.
const SELECT_CAIXA = `
  SELECT c.id, c.organization_id, c.label, c.metadata,
         COALESCE(s.imap_password, c.metadata->>'imap_password') AS imap_password,
         COALESCE(s.smtp_password, c.metadata->>'smtp_password') AS smtp_password
    FROM messaging_channels c
    LEFT JOIN messaging_channel_secrets s ON s.channel_id = c.id
   WHERE c.channel_type='email' AND c.archived_at IS NULL`;

const paraCaixa = (r) => ({
  id: r.id,
  organization_id: r.organization_id,
  label: r.label,
  meta: {
    ...(r.metadata || {}),
    imap_password: r.imap_password,
    smtp_password: r.smtp_password,
  },
});

// All email caixas of all orgs, with their connection metadata.
export async function getEmailCaixas() {
  const rows = await q(SELECT_CAIXA);
  return rows
    .map(paraCaixa)
    .filter((c) => c.meta.imap_server && c.meta.imap_password);
}

export async function getEmailCaixa(channelId) {
  const [r] = await q(`${SELECT_CAIXA} AND c.id=$1`, [channelId]);
  if (!r) return null;
  return paraCaixa(r);
}

// ImapFlow config for a caixa.
export async function imapConfig(caixa) {
  const m = caixa.meta;
  const port = Number(m.imap_port ?? 993);
  const endpoint = await mailEndpoint(m.imap_server, port, 'imap');
  const secure = m.imap_ssl !== false;
  return {
    ...endpoint,
    secure,
    doSTARTTLS: secure ? undefined : true,
    tls: { rejectUnauthorized: true },
    auth: { user: (m.imap_login || m.email_address || '').trim(), pass: m.imap_password },
    logger: false,
    // Don't let a slow mailbox wedge the whole manager.
    socketTimeout: 60_000,
  };
}

// Nodemailer transport for a caixa (used by send, Phase 4). Port 465 = SSL/TLS.
export async function smtpTransport(caixa) {
  const m = caixa.meta;
  const port = Number(m.smtp_port ?? 587);
  const endpoint = await mailEndpoint(m.smtp_server, port, 'smtp');
  return nodemailer.createTransport({
    ...endpoint,
    secure: port === 465 || m.smtp_ssl === true,
    requireTLS: true,
    tls: { servername: endpoint.servername, rejectUnauthorized: true },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
    disableFileAccess: true,
    disableUrlAccess: true,
    auth: { user: (m.smtp_login || m.email_address || '').trim(), pass: m.smtp_password },
  });
}
