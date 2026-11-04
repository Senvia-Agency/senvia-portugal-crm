// Command processor: polls email_commands and executes each over IMAP/SMTP, then
// updates the email tables. Lets the CRM drive actions/sending without the gateway
// being publicly reachable (it only needs the DB it already talks to).
import { randomUUID } from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { simpleParser } from 'mailparser';
import { getEmailCaixa, smtpTransport } from './caixas.js';
import { getManager } from './idle.js';
import { syncFolders, syncFolderMessages, syncOlderMessages, syncUnreadMessages, backfillBodies, fetchMessageBody } from './sync.js';
import { planRules, rulesNeedBody } from './rules.js';
import { q } from './db.js';
import { withHostSlot } from './host-slots.js';
import { smtpErrorMessage, retryableBeforeSend } from './smtp-errors.js';
import { embedInlineImages } from './inline-images.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);

const CLAIM = `
  UPDATE email_commands SET status='processing'
  WHERE id = (SELECT id FROM email_commands WHERE status='pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
  RETURNING *`;

async function getMsg(messageId, caixa) {
  const [m] = await q(
    `SELECT m.id, m.uid, m.folder_id, m.channel_id, m.organization_id, f.path
       FROM email_messages m JOIN email_folders f ON f.id = m.folder_id
      WHERE m.id=$1 AND m.channel_id=$2 AND m.organization_id=$3
        AND f.channel_id=m.channel_id AND f.organization_id=m.organization_id`,
    [messageId, caixa.id, caixa.organization_id],
  );
  return m;
}
async function folderByRole(caixa, role) {
  const [f] = await q(`SELECT id, path FROM email_folders WHERE channel_id=$1 AND role=$2 AND organization_id=$3 LIMIT 1`, [caixa.id, role, caixa.organization_id]);
  return f;
}
async function folderById(id, caixa) {
  const [f] = await q(`SELECT id, path, role FROM email_folders WHERE id=$1 AND channel_id=$2 AND organization_id=$3`, [id, caixa.id, caixa.organization_id]);
  return f;
}

