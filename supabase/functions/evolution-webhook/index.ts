// evolution-webhook — receives the events of a WhatsApp number linked by QR
// code (Evolution) and stores them where the inbox reads: meta_conversations /
// meta_messages, the same tables meta-webhook writes. See
// _shared/evolution-inbox.ts for why.
//
// Authentication: Evolution can only be given a URL, so the URL carries the
// instance name and an HMAC of it (webhookToken). Without a matching token
// anyone who found this address could inject messages into a customer's inbox.
//
// Only channels created by the current integration (`metadata.native_inbox`)
// are served. Events from the first integration's instances are acknowledged
// and dropped: nobody reads those rows any more.

import { createClient } from 'npm:@supabase/supabase-js@2.57.2';
import {
  contactRefFromJid, deliveryStatusFrom, isDeliveryUpgrade, parseContent,
  timestampFrom, unwrapMessage, webhookToken,
} from '../_shared/evolution-inbox.ts';

const log = (s: string, d?: unknown) =>
  console.log(`[EVOLUTION-WEBHOOK] ${s}${d ? ` - ${JSON.stringify(d)}` : ''}`);
const logError = (s: string, d?: unknown) =>
  console.error(`[EVOLUTION-WEBHOOK] ERROR ${s}${d ? ` - ${JSON.stringify(d)}` : ''}`);

const ok = (body: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ ok: true, ...body }), { headers: { 'Content-Type': 'application/json' } });

function sameToken(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface Channel {
  id: string;
  organization_id: string;
  assigned_user_ids: string[] | null;
  phone_number: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
}

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type AnyData = any;

/** Push notification. Failing here must never stop the message from being stored. */
async function notify(channel: Channel, title: string, body: string, convId: string): Promise<void> {
  try {
    const attendants = Array.isArray(channel.assigned_user_ids) ? channel.assigned_user_ids : [];
    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({
        organization_id: channel.organization_id,
        title,
        body: body.slice(0, 140),
        url: '/inbox',
        tag: `meta-${convId}`,
        ...(attendants.length > 0 ? { user_ids: attendants } : {}),
      }),
    });
  } catch (e) {
    logError('push failed', { error: (e as Error).message });
  }
}

/**
 * One message, either direction. Incoming ones come from the customer;
 * outgoing ones were typed on the phone, in Chatwoot, or sent by meta-send —
 * the last are already stored, and the unique (conversation, external_id)
 * index turns the repeat into a no-op.
 */
async function storeMessage(db: Db, channel: Channel, data: AnyData): Promise<string> {
  const key = data?.key ?? {};
  const messageId = String(key.id ?? '');
  if (!messageId) return 'no_id';

  const contactRef = contactRefFromJid(key.remoteJid, [key.remoteJidAlt, key.senderPn, key.participantAlt]);
  if (!contactRef) return 'not_one_to_one';
  const outgoing = key.fromMe === true;

  const inner = unwrapMessage(data?.message);

  // Reaction: annotates the message it reacts to.
  if (inner.reactionMessage?.key?.id) {
    const emoji = inner.reactionMessage.text || null;
    await db.from('meta_messages').update({
      reaction: emoji,
      reaction_by: emoji ? (outgoing ? 'agent' : 'contact') : null,
    })
      .eq('organization_id', channel.organization_id)
      .eq('external_id', String(inner.reactionMessage.key.id));
    return 'reaction';
  }

  // Deleted for everyone (type 0) or edited (type 14): both change a message
  // already in the conversation instead of adding one.
  if (inner.protocolMessage?.key?.id) {
    const target = String(inner.protocolMessage.key.id);
    const type = Number(inner.protocolMessage.type ?? -1);
    if (type === 0) {
      await db.from('meta_messages').update({ content: null, attachments: [], is_deleted: true })
        .eq('organization_id', channel.organization_id).eq('external_id', target);
      return 'deleted';
    }
    if (type === 14 && inner.protocolMessage.editedMessage) {
      const edited = parseContent(target, inner.protocolMessage.editedMessage);
      if (edited.texto) {
        await db.from('meta_messages').update({ content: edited.texto })
          .eq('organization_id', channel.organization_id).eq('external_id', target);
      }
      return 'edited';
    }
    return 'protocol';
  }

  const { texto, anexos, replyTo } = parseContent(messageId, data?.message);
  if (!texto && anexos.length === 0) return 'empty';

  const at = timestampFrom(data?.messageTimestamp);
  const summary = texto || `[${anexos[0]?.type ?? 'anexo'}]`;
  const name = !outgoing && data?.pushName ? String(data.pushName) : null;

  const { data: existing } = await db
    .from('meta_conversations')
    .select('id, contact_name, last_message_at')
    .eq('channel_id', channel.id)
    .eq('contact_ref', contactRef)
    .maybeSingle();

  let convId: string;
  if (existing) {
    const newer = !existing.last_message_at || new Date(existing.last_message_at) <= at;
    const { data: row, error } = await db.from('meta_conversations').update({
      ...(newer ? { last_message: summary, last_message_at: at.toISOString() } : {}),
      ...(name && !existing.contact_name ? { contact_name: name } : {}),
      status: 'open',
      updated_at: new Date().toISOString(),
    }).eq('id', existing.id).select('id').single();
    if (error) { logError('conversation not updated', { error: error.message }); return 'error'; }
    convId = row.id;
  } else {
    // No 24-hour window: that is a Cloud API rule. A number linked by QR
    // answers whenever it likes, so window_expires_at stays null and the
    // composer stays open.
    const { data: row, error } = await db.from('meta_conversations').insert({
      organization_id: channel.organization_id,
      channel_id: channel.id,
      contact_ref: contactRef,
      contact_name: name,
      last_message: summary,
      last_message_at: at.toISOString(),
      window_expires_at: null,
      status: 'open',
    }).select('id').single();
    if (error) {
      // Two events for the same new contact at once: the other one won.
      if ((error as { code?: string }).code === '23505') {
        const { data: again } = await db.from('meta_conversations').select('id')
          .eq('channel_id', channel.id).eq('contact_ref', contactRef).maybeSingle();
        if (!again) return 'error';
        convId = again.id;
      } else {
        logError('conversation not created', { error: error.message });
        return 'error';
      }
    } else {
      convId = row.id;
    }
  }

  const { error: msgErr } = await db.from('meta_messages').insert({
    organization_id: channel.organization_id,
    conversation_id: convId,
    external_id: messageId,
    direction: outgoing ? 'outgoing' : 'incoming',
    content: texto || null,
    reply_to_external_id: replyTo,
    attachments: anexos,
    sent_at: at.toISOString(),
    ...(outgoing ? { delivery_status: deliveryStatusFrom(data?.status) ?? 'sent' } : {}),
  });
  if (msgErr && (msgErr as { code?: string }).code !== '23505') {
    logError('message not stored', { error: msgErr.message });
    return 'error';
  }
  if (msgErr) return 'duplicate';

  // Only what comes IN is unread — flagging what the owner just typed on their
  // phone would ask them to read their own words.
  if (!outgoing) {
    await db.rpc('increment_meta_unread', { _conversation_id: convId }).then(() => {}, () => {});
    await notify(channel, `💬 WhatsApp: ${name || existing?.contact_name || contactRef}`, summary, convId);
  }
  return 'stored';
}

