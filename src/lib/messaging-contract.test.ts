import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isManagedWhatsAppChannel,
  parseConnectResponse,
  parseListConversationsResponse,
} from './messaging-contract.ts';
import { deliveryStateLabel } from './messaging-presentation.ts';

const publicChannel = {
  id: '67ee1712-e1c7-4d78-831d-ae0e79b59118',
  label: 'Vendas',
  status: 'connecting',
  phone_number: null,
  archived_at: null,
  managed_by: 'senvia_v2',
  updated_at: '2026-09-14T10:00:00.000Z',
} as const;

test('accepts a real QR only while the connection requires it', () => {
  const parsed = parseConnectResponse({
    ok: true,
    state: 'qr_required',
    channel: publicChannel,
    qr: {
      data_url: 'data:image/png;base64,iVBORw0KGgo=',
      expires_at: '2026-09-14T10:02:00.000Z',
    },
    retry_after_ms: 2_000,
  });

  assert.equal(parsed.state, 'qr_required');
  assert.equal(parsed.qr.expires_at, '2026-09-14T10:02:00.000Z');
});

test('rejects a stale QR on an expired connection', () => {
  assert.throws(() => parseConnectResponse({
    ok: true,
    state: 'expired',
    channel: publicChannel,
    qr: {
      data_url: 'data:image/png;base64,iVBORw0KGgo=',
      expires_at: '2026-09-14T09:59:00.000Z',
    },
  }));
});

test('rejects provider credentials from a browser response', () => {
  assert.throws(() => parseConnectResponse({
    ok: true,
    state: 'connecting',
    channel: {
      ...publicChannel,
      provider_instance: 'private-instance-name',
    },
  }));
});

test('shows only newly managed Evolution WhatsApp channels', () => {
  assert.equal(isManagedWhatsAppChannel({
    channel_type: 'whatsapp',
    provider: 'evolution',
    metadata: { managed_by: 'senvia_v2' },
  }), true);
  assert.equal(isManagedWhatsAppChannel({
    channel_type: 'whatsapp',
    provider: 'evolution',
    metadata: null,
  }), false);
  assert.equal(isManagedWhatsAppChannel({
    channel_type: 'whatsapp',
    provider: 'meta',
    metadata: { managed_by: 'senvia_v2' },
  }), false);
});

test('parses consent and authoritative outbound delivery states', () => {
  const parsed = parseListConversationsResponse({
    ok: true,
    conversations: [{
      id: 42,
      channel_id: publicChannel.id,
      status: 'open',
      unread_count: 3,
      can_reply: false,
      created_at: '2026-09-14T09:00:00.000Z',
      last_activity_at: '2026-09-14T10:00:00.000Z',
      assignee_user_id: null,
      messaging_permission: 'opted_out',
      contact: {
        name: 'Cliente Teste',
        phone_e164: '+351900000001',
        avatar_ref: null,
      },
      last_message: {
        id: 99,
        direction: 'outgoing',
        content: 'Mensagem de teste',
        content_type: 'text',
        created_at: '2026-09-14T10:00:00.000Z',
        delivery: {
          state: 'uncertain',
          error_code: null,
          error_message: null,
        },
      },
    }],
    pagination: { page: 1, page_size: 25, next_page: null, total_count: 1 },
    summary: { unread_count: 3, open_count: 1 },
  });

  assert.equal(parsed.conversations[0]?.messaging_permission, 'opted_out');
  assert.equal(parsed.conversations[0]?.last_message?.delivery.state, 'uncertain');
});

test('labels queue acceptance separately from provider submission and delivery', () => {
  assert.equal(deliveryStateLabel('queued'), 'Em fila');
  assert.equal(deliveryStateLabel('processing'), 'A processar');
  assert.equal(deliveryStateLabel('submitted'), 'Enviada ao WhatsApp');
  assert.equal(deliveryStateLabel('delivered'), 'Entregue');
  assert.equal(deliveryStateLabel('read'), 'Lida');
  assert.equal(deliveryStateLabel('uncertain'), 'Envio por confirmar');
  assert.equal(deliveryStateLabel('cancelled'), 'Cancelada');
});
