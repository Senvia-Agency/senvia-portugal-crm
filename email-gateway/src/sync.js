// Core sync: IMAP folders + message headers → Postgres (email_folders / email_messages).
// Body + attachments are fetched lazily (on open) in a later pass — this keeps the
// initial sync fast even on mailboxes with thousands of messages.
import { simpleParser } from 'mailparser';
import { q } from './db.js';
import { folderRole, roleSort } from './imap-roles.js';

function addrs(list) {
  if (!Array.isArray(list)) return [];
  return list.map((a) => ({ name: a.name || '', address: a.address || '' }));
}

function stripBrackets(id) {
  return id ? String(id).replace(/^<|>$/g, '') : null;
}

// A message has attachments if any body part is disposition=attachment or carries a filename.
function hasAttachments(node) {
  if (!node) return false;
  if (node.disposition === 'attachment') return true;
  const fn = node.dispositionParameters?.filename || node.parameters?.name;
  if (fn && node.disposition !== 'inline') return true;
  if (Array.isArray(node.childNodes)) return node.childNodes.some(hasAttachments);
  return false;
}

// Upsert all mailboxes of a caixa into email_folders. Returns the folder rows
// (with their DB ids) keyed by IMAP path.
export async function syncFolders(client, channel) {
  const boxes = await client.list();
  const byPath = new Map();
  for (const box of boxes) {
    if (box.path === '[Gmail]') continue; // Gmail's non-selectable parent
    const role = folderRole(box);
    let status = { messages: 0, unseen: 0, uidValidity: null, uidNext: null };
    try {
      status = await client.status(box.path, { messages: true, unseen: true, uidValidity: true, uidNext: true });
    } catch { /* some parents aren't selectable */ }
    const rows = await q(
      `INSERT INTO email_folders
         (organization_id, channel_id, path, name, role, special_use, parent_path,
          unread_count, total_count, uidvalidity, uidnext, sort, last_synced_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), now())
       ON CONFLICT (channel_id, path) DO UPDATE SET
         name=EXCLUDED.name, role=EXCLUDED.role, special_use=EXCLUDED.special_use,
         parent_path=EXCLUDED.parent_path,
         unread_count=EXCLUDED.unread_count, total_count=EXCLUDED.total_count,
         uidvalidity=EXCLUDED.uidvalidity, uidnext=EXCLUDED.uidnext,
         last_synced_at=now(), updated_at=now()
       RETURNING id, path, role`,
      [
        channel.organization_id, channel.id, box.path,
        box.name || box.path.split(/[/.]/).pop(), role, box.specialUse || null,
        box.parent?.length ? box.parent.join('/') : null,
        status.unseen || 0, status.messages || 0,
        status.uidValidity ? String(status.uidValidity) : null,
        status.uidNext ? String(status.uidNext) : null,
        roleSort(role),
      ],
    );
    byPath.set(box.path, rows[0]);
  }
  return byPath;
}