// Folder names the person types. The hierarchy separator and IMAP wildcards would turn one
// name into a path or a pattern, so they are refused rather than silently changed.
export function folderName(raw) {
  const name = String(raw ?? '').trim();
  if (!name || name.length > 60) throw new Error('o nome da pasta tem de ter entre 1 e 60 caracteres');
  if (/[/\\.%*"\u0000-\u001f]/.test(name)) throw new Error('o nome da pasta não pode ter / \\ . % * nem aspas');
  return name;
}

/** The new path of a folder renamed in place: same parent, new last segment. */
export function renamedPath(path, delimiter, name) {
  const at = delimiter ? path.lastIndexOf(delimiter) : -1;
  return at >= 0 ? `${path.slice(0, at + delimiter.length)}${name}` : name;
}

async function boxDelimiter(client, path) {
  const boxes = await client.list();
  return boxes.find((box) => box.path === path)?.delimiter || boxes.find((box) => box.delimiter)?.delimiter || '/';
}

// Only folders the person created (not Inbox, Sent, Trash...) can be renamed or deleted.
async function customFolder(p, caixa) {
  const folder = await folderById(p.folderId, caixa);
  if (!folder) throw new Error('pasta inexistente');
  if (folder.role !== 'custom') throw new Error('as pastas do sistema não podem ser alteradas');
  return folder;
}

async function createFolder(client, caixa, p) {
  const name = folderName(p.name);
  let path = name;
  if (p.parentFolderId) {
    const parent = await folderById(p.parentFolderId, caixa);
    if (!parent) throw new Error('pasta mãe inexistente');
    path = `${parent.path}${await boxDelimiter(client, parent.path)}${name}`;
  }
  await client.mailboxCreate(path);
  await syncFolders(client, caixa);
}

async function renameFolder(client, caixa, p) {
  const folder = await customFolder(p, caixa);
  const name = folderName(p.name);
  const delimiter = await boxDelimiter(client, folder.path);
  const next = renamedPath(folder.path, delimiter, name);
  if (next === folder.path) return;
  await client.mailboxRename(folder.path, next);
  // The folder keeps its row (and its messages); subfolders follow under the new prefix.
  await q(`UPDATE email_folders SET path = $2 || substr(path, length($1) + 1), updated_at = now()
            WHERE channel_id = $3 AND organization_id = $4 AND (path = $1 OR starts_with(path, $5))`,
    [folder.path, next, caixa.id, caixa.organization_id, folder.path + delimiter]);
  await syncFolders(client, caixa);
}

// Deleting an IMAP folder deletes its messages, so only an empty folder without subfolders goes.
async function deleteFolder(client, caixa, p) {
  const folder = await customFolder(p, caixa);
  const delimiter = await boxDelimiter(client, folder.path);
  const [children] = await q(`SELECT count(*)::int AS n FROM email_folders
    WHERE channel_id = $1 AND organization_id = $2 AND starts_with(path, $3)`, [caixa.id, caixa.organization_id, folder.path + delimiter]);
  if (children?.n > 0) throw new Error('apague primeiro as subpastas');
  const rule = await ruleMovingTo(caixa, folder.id);
  if (rule) throw new Error(`a regra "${rule}" move emails para esta pasta: mude-a antes de apagar a pasta`);
  const status = await client.status(folder.path, { messages: true });
  if ((status.messages || 0) > 0) throw new Error('a pasta tem emails: mova-os para outra pasta antes de a apagar');
  await client.mailboxDelete(folder.path);
  await q(`DELETE FROM email_folders WHERE id = $1 AND channel_id = $2 AND organization_id = $3`, [folder.id, caixa.id, caixa.organization_id]);
}

// Postgres "undefined_table": email_rules before its migration ran.
const NO_RULES_TABLE = '42P01';

/** Name of a rule that moves mail to this folder, if any. */
async function ruleMovingTo(caixa, folderId) {
  try {
    const [rule] = await q(`SELECT name FROM email_rules WHERE channel_id = $1 AND organization_id = $2
      AND actions @> jsonb_build_array(jsonb_build_object('type', 'move', 'folderId', $3::text)) LIMIT 1`,
    [caixa.id, caixa.organization_id, folderId]);
    return rule?.name ?? null;
  } catch (e) {
    if (e.code === NO_RULES_TABLE) return null;
    throw e;
  }
}

// Plain text of a body for the "Texto do email" condition.
function bodyText(text, html) {
  return String(text || htmlToPlain(html) || '').slice(0, 100_000);
}

async function runRulePlan(client, caixa, msg, plan) {
  if (plan.seen && !msg.seen) await setFlag(client, msg, '\\Seen', true, 'seen', true, caixa);
  if (plan.flagged && !msg.flagged) await setFlag(client, msg, '\\Flagged', true, 'flagged', true, caixa);
  if (!plan.destination) return;
  const target = plan.destination.folderId
    ? await folderById(plan.destination.folderId, caixa)
    : await folderByRole(caixa, plan.destination.role);
  if (!target) throw new Error('a pasta de destino da regra já não existe');
  if (target.id !== msg.folder_id) await doMove(client, caixa, msg, target);
}

/**
 * Applies the caixa's enabled rules, in order, to the Inbox messages above `afterUid` (oldest
 * first, 50 at a time). Returns the last UID looked at, so each message goes through the rules
 * once, and whether anything was changed on the server.
 */
export async function applyInboxRules(client, caixa, inbox, afterUid) {
  const fresh = await q(
    `SELECT id, uid, folder_id, seen, flagged, from_name, from_address, to_addresses, cc_addresses,
            subject, has_attachments, body_fetched, text_body, html_body
       FROM email_messages
      WHERE folder_id = $1 AND channel_id = $2 AND organization_id = $3 AND uid > $4
      ORDER BY uid LIMIT 50`,
    [inbox.id, caixa.id, caixa.organization_id, afterUid],
  );
  if (!fresh.length) return { lastUid: afterUid, touched: false };
  const lastUid = Number(fresh[fresh.length - 1].uid);

  let rules;
  try {
    rules = await q(
      `SELECT id, name, match_all, conditions, actions, stop_processing FROM email_rules
        WHERE channel_id = $1 AND organization_id = $2 AND enabled ORDER BY position, created_at`,
      [caixa.id, caixa.organization_id],
    );
  } catch (e) {
    if (e.code === NO_RULES_TABLE) return { lastUid, touched: false };
    throw e;
  }
  if (!rules.length) return { lastUid, touched: false };

  const needBody = rulesNeedBody(rules);
  const names = new Map(rules.map((rule) => [rule.id, rule.name]));
  let touched = false;
  for (const row of fresh) {
    const msg = { ...row, path: inbox.path };
    try {
      let body = '';
      if (needBody) {
        const fetched = row.body_fetched ? null : await fetchMessageBody(client, caixa, msg);
        body = fetched ? bodyText(fetched.text, fetched.html) : bodyText(row.text_body, row.html_body);
      }
      const plan = planRules(rules, { ...row, body });
      if (!plan.matched.length) continue;
      touched = true;
      await runRulePlan(client, caixa, msg, plan);
      await q(`UPDATE email_rules SET match_count = match_count + 1, last_matched_at = now() WHERE id = ANY($1::uuid[])`, [plan.matched]);
      log(`[${caixa.label}] regras aplicadas ao email ${row.uid}: ${plan.matched.map((id) => names.get(id)).join(', ')}`);
    } catch (e) {
      log(`[${caixa.label}] regras: falha no email ${row.uid}: ${e.message}`);
    }
  }
  return { lastUid, touched };
}
async function updateCounts(client, folderId, caixa) {
  const f = await folderById(folderId, caixa);
  if (!f) return;
  try {
    const st = await client.status(f.path, { messages: true, unseen: true });
    await q(`UPDATE email_folders SET total_count=$2, unread_count=$3, updated_at=now() WHERE id=$1 AND channel_id=$4 AND organization_id=$5`,
      [folderId, st.messages || 0, st.unseen || 0, caixa.id, caixa.organization_id]);
  } catch { /* ignore */ }
}

async function setFlag(client, msg, flag, add, col, val, caixa) {
  const lock = await client.getMailboxLock(msg.path);
  try {
    if (add) await client.messageFlagsAdd(String(msg.uid), [flag], { uid: true });
    else await client.messageFlagsRemove(String(msg.uid), [flag], { uid: true });
  } finally { lock.release(); }
  await q(`UPDATE email_messages SET ${col}=$2, updated_at=now() WHERE id=$1 AND channel_id=$3 AND organization_id=$4`, [msg.id, val, caixa.id, caixa.organization_id]);
  await updateCounts(client, msg.folder_id, caixa);
}

async function doMove(client, caixa, msg, target) {
  const lock = await client.getMailboxLock(msg.path);
  try { await client.messageMove(String(msg.uid), target.path, { uid: true }); }
  finally { lock.release(); }
  await q(`DELETE FROM email_messages WHERE id=$1 AND channel_id=$2 AND organization_id=$3`, [msg.id, caixa.id, caixa.organization_id]);
  await syncFolderMessages(client, caixa, target, 15);
  await updateCounts(client, msg.folder_id, caixa);
  await updateCounts(client, target.id, caixa);
}

function toAddr(list) {
  if (!list) return undefined;
  const arr = Array.isArray(list) ? list : [list];
  return arr.map((a) => (typeof a === 'string' ? a : { name: a.name || '', address: a.address })).filter(Boolean);
}

// Render a stored signature/message body to HTML. Plain text → escaped + <br>;
// content that already looks like HTML is used as-is.
export function bodyToHtml(raw) {
  const s = String(raw || '');
  if (!s.trim()) return '';
  if (/<(br|p|div|b|i|u|ol|ul|li|a|strong|em|span|table|img|h[1-6])\b/i.test(s)) return s;
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

function htmlToPlain(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .trim();
}

// Append the caixa's default signature to an outgoing message. Picks the "reply"
// default when the message is a reply (has inReplyTo), else the "new" default.
function applySignature(caixa, p) {
  const m = caixa.meta || {};
  const sigs = Array.isArray(m.signatures) ? m.signatures : [];
  if (!sigs.length) return p;
  // The composer now shows the signature INLINE while writing (senvia-signature
  // marker div) so the user sees it before sending, instead of it being a
  // server-side surprise appended after the quoted text. Skip re-adding it here
  // when it's already in the body — otherwise every send would carry two copies.
  // Only look at the part BEFORE any quoted history (marked "senvia-quote" by
  // the composer's quoteHtml()) — a reply/forward thread almost always already
  // carries an OLD signature inside the quoted original, which would otherwise
  // make this check falsely think the NEW content already has one and skip
  // adding it.
  if (p.html) {
    const quoteIdx = p.html.indexOf('senvia-quote');
    const newPart = quoteIdx >= 0 ? p.html.slice(0, quoteIdx) : p.html;
    if (newPart.includes('senvia-signature')) return p;
  }
  const id = p.inReplyTo ? m.signature_default_reply : m.signature_default_new;
  const sig = id ? sigs.find((s) => s.id === id) : null;
  if (!sig || !String(sig.html || '').trim()) return p;
  const sigHtml = bodyToHtml(sig.html);
  const block = `<br><br><div class="senvia-signature">--<br>${sigHtml}</div>`;
  const out = { ...p };
  if (p.html) out.html = `${p.html}${block}`;
  else if (p.text != null) out.text = `${p.text}\n\n--\n${htmlToPlain(sigHtml)}`;
  else out.html = block;
  return out;
}

// Download one attachment's bytes from IMAP and cache them (base64) in the DB,
// so the browser can download it. Re-parses the message source via mailparser
// (reliable across providers).
async function fetchAttachment(client, attachmentId, caixa) {
  const [att] = await q(
    `SELECT a.id, a.filename, a.content_id, m.uid, f.path
       FROM email_attachments a
       JOIN email_messages m ON m.id = a.message_id
       JOIN email_folders f ON f.id = m.folder_id
      WHERE a.id=$1 AND m.channel_id=$2 AND m.organization_id=$3
        AND a.organization_id=m.organization_id
        AND f.channel_id=m.channel_id AND f.organization_id=m.organization_id`,
    [attachmentId, caixa.id, caixa.organization_id],
  );
  if (!att) throw new Error('anexo inexistente');
  const lock = await client.getMailboxLock(att.path);
  let parsed;
  try {
    const fetched = await client.fetchOne(String(att.uid), { source: true }, { uid: true });
    if (!fetched?.source) throw new Error('mensagem sem fonte');
    parsed = await simpleParser(fetched.source);
  } finally { lock.release(); }
  const list = parsed.attachments || [];
  const match = list.find((a) => (att.content_id && a.cid === att.content_id) || a.filename === att.filename)
    || list.find((a) => !!a.content);
  if (!match?.content) throw new Error('anexo não encontrado na mensagem');
  await q(`UPDATE email_attachments a SET data_b64=$2 FROM email_messages m
    WHERE a.id=$1 AND a.message_id=m.id AND a.organization_id=$3
      AND m.organization_id=$3 AND m.channel_id=$4`,
    [att.id, match.content.toString('base64'), caixa.organization_id, caixa.id]);
}

// Gmail, Outlook and most hosting panels already file what goes out by SMTP in Sent,
// sometimes a moment after the send. Look for it a few times before adding our copy.
export async function sentCopyExists(client, path, messageId, { tries = 3, waitMs = 1500 } = {}) {
  const bare = messageId.replace(/^<|>$/g, '');
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    const lock = await client.getMailboxLock(path);
    try {
      const uids = await client.search({ header: { 'message-id': bare } }, { uid: true });
      if (Array.isArray(uids) && uids.length > 0) return true;
    } finally { lock.release(); }
  }
  return false;
}

async function sendMail(caixa, p) {
  const from = { name: caixa.label || '', address: caixa.meta.email_address };
  const domain = String(caixa.meta.email_address || '').split('@')[1] || 'senvia.pt';
  const inline = await embedInlineImages(p.html || '');
  const files = Array.isArray(p.attachments)
    ? p.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.b64 || '', 'base64'), contentType: a.contentType || undefined }))
    : [];
  const opts = {
    disableFileAccess: true,
    disableUrlAccess: true,
    // One Message-ID and date for what is sent and for the Sent copy: the copy can be
    // recognised, and replies thread on the message the recipient actually got.
    messageId: `<${randomUUID()}@${domain}>`,
    date: new Date(),
    from,
    to: toAddr(p.to),
    cc: toAddr(p.cc),
    bcc: toAddr(p.bcc),
    subject: p.subject || '',
    html: inline.html || undefined,
    text: p.text || (p.html ? undefined : ''),
    inReplyTo: p.inReplyTo || undefined,
    references: p.references || undefined,
    attachments: files.length || inline.attachments.length ? [...files, ...inline.attachments] : undefined,
  };
  // Build raw MIME once (for the Sent copy), then send via SMTP.
  const raw = await new Promise((res, rej) =>
    new MailComposer(opts).compile().build((e, m) => (e ? rej(e) : res(m))));
  const server = caixa.meta.smtp_server;
  const deliver = async () => (await smtpTransport(caixa)).sendMail(opts);
  try {
    await withHostSlot(`smtp:${server}`, async () => {
      try { await deliver(); }
      catch (e) {
        // A connection that failed before the server took anything: one more try.
        if (!retryableBeforeSend(e)) throw e;
        log(`[${caixa.label}] SMTP falhou a ligar (${e.code}); nova tentativa`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await deliver();
      }
    });
  } catch (e) {
    log(`[${caixa.label}] envio falhou: ${e.code || ''} ${e.responseCode || ''} ${e.message}`);
    throw new Error(smtpErrorMessage(e, server));
  }

  // Save a copy to the Sent folder (best-effort), unless the server already did.
  const sent = await folderByRole(caixa, 'sent');
  const client = getManager(caixa.id)?.client;
  if (sent && client?.usable) {
    try {
      if (!(await sentCopyExists(client, sent.path, opts.messageId))) {
        await client.append(sent.path, raw, ['\\Seen']);
      }
      await syncFolderMessages(client, caixa, sent, 10);
      await updateCounts(client, sent.id, caixa);
    } catch (e) { log(`[${caixa.label}] aviso ao gravar em Enviados: ${e.message}`); }
  }
}

