// Live IMAP connection manager — one per email caixa. Does an initial full sync,
// then holds the INBOX open in IDLE so new mail is synced into Postgres the
// instant it arrives (the frontend updates via Supabase Realtime). Reconnects
// with exponential backoff on drops.
import { ImapFlow } from 'imapflow';
import { imapConfig, getEmailCaixas, getEmailCaixa, smtpTransport } from './caixas.js';
import { syncCaixaFull, syncFolderMessages, backfillBodies } from './sync.js';
import { bodyToHtml } from './commands.js';
import { q } from './db.js';

const managers = new Map();
const log = (...a) => console.log(new Date().toISOString(), ...a);

const VACATION_COOLDOWN_MS = 4 * 24 * 60 * 60 * 1000; // max one auto-reply per sender / 4 days
// Senders we never auto-reply to (bounces, lists, robots) — replying would loop or annoy.
const AUTOMATED_RE = /(^|[._-])(no-?reply|noreply|do-?not-?reply|mailer-daemon|postmaster|bounce|bounces|notifications?|automated|daemon)(@|[._-]|$)/i;

function htmlToPlain(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .trim();
}

// Is "today" inside the vacation window? start required, end optional.
function withinWindow(vac) {
  if (!vac?.start_date) return true; // enabled with no start = always on
  const now = Date.now();
  const start = Date.parse(`${vac.start_date}T00:00:00`);
  if (!Number.isNaN(start) && now < start) return false;
  if (vac.end_date) {
    const end = Date.parse(`${vac.end_date}T23:59:59`);
    if (!Number.isNaN(end) && now > end) return false;
  }
  return true;
}

// only_contacts: does this email belong to a CRM lead or client of the org?
async function isCrmContact(orgId, email) {
  try {
    const rows = await q(
      `SELECT 1 WHERE EXISTS (SELECT 1 FROM crm_clients WHERE organization_id=$1 AND lower(email)=lower($2))
                  OR EXISTS (SELECT 1 FROM leads        WHERE organization_id=$1 AND lower(email)=lower($2)) LIMIT 1`,
      [orgId, email],
    );
    return rows.length > 0;
  } catch (e) {
    log(`[vacation] verificação de contacto CRM falhou: ${e.message}`);
    return false; // conservative: with only_contacts on, don't email non-verifiable senders
  }
}

// How often to poll every OTHER folder's IMAP STATUS for changes IDLE can't see
// (IDLE only covers the single mailbox held open — the Inbox). STATUS is cheap:
// it doesn't select/open the mailbox, just asks the server for counters.
const FOLDER_POLL_MS = 3 * 60 * 1000;

// A sync that never settles — an IMAP fetch or a DB write on a connection that
// died without closing — used to leave `syncing` on for good. New mail and the
// folder poll both skip while it is on, so the caixa went silent for days with
// the process up (2026-09-29 → 10-01). Past this long, a sync is presumed hung:
// the IMAP connection is rebuilt, and connect() resyncs everything.
const SYNC_HANG_MS = 5 * 60 * 1000;
const WATCHDOG_MS = 60 * 1000;

class CaixaManager {
  constructor(caixa) {
    this.caixa = caixa;
    this.client = null;
    this.inboxFolder = null;
    this.stopped = false;
    this.syncing = false;
    this.syncStartedAt = 0;
    // Bumped on every sync: a hung one that settles after the watchdog gave up
    // on it must not switch off the flag of the sync running now.
    this.syncSeq = 0;
    this.reconnectMs = 5000;
    this.reconnectTimer = null;
    this.lastError = null;
    this.folderPollTimer = null;
    this.watchdogTimer = null;
  }

  async start() {
    this.stopped = false;
    if (!this.watchdogTimer) {
      this.watchdogTimer = setInterval(() => this.watchdog(), WATCHDOG_MS);
    }
    await this.connect();
  }

  /** Marks a sync as running; returns the function that marks it finished. */
  beginSync() {
    const seq = ++this.syncSeq;
    this.syncing = true;
    this.syncStartedAt = Date.now();
    return () => { if (this.syncSeq === seq) this.syncing = false; };
  }

  watchdog() {
    if (this.stopped || !this.syncing) return;
    const stuckMs = Date.now() - this.syncStartedAt;
    if (stuckMs < SYNC_HANG_MS) return;
    log(`[${this.caixa.label}] sincronização presa há ${Math.round(stuckMs / 60000)} min — a refazer a ligação`);
    this.lastError = 'sincronização presa; ligação refeita';
    this.syncSeq++;
    this.syncing = false;
    this.forceReconnect();
  }