async function applyDeliveryUpdate(db: Db, channel: Channel, data: AnyData): Promise<void> {
  const externalId = String(data?.keyId ?? data?.key?.id ?? '');
  const next = deliveryStatusFrom(data?.status);
  if (!externalId || !next) return;

  const { data: row } = await db.from('meta_messages')
    .select('id, delivery_status, direction')
    .eq('organization_id', channel.organization_id)
    .eq('external_id', externalId)
    .maybeSingle();
  if (!row || row.direction !== 'outgoing' || !isDeliveryUpgrade(row.delivery_status, next)) return;

  const now = new Date().toISOString();
  await db.from('meta_messages').update({
    delivery_status: next,
    ...(next === 'delivered' ? { delivered_at: now } : {}),
    ...(next === 'read' ? { read_at: now } : {}),
    ...(next === 'failed' ? { delivery_error: 'O WhatsApp não entregou a mensagem.' } : {}),
  }).eq('id', row.id);
}

async function applyConnectionUpdate(db: Db, channel: Channel, data: AnyData): Promise<void> {
  const state = String(data?.state ?? '');
  const status = state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected';
  const phone = typeof data?.wuid === 'string' ? data.wuid.split('@')[0].split(':')[0] : null;
  if (status === channel.status && (!phone || phone === channel.phone_number)) return;
  await db.from('messaging_channels')
    .update({ status, ...(status === 'connected' && phone ? { phone_number: phone } : {}) })
    .eq('id', channel.id);
  log('connection', { channel: channel.id, status });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Método não permitido', { status: 405 });

  const url = new URL(req.url);
  const instance = url.searchParams.get('instance') ?? '';
  const token = url.searchParams.get('token') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (!instance || !sameToken(token, await webhookToken(serviceKey, instance))) {
    return new Response('Não autorizado', { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return ok({ ignored: 'no_body' });

  // The instance in the URL is the one that was signed; the body's is not.
  if (body.instance && String(body.instance) !== instance) {
    logError('instance mismatch', { url: instance, body: body.instance });
    return new Response('Não autorizado', { status: 401 });
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  const { data: channel } = await db
    .from('messaging_channels')
    .select('id, organization_id, assigned_user_ids, phone_number, status, metadata, provider')
    .eq('evolution_instance', instance)
    .is('archived_at', null)
    .maybeSingle();
  if (!channel || (channel.metadata as { native_inbox?: unknown } | null)?.native_inbox !== true) {
    return ok({ ignored: 'no_channel' });
  }

  // `messages.upsert`, `MESSAGES_UPSERT` and `messages-upsert` all show up
  // depending on the Evolution build and on byEvents.
  const event = String(body.event ?? '').toLowerCase().replace(/[_-]/g, '.');
  const items: AnyData[] = Array.isArray(body.data) ? body.data
    : Array.isArray(body.data?.messages) ? body.data.messages
    : [body.data];

  try {
    let result = 'ignored';
    for (const data of items) {
      if (!data) continue;
      if (event === 'messages.upsert' || event === 'send.message') {
        result = await storeMessage(db, channel, data);
      } else if (event === 'messages.update') {
        await applyDeliveryUpdate(db, channel, data);
        result = 'delivery';
      } else if (event === 'messages.delete') {
        const target = String(data?.id ?? data?.key?.id ?? '');
        if (target) {
          await db.from('meta_messages').update({ content: null, attachments: [], is_deleted: true })
            .eq('organization_id', channel.organization_id).eq('external_id', target);
        }
        result = 'deleted';
      } else if (event === 'connection.update') {
        await applyConnectionUpdate(db, channel, data);
        result = 'connection';
      }
    }
    return ok({ result });
  } catch (e) {
    // 200 anyway: Evolution does not retry, and a 500 here only fills its log.
    logError('event failed', { event, error: (e as Error).message });
    return ok({ result: 'error' });
  }
});