async function execute(cmd) {
  if (!cmd.created_by) throw new Error('comando não autorizado');
  const caixa = await getEmailCaixa(cmd.channel_id);
  if (!caixa) throw new Error('caixa não encontrada');
  if (caixa.organization_id !== cmd.organization_id) throw new Error('comando não autorizado');
  const [access] = await q(`SELECT EXISTS (
    SELECT 1 FROM messaging_channels c
    WHERE c.id=$1 AND c.organization_id=$2 AND c.channel_type='email' AND c.archived_at IS NULL
      AND (
        EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id=$3 AND ur.role='super_admin')
        OR EXISTS (
          SELECT 1 FROM organization_members om
          LEFT JOIN organization_profiles op ON op.id=om.profile_id AND op.organization_id=om.organization_id
          WHERE om.organization_id=c.organization_id AND om.user_id=$3 AND om.is_active=true
            AND (coalesce(cardinality(c.assigned_user_ids),0)=0
              OR $3=ANY(c.assigned_user_ids) OR om.role='admin' OR op.base_role='admin')
        )
      )
  ) AS allowed`, [caixa.id, caixa.organization_id, cmd.created_by]);
  if (access?.allowed !== true) throw new Error('comando não autorizado');
  const p = cmd.payload || {};
  // Sending only needs SMTP: an IMAP connection that is down must not block it
  // (the Sent copy is best-effort and waits for the next sync).
  if (cmd.type === 'send') return sendMail(caixa, applySignature(caixa, p));
  const client = getManager(cmd.channel_id)?.client;
  if (!client?.usable) {
    const lastError = getManager(cmd.channel_id)?.lastError;
    throw new Error(`A ligação IMAP da caixa está em baixo${lastError ? ` (${lastError})` : ''}. Tente daqui a pouco.`);
  }

  switch (cmd.type) {
    case 'mark_read': { const m = await getMsg(p.messageId, caixa); if (!m) throw new Error('mensagem inexistente'); return setFlag(client, m, '\\Seen', true, 'seen', true, caixa); }
    case 'mark_unread': { const m = await getMsg(p.messageId, caixa); if (!m) throw new Error('mensagem inexistente'); return setFlag(client, m, '\\Seen', false, 'seen', false, caixa); }
    case 'flag': { const m = await getMsg(p.messageId, caixa); if (!m) throw new Error('mensagem inexistente'); return setFlag(client, m, '\\Flagged', true, 'flagged', true, caixa); }
    case 'unflag': { const m = await getMsg(p.messageId, caixa); if (!m) throw new Error('mensagem inexistente'); return setFlag(client, m, '\\Flagged', false, 'flagged', false, caixa); }
    case 'delete': case 'spam': case 'archive': {
      const m = await getMsg(p.messageId, caixa); if (!m) throw new Error('mensagem inexistente');
      const role = cmd.type === 'delete' ? 'trash' : cmd.type === 'spam' ? 'junk' : 'archive';
      const target = await folderByRole(caixa, role);
      if (!target) throw new Error(`pasta "${role}" não existe nesta conta`);
      return doMove(client, caixa, m, target);
    }
    case 'move': {
      const m = await getMsg(p.messageId, caixa); if (!m) throw new Error('mensagem inexistente');
      const target = await folderById(p.targetFolderId, caixa);
      if (!target) throw new Error('pasta destino inexistente');
      return doMove(client, caixa, m, target);
    }
    case 'mark_folder_read': {
      const target = await folderById(p.folderId, caixa);
      if (!target) throw new Error('pasta inexistente');
      const lock = await client.getMailboxLock(target.path);
      try {
        // One IMAP op: add \Seen to every UNSEEN message in the folder.
        const unseen = await client.search({ seen: false }, { uid: true });
        if (unseen.length) await client.messageFlagsAdd(unseen, ['\\Seen'], { uid: true });
      } finally { lock.release(); }
      await q(`UPDATE email_messages SET seen=true, updated_at=now() WHERE folder_id=$1 AND seen=false AND channel_id=$2 AND organization_id=$3`, [target.id, caixa.id, caixa.organization_id]);
      return updateCounts(client, target.id, caixa);
    }
    case 'load_older': {
      const target = await folderById(p.folderId, caixa);
      if (!target) throw new Error('pasta inexistente');
      const n = await syncOlderMessages(client, caixa, target, p.batch || 40);
      if (n) await backfillBodies(client, caixa, p.batch || 40, target.id);
      await updateCounts(client, target.id, caixa);
      log(`load_older: +${n} em ${target.path}`);
      return;
    }
    case 'sync_unread': {
      const target = await folderById(p.folderId, caixa);
      if (!target) throw new Error('pasta inexistente');
      const n = await syncUnreadMessages(client, caixa, target, 200);
      if (n) await backfillBodies(client, caixa, 80, target.id);
      await updateCounts(client, target.id, caixa);
      log(`sync_unread: +${n} em ${target.path}`);
      return;
    }
    case 'fetch_body': {
      const m = await getMsg(p.messageId, caixa);
      if (!m) throw new Error('mensagem inexistente');
      return fetchMessageBody(client, caixa, m);
    }
    case 'fetch_attachment': return fetchAttachment(client, p.attachmentId, caixa);
    case 'create_folder': return createFolder(client, caixa, p);
    case 'rename_folder': return renameFolder(client, caixa, p);
    case 'delete_folder': return deleteFolder(client, caixa, p);
    default: throw new Error(`tipo desconhecido: ${cmd.type}`);
  }
}