  /** Drops the current IMAP connection and opens a fresh one (with a full resync). */
  forceReconnect() {
    const old = this.client;
    this.client = null;
    this.clearFolderPoll();
    try { old?.close(); } catch { /* already gone */ }
    this.scheduleReconnect();
  }

  async connect() {
    if (this.stopped) return;
    this.clearFolderPoll(); // guard against connect() being called again mid-poll-cycle (reconnects)
    const endSync = this.beginSync();
    try {
      const client = new ImapFlow(await imapConfig(this.caixa));
      this.client = client;
      client.on('error', (err) => { this.lastError = err.message; });
      // Only the current connection reconnects: one the watchdog already
      // replaced closing late must not open a second, parallel one.
      client.on('close', () => {
        if (!this.stopped && (this.client === client || this.client === null)) this.scheduleReconnect();
      });
      await client.connect();
      log(`[${this.caixa.label}] IMAP ligado`);
      this.reconnectMs = 5000;
      this.lastError = null;

      const byPath = await syncCaixaFull(client, this.caixa, { perFolder: 40, bodyCap: 100 });
      this.inboxFolder = [...byPath.values()].find((f) => f.role === 'inbox') || null;

      if (this.inboxFolder) {
        await client.mailboxOpen(this.inboxFolder.path);
        // Only auto-reply to mail that arrives AFTER we go live — never to the
        // backlog of unread messages synced on connect (that would blast replies).
        this.connectedAt = Date.now();
        // ImapFlow keeps the open mailbox in IDLE; 'exists' fires on new mail.
        client.on('exists', () => this.onNewMail());
        log(`[${this.caixa.label}] a vigiar a Entrada (IDLE)`);
      }

      // Everything besides the Inbox (Sent, Archive, custom folders, junk...) is
      // NOT held open in IDLE, so mail read/moved/arrived there from another
      // device (webmail, phone) would otherwise only be seen on the next full
      // resync/restart. Poll their STATUS periodically and resync headers for
      // any folder whose counters actually changed.
      this.folderPollTimer = setInterval(() => {
        this.pollAllFolders().catch((e) => log(`[${this.caixa.label}] poll de pastas falhou: ${e.message}`));
      }, FOLDER_POLL_MS);
    } catch (err) {
      this.lastError = err.message;
      log(`[${this.caixa.label}] falha de ligação: ${err.message}`);
      this.scheduleReconnect();
    } finally {
      endSync();
    }
  }

  clearFolderPoll() {
    if (this.folderPollTimer) { clearInterval(this.folderPollTimer); this.folderPollTimer = null; }
  }

  // STATUS every folder (cheap — no mailbox select) and resync headers only for
  // ones whose message/unread count or UIDNEXT actually moved since we last saw
  // them. Skips a folder entirely when nothing changed, so a caixa with many
  // custom folders doesn't pay for a full sync every cycle.
  async pollAllFolders() {
    if (!this.client?.usable || this.syncing) return;
    let folders;
    try {
      folders = await q(
        `SELECT id, path, unread_count, total_count, uidnext FROM email_folders WHERE channel_id=$1`,
        [this.caixa.id],
      );
    } catch (e) {
      log(`[${this.caixa.label}] poll de pastas: falha a ler pastas: ${e.message}`);
      return;
    }
    let touchedOtherMailbox = false;
    for (const folder of folders) {
      if (this.stopped || !this.client?.usable) break;
      try {
        const st = await this.client.status(folder.path, { messages: true, unseen: true, uidNext: true });
        const uidNextStr = st.uidNext ? String(st.uidNext) : null;
        const changed = (st.messages ?? 0) !== (folder.total_count ?? 0)
          || (st.unseen ?? 0) !== (folder.unread_count ?? 0)
          || (uidNextStr && uidNextStr !== folder.uidnext);
        if (!changed) continue;
        await syncFolderMessages(this.client, this.caixa, { id: folder.id, path: folder.path }, 25);
        touchedOtherMailbox = true;
        await q(
          `UPDATE email_folders SET total_count=$2, unread_count=$3, uidnext=$4, updated_at=now() WHERE id=$1`,
          [folder.id, st.messages || 0, st.unseen || 0, uidNextStr],
        );
      } catch (e) {
        log(`[${this.caixa.label}] poll de pastas: falha em ${folder.path}: ${e.message}`);
      }
    }
    await this.reselectInbox(touchedOtherMailbox);
    // Heartbeat: every folder was just checked against IMAP. Without it,
    // last_synced_at only moved on a full sync, so a caixa that had stopped
    // syncing looked exactly like one with no new mail.
    if (!this.stopped && this.client?.usable) {
      try {
        await q(`UPDATE email_folders SET last_synced_at=now() WHERE channel_id=$1`, [this.caixa.id]);
      } catch (e) {
        log(`[${this.caixa.label}] aviso ao marcar a sincronização: ${e.message}`);
      }
    }
  }

