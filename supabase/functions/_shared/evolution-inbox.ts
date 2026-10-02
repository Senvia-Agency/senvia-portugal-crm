// WhatsApp by QR code (Evolution), delivered to the CRM's own inbox.
//
// The first Evolution integration made Chatwoot the inbox: the CRM was a
// Chatwoot client, 5 800 lines of it. Since then the inbox reads its own tables
// (meta_conversations / meta_messages), and Instagram and Messenger already
// land there. A WhatsApp number linked by QR lands there too: Evolution posts
// every message to `evolution-webhook`, which stores it exactly like the Meta
// webhook stores a WhatsApp Cloud API message. Chatwoot stays as a mirror,
// wired by whatsapp-status, for whoever wants to answer from chat.senvia.pt.
//
// A channel created this way carries `metadata.native_inbox = true`. That flag
// is what separates it from the twelve rows of the first integration, which
// are still in the table and must stay invisible — they point at instances
// nobody is watching.

import type { MulticanalConfig } from './multicanal.ts';
import { evolutionFetch } from './multicanal.ts';

/**
 * WhatsApp message types that are signalling, not something a person wrote:
 * stored, they would only ever show as "[tipo]" bubbles.
 */
export const SIGNALLING_TYPES = new Set([
  'secretEncryptedMessage',
  'encReactionMessage',
  'encEventResponseMessage',
  'senderKeyDistributionMessage',
  'keepInChatMessage',
  'pinInChatMessage',
]);

/** Events the inbox needs. `SEND_MESSAGE` covers replies typed in Chatwoot. */
export const EVOLUTION_WEBHOOK_EVENTS = [
  'CONNECTION_UPDATE',
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'MESSAGES_DELETE',
  'SEND_MESSAGE',
];

export interface NativeChannelRow {
  id: string;
  organization_id: string;
  evolution_instance: string | null;
  metadata?: Record<string, unknown> | null;
  archived_at?: string | null;
}

export function isNativeEvolution(ch: { provider?: string | null; metadata?: unknown } | null | undefined): boolean {
  return !!ch && ch.provider === 'evolution'
    && (ch.metadata as { native_inbox?: unknown } | null)?.native_inbox === true;
}

async function hmacHex(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Per-instance secret for the webhook URL. Derived, not stored: Evolution only
 * lets us set a URL, and a derived token needs no table and no rotation job —
 * whatsapp-status re-applies the URL whenever a number reconnects.
 */
export async function webhookToken(serviceKey: string, instance: string): Promise<string> {
  return (await hmacHex(serviceKey, `evolution-webhook:${instance}`)).slice(0, 48);
}

export async function webhookUrlFor(cfg: MulticanalConfig, instance: string): Promise<string> {
  const token = await webhookToken(cfg.serviceKey, instance);
  return `${cfg.supabaseUrl}/functions/v1/evolution-webhook`
    + `?instance=${encodeURIComponent(instance)}&token=${token}`;
}

/** Point an instance's webhook at the inbox. Idempotent; safe on every connect. */
export async function configureInstanceWebhook(cfg: MulticanalConfig, instance: string): Promise<boolean> {
  const res = await evolutionFetch(cfg, `/webhook/set/${instance}`, 'POST', {
    webhook: {
      enabled: true,
      url: await webhookUrlFor(cfg, instance),
      byEvents: false,
      // Files are fetched on demand by meta-media. Inlined, a single video
      // would turn one webhook call into tens of megabytes.
      base64: false,
      events: EVOLUTION_WEBHOOK_EVENTS,
    },
  });
  if (!res.ok) console.error(`webhook/set ${instance}: ${res.status} ${await res.text()}`);
  return res.ok;
}

/**
 * The other side of a chat, as stored in `meta_conversations.contact_ref`.
 *
 * Digits only for a phone number, the same shape the Cloud API uses, so a
 * conversation matches its lead by phone whichever way the number is linked.
 * WhatsApp has been replacing phone JIDs with anonymous ones (`@lid`); when
 * Evolution gives the phone alongside, the phone wins. When it does not, the
 * raw `…@lid` is kept — Evolution accepts it back as a recipient.
 *
 * Groups, status stories and channels return null: the inbox is one-to-one.
 */
export function contactRefFromJid(
  jid: string | null | undefined,
  alternatives: Array<string | null | undefined> = [],
): string | null {
  const raw = String(jid ?? '');
  if (!raw || /@(g\.us|broadcast|newsletter)$/.test(raw)) return null;
  if (raw.endsWith('@lid')) {
    const phone = alternatives.find((a) => a && /@s\.whatsapp\.net$/.test(String(a)));
    return phone ? String(phone).split('@')[0].split(':')[0] : raw;
  }
  return raw.split('@')[0].split(':')[0] || null;
}

/** Inverse of contactRefFromJid, for sending. */
export function jidFor(contactRef: string): string {
  return contactRef.includes('@') ? contactRef : `${contactRef}@s.whatsapp.net`;
}

/** Evolution delivery states → the vocabulary the inbox already renders. */
export function deliveryStatusFrom(status: unknown): 'sent' | 'delivered' | 'read' | 'failed' | null {
  switch (String(status ?? '').toUpperCase()) {
    case 'PENDING': case 'SERVER_ACK': return 'sent';
    case 'DELIVERY_ACK': return 'delivered';
    case 'READ': case 'PLAYED': return 'read';
    case 'ERROR': return 'failed';
    default: return null;
  }
}

const DELIVERY_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };

/** Delivery events arrive out of order; a late "delivered" must not undo "read". */
export function isDeliveryUpgrade(current: string | null | undefined, next: string): boolean {
  if (next === 'failed') return !current || current === 'sent';
  return (DELIVERY_RANK[next] ?? 0) > (DELIVERY_RANK[String(current ?? '')] ?? 0);
}

/** Baileys timestamps come as a number, a numeric string or a protobuf Long. */
export function timestampFrom(v: unknown): Date {
  const n = typeof v === 'object' && v !== null && 'low' in (v as Record<string, unknown>)
    ? Number((v as { low: number }).low)
    : Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

// deno-lint-ignore no-explicit-any
type AnyMsg = any;

/** Strip the wrappers WhatsApp puts around the real message. */
export function unwrapMessage(message: AnyMsg): AnyMsg {
  let m = message ?? {};
  for (let i = 0; i < 4; i++) {
    const inner = m.ephemeralMessage?.message
      ?? m.viewOnceMessage?.message
      ?? m.viewOnceMessageV2?.message
      ?? m.viewOnceMessageV2Extension?.message
      ?? m.documentWithCaptionMessage?.message
      ?? m.editedMessage?.message
      // Sent from the owner's other device: the real message is inside.
      ?? m.deviceSentMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m;
}

export interface ParsedContent {
  texto: string;
  anexos: Array<Record<string, unknown>>;
  replyTo: string | null;
}

/**
 * Text and attachments of a Baileys message, in the same shape meta-webhook
 * writes — so MetaInbox renders both without knowing which one it is.
 *
 * Media carries no file: `media_id` is the WhatsApp message id, which is what
 * Evolution needs to hand the bytes over later (see meta-media).
 */
export function parseContent(messageId: string, message: AnyMsg): ParsedContent {
  const m = unwrapMessage(message);
  const anexos: Array<Record<string, unknown>> = [];
  let texto = '';

  const media = (type: string, node: AnyMsg) => {
    // Baileys may hand the size over as a Long ({ low, high }) rather than a number.
    const length = Number(typeof node?.fileLength === 'object' ? node.fileLength?.low : node?.fileLength);
    anexos.push({
      type,
      media_id: messageId,
      url: null,
      mime: node?.mimetype ?? null,
      ...(node?.fileName ? { filename: node.fileName } : {}),
      ...(Number.isFinite(length) && length > 0 ? { size: length } : {}),
    });
    texto = node?.caption ?? '';
  };

  if (typeof m.conversation === 'string') texto = m.conversation;
  else if (m.extendedTextMessage) texto = m.extendedTextMessage.text ?? '';
  else if (m.imageMessage) media('image', m.imageMessage);
  else if (m.videoMessage) media('video', m.videoMessage);
  else if (m.audioMessage) media('audio', m.audioMessage);
  else if (m.documentMessage) media('document', m.documentMessage);
  else if (m.stickerMessage) media('sticker', m.stickerMessage);
  else if (m.locationMessage || m.liveLocationMessage) {
    const l = m.locationMessage ?? m.liveLocationMessage;
    anexos.push({
      type: 'location',
      lat: l.degreesLatitude, lng: l.degreesLongitude,
      url: l.degreesLatitude != null
        ? `https://maps.google.com/?q=${l.degreesLatitude},${l.degreesLongitude}`
        : null,
    });
    texto = l.name ?? l.address ?? '';
  } else if (m.contactMessage || m.contactsArrayMessage) {
    const list = m.contactMessage ? [m.contactMessage] : (m.contactsArrayMessage.contacts ?? []);
    anexos.push({ type: 'contacts', url: null, dados: list });
    texto = list.map((c: { displayName?: string }) => c?.displayName).filter(Boolean).join(', ');
  } else if (m.buttonsResponseMessage) texto = m.buttonsResponseMessage.selectedDisplayText ?? '';
  else if (m.templateButtonReplyMessage) texto = m.templateButtonReplyMessage.selectedDisplayText ?? '';
  else if (m.listResponseMessage) texto = m.listResponseMessage.title ?? '';
  else if (m.pollCreationMessage || m.pollCreationMessageV3) {
    texto = `[sondagem] ${(m.pollCreationMessage ?? m.pollCreationMessageV3).name ?? ''}`.trim();
  } else {
    // Something we do not render yet. Leaving a trace beats a silent gap in
    // the conversation — except for WhatsApp's own signalling, which is no
    // message at all: encrypted edits and reactions (secretEncrypted,
    // encReaction) cannot be read without the message secret, and the rest is
    // key exchange or pin/keep bookkeeping. Shown, they were bubbles reading
    // "[secretEncrypted]" next to the real conversation.
    const tipo = Object.keys(m).find((k) => k !== 'messageContextInfo');
    texto = tipo && !SIGNALLING_TYPES.has(tipo) ? `[${tipo.replace(/Message$/, '')}]` : '';
  }

  const ctx = m.extendedTextMessage?.contextInfo
    ?? m.imageMessage?.contextInfo ?? m.videoMessage?.contextInfo
    ?? m.audioMessage?.contextInfo ?? m.documentMessage?.contextInfo
    ?? m.stickerMessage?.contextInfo;

  return { texto, anexos, replyTo: ctx?.stanzaId ?? null };
}