let running = false;
async function drain() {
  if (running) return;
  running = true;
  const touchedChannels = new Set();
  try {
    for (;;) {
      const [cmd] = await q(CLAIM);
      if (!cmd) break;
      touchedChannels.add(cmd.channel_id);
      try {
        await execute(cmd);
        await q(`UPDATE email_commands SET status='done', processed_at=now() WHERE id=$1`, [cmd.id]);
        log(`comando ${cmd.type} ok`);
      } catch (e) {
        await q(`UPDATE email_commands SET status='error', error=$2, processed_at=now() WHERE id=$1`,
          [cmd.id, String(e.message).slice(0, 500)]);
        log(`comando ${cmd.type} ERRO: ${e.message}`);
      }
    }
  } finally {
    running = false;
    // Almost every command above does its IMAP work via getMailboxLock on the
    // caixa's one shared client (the same connection idle.js keeps open in
    // IDLE on the Inbox) — once the lock releases, autoIdle resumes on
    // whatever mailbox that left selected, not automatically back on the
    // Inbox. Reselect it for every caixa touched this cycle so real-time
    // new-mail delivery doesn't quietly degrade to the 3-minute folder poll
    // every time the user archives/flags/moves an email.
    for (const channelId of touchedChannels) {
      await getManager(channelId)?.reselectInbox();
    }
  }
}

export function startCommandLoop() {
  setInterval(() => { drain().catch(() => {}); }, 2500);
  log('processador de comandos ativo (poll 2.5s)');
}