  // `syncFolderMessages` SELECTs the target folder on our one shared client via
  // getMailboxLock — once the lock is released, ImapFlow's autoIdle resumes
  // IDLE on whatever mailbox ends up selected, NOT automatically back on the
  // Inbox. Without reselecting, 'exists' stops firing for new Inbox mail until
  // something else happens to reselect it — silently degrading "instant"
  // delivery to "whenever the next 3-minute folder poll notices it". Called
  // here after touching another folder, and also used by commands.js after it
  // does the same kind of folder-switching for archive/move/flag/etc actions.
  async reselectInbox(onlyIfTouched = true) {
    if (onlyIfTouched === false) return;
    if (!this.inboxFolder || !this.client?.usable) return;
    try {
      await this.client.mailboxOpen(this.inboxFolder.path);
    } catch (e) {
      log(`[${this.caixa.label}] falha ao reselecionar a Entrada: ${e.message}`);
    }
  }

  async onNewMail() {
    if (!this.client || !this.inboxFolder || this.syncing) return;
    const endSync = this.beginSync();
    try {
      await syncFolderMessages(this.client, this.caixa, this.inboxFolder, 15);
      await backfillBodies(this.client, this.caixa, 15);
      // Refresh the Inbox unread/total counters from IMAP so the folder badge
      // updates on new mail (syncFolderMessages alone doesn't touch the counts).
      try {
        const st = await this.client.status(this.inboxFolder.path, { messages: true, unseen: true });
        await q(
          `UPDATE email_folders SET total_count=$2, unread_count=$3, updated_at=now() WHERE id=$1`,
          [this.inboxFolder.id, st.messages || 0, st.unseen || 0],
        );
      } catch (e) {
        log(`[${this.caixa.label}] aviso ao atualizar contadores: ${e.message}`);
      }
      log(`[${this.caixa.label}] novo email sincronizado`);
    } catch (err) {
      log(`[${this.caixa.label}] erro ao sincronizar novo email: ${err.message}`);
    } finally {
      endSync();
    }
    // Vacation auto-reply runs after sync, outside the sync guard.
    try { await this.maybeVacationReply(); }
    catch (err) { log(`[${this.caixa.label}] erro na resposta de férias: ${err.message}`); }
  }

  // Send the configured vacation auto-reply to senders of newly-arrived mail,
  // respecting the date window, the per-sender 4-day cooldown, the only-contacts
  // option, and skipping automated/own addresses.
  async maybeVacationReply() {
    // Read fresh config from the DB so enabling/disabling vacation takes effect
    // immediately, without waiting for the caixa to reconnect.
    const fresh = await getEmailCaixa(this.caixa.id);
    if (fresh) this.caixa.meta = fresh.meta;
    const vac = this.caixa.meta?.vacation_reply;
    if (!vac?.enabled || !withinWindow(vac)) return;
    if (!vac.subject || !vac.message) return;

    const since = new Date((this.connectedAt || Date.now()) - 2 * 60 * 1000).toISOString();
    const candidates = await q(
      `SELECT id, from_address, from_name, message_id, subject
         FROM email_messages
        WHERE channel_id=$1 AND folder_id=$2 AND seen=false
          AND from_address <> '' AND date > $3
        ORDER BY date DESC LIMIT 10`,
      [this.caixa.id, this.inboxFolder.id, since],
    );
    if (!candidates.length) return;

    const selfAddr = String(this.caixa.meta?.email_address || '').toLowerCase();
    for (const msg of candidates) {
      const to = String(msg.from_address || '').trim();
      const toLc = to.toLowerCase();
      if (!to || toLc === selfAddr) continue;
      if (AUTOMATED_RE.test(to)) continue;

      // Per-sender cooldown.
      const recent = await q(
        `SELECT 1 FROM email_vacation_log
          WHERE channel_id=$1 AND lower(to_address)=lower($2) AND sent_at > now() - interval '4 days' LIMIT 1`,
        [this.caixa.id, to],
      );
      if (recent.length) continue;

      if (vac.only_contacts && !(await isCrmContact(this.caixa.organization_id, to))) continue;

      const html = bodyToHtml(vac.message);
      const subject = /^re:/i.test(msg.subject || '') ? msg.subject : `${vac.subject}`;
      try {
        await (await smtpTransport(this.caixa)).sendMail({
          from: { name: this.caixa.label || '', address: this.caixa.meta.email_address },
          to,
          subject,
          html,
          text: htmlToPlain(html),
          inReplyTo: msg.message_id ? `<${msg.message_id}>` : undefined,
          references: msg.message_id ? `<${msg.message_id}>` : undefined,
          // Mark as auto-generated so well-behaved servers don't auto-reply back.
          headers: { 'Auto-Submitted': 'auto-replied', 'X-Auto-Response-Suppress': 'All' },
        });
        await q(`INSERT INTO email_vacation_log (channel_id, to_address) VALUES ($1,$2)`, [this.caixa.id, to]);
        log(`[${this.caixa.label}] resposta de férias enviada a ${to}`);
      } catch (e) {
        log(`[${this.caixa.label}] falha ao enviar resposta de férias a ${to}: ${e.message}`);
      }
    }
  }