// Fetch + parse the full body of one message (on demand, when the user opens it).
// Downloads the raw RFC822 source, parses MIME (mailparser), stores html/text +
// attachment metadata. Returns { html, text, attachments }.
export async function fetchMessageBody(client, channel, msg) {
  const lock = await client.getMailboxLock(msg.path);
  try {
    const fetched = await client.fetchOne(String(msg.uid), { source: true }, { uid: true });
    if (!fetched?.source) return null;
    const parsed = await simpleParser(fetched.source);

    const html = parsed.html || (parsed.textAsHtml ?? null);
    const text = parsed.text || null;
    const snippet = (parsed.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);

    await q(
      `UPDATE email_messages
         SET html_body=$2, text_body=$3, snippet=$4, body_fetched=true, updated_at=now()
       WHERE id=$1`,
      [msg.id, html, text, snippet],
    );

    // Replace attachment metadata (idempotent on re-fetch). Binary content stays
    // in IMAP; we download to Storage on demand when the user clicks it.
    await q(`DELETE FROM email_attachments WHERE message_id=$1`, [msg.id]);
    const atts = parsed.attachments || [];
    for (const a of atts) {
      await q(
        `INSERT INTO email_attachments
           (organization_id, message_id, part_id, filename, content_type, size, inline, content_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          channel.organization_id, msg.id, a.partId || null,
          a.filename || 'anexo', a.contentType || 'application/octet-stream',
          a.size || null, !!a.related || a.contentDisposition === 'inline',
          a.cid || null,
        ],
      );
    }
    return { html, text, attachments: atts.map((a) => ({ filename: a.filename, size: a.size, type: a.contentType })) };
  } finally {
    lock.release();
  }
}

// Fetch bodies for messages of a caixa that don't have one yet (eager backfill).
// Pass folderId to scope the backfill to a single folder (used by "load older").
export async function backfillBodies(client, caixa, cap = 150, folderId = null) {
  const pending = await q(
    `SELECT m.id, m.uid, f.path
       FROM email_messages m JOIN email_folders f ON f.id = m.folder_id
      WHERE m.channel_id=$1 AND m.body_fetched=false ${folderId ? 'AND m.folder_id=$3' : ''}
      ORDER BY m.date DESC LIMIT $2`,
    folderId ? [caixa.id, cap, folderId] : [caixa.id, cap],
  );
  let done = 0;
  for (const msg of pending) {
    try { await fetchMessageBody(client, caixa, msg); done++; } catch { /* skip */ }
  }
  return done;
}

// Full sync of a caixa: every folder's headers + a body backfill. Used by the
// live server on startup and by the sync-all script.
export async function syncCaixaFull(client, caixa, { perFolder = 40, bodyCap = 150 } = {}) {
  const byPath = await syncFolders(client, caixa);
  for (const f of byPath.values()) {
    try { await syncFolderMessages(client, caixa, f, perFolder); } catch { /* non-selectable parent */ }
  }
  await backfillBodies(client, caixa, bodyCap);
  return byPath;
}

// Insert/update one message header row from a fetched IMAP message.
async function insertHeader(channel, folder, msg) {
  const env = msg.envelope || {};
  const from = env.from?.[0] || {};
  const refs = (env.inReplyTo ? [stripBrackets(env.inReplyTo)] : []);
  const messageId = stripBrackets(env.messageId);
  const threadId = refs[0] || stripBrackets(env.inReplyTo) || messageId;
  await q(
    `INSERT INTO email_messages
       (organization_id, channel_id, folder_id, uid, message_id, thread_id, in_reply_to,
        from_name, from_address, to_addresses, cc_addresses, bcc_addresses,
        subject, date, seen, flagged, answered, draft, has_attachments, size, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20, now())
     ON CONFLICT (channel_id, folder_id, uid) DO UPDATE SET
       seen=EXCLUDED.seen, flagged=EXCLUDED.flagged, answered=EXCLUDED.answered,
       draft=EXCLUDED.draft, updated_at=now()`,
    [
      channel.organization_id, channel.id, folder.id, Number(msg.uid),
      messageId, threadId, stripBrackets(env.inReplyTo),
      from.name || '', from.address || '',
      JSON.stringify(addrs(env.to)), JSON.stringify(addrs(env.cc)), JSON.stringify(addrs(env.bcc)),
      env.subject || '', env.date || msg.internalDate || null,
      msg.flags?.has('\\Seen') || false, msg.flags?.has('\\Flagged') || false,
      msg.flags?.has('\\Answered') || false, msg.flags?.has('\\Draft') || false,
      hasAttachments(msg.bodyStructure), msg.size || null,
    ],
  );
}

const FETCH_FIELDS = { uid: true, envelope: true, flags: true, size: true, bodyStructure: true, internalDate: true };

// Sync the most recent `limit` messages (headers only) of one folder into email_messages.
export async function syncFolderMessages(client, channel, folder, limit = 50) {
  const lock = await client.getMailboxLock(folder.path);
  let count = 0;
  try {
    const total = client.mailbox.exists;
    if (!total) return 0;
    const start = Math.max(1, total - limit + 1);
    for await (const msg of client.fetch(`${start}:*`, FETCH_FIELDS)) {
      await insertHeader(channel, folder, msg);
      count++;
    }
  } finally {
    lock.release();
  }
  return count;
}

// Sync the headers of all UNSEEN messages in a folder (regardless of how deep they
// are), so the "Não lidos" filter can show unread mail outside the recent window.
export async function syncUnreadMessages(client, channel, folder, cap = 200) {
  const lock = await client.getMailboxLock(folder.path);
  let count = 0;
  try {
    const unseen = await client.search({ seen: false }, { uid: true });
    if (!unseen?.length) return 0;
    const slice = unseen.slice(-cap); // newest `cap` unseen if there are very many
    for await (const msg of client.fetch(slice, FETCH_FIELDS, { uid: true })) {
      await insertHeader(channel, folder, msg);
      count++;
    }
  } finally {
    lock.release();
  }
  return count;
}

// Sync the next batch of OLDER headers — those below the oldest UID already in the
// DB for this folder. Used by the "carregar mais antigos" action. Returns the count.
export async function syncOlderMessages(client, channel, folder, batch = 40) {
  const lock = await client.getMailboxLock(folder.path);
  let count = 0;
  try {
    const [{ min }] = await q(`SELECT MIN(uid) AS min FROM email_messages WHERE folder_id=$1`, [folder.id]);
    if (!min) return 0;
    // Lightweight UID-only search for everything below our oldest, then take the newest `batch`.
    const below = await client.search({ uid: `1:${Number(min) - 1}` }, { uid: true });
    if (!below?.length) return 0;
    const slice = below.slice(-batch);
    for await (const msg of client.fetch(slice, FETCH_FIELDS, { uid: true })) {
      await insertHeader(channel, folder, msg);
      count++;
    }
  } finally {
    lock.release();
  }
  return count;
}