  // Full resync on demand (HTTP trigger).
  async resync() {
    if (!this.client?.usable) throw new Error('caixa desligada');
    if (this.syncing) return;
    const endSync = this.beginSync();
    try {
      await syncCaixaFull(this.client, this.caixa, { perFolder: 50, bodyCap: 200 });
    } finally {
      endSync();
    }
  }

  scheduleReconnect() {
    // One pending reconnect at a time: a failed connect() reports it twice (its
    // catch and the client's close), and two would leave two live connections.
    if (this.stopped || this.reconnectTimer) return;
    const ms = this.reconnectMs;
    this.reconnectMs = Math.min(this.reconnectMs * 2, 60_000);
    log(`[${this.caixa.label}] a reconectar em ${Math.round(ms / 1000)}s`);
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, ms);
  }

  status() {
    return {
      id: this.caixa.id,
      label: this.caixa.label,
      connected: !!this.client?.usable,
      lastError: this.lastError,
      syncingForMs: this.syncing ? Date.now() - this.syncStartedAt : 0,
    };
  }

  async stop() {
    this.stopped = true;
    this.clearFolderPoll();
    if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    try { await this.client?.logout(); } catch { /* ignore */ }
  }
}

// Start a live manager for every email caixa, then poll every 60 s for new/removed ones.
export async function startAll() {
  const caixas = await getEmailCaixas();
  for (const caixa of caixas) {
    const m = new CaixaManager(caixa);
    managers.set(caixa.id, m);
    m.start().catch((e) => log(`[${caixa.label}] start falhou: ${e.message}`));
  }
  // Hot-reload: detect new channels added after gateway startup without restarting.
  setInterval(async () => {
    try {
      const added = await refreshChannels();
      if (added > 0) log(`hot-reload: ${added} nova(s) caixa(s) adicionada(s)`);
    } catch (e) {
      log('hot-reload erro:', e.message);
    }
  }, 60_000);
  return caixas.length;
}

// Detect channels added/removed since startup; start/stop their managers.
export async function refreshChannels() {
  const caixas = await getEmailCaixas();
  const known = new Set(managers.keys());
  let added = 0;
  for (const caixa of caixas) {
    if (!managers.has(caixa.id)) {
      log(`[${caixa.label}] nova caixa detectada, a ligar...`);
      const m = new CaixaManager(caixa);
      managers.set(caixa.id, m);
      m.start().catch((e) => log(`[${caixa.label}] start falhou: ${e.message}`));
      added++;
    }
    known.delete(caixa.id);
  }
  // Stop managers for channels that were removed from the DB.
  for (const removedId of known) {
    const m = managers.get(removedId);
    if (m) {
      log(`[${m.caixa.label}] caixa removida, a desligar...`);
      await m.stop();
      managers.delete(removedId);
    }
  }
  return added;
}

export function getManager(channelId) { return managers.get(channelId); }
export function managerStatus() { return [...managers.values()].map((m) => m.status()); }
export async function stopAll() { for (const m of managers.values()) await m.stop(); }
