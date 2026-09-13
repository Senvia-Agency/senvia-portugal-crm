import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecipientHistory, loadRecipientHistory, matchRecipients } from './email-recipient-history.ts';

test('sent To/Cc/Bcc addresses are deduplicated, newest first, with names preserved', () => {
  const history = buildRecipientHistory([
    { date: '2026-01-01', to_addresses: [{ name: 'João Silva', address: 'JOAO@example.com' }] },
    { date: '2026-09-13', to_addresses: [{ address: ' joao@example.com ' }], cc_addresses: [{ name: 'Ana', address: 'ana@example.com' }], bcc_addresses: [{ address: 'bcc@example.com' }] },
    { to_addresses: [null, { address: 10 }, { address: 'invalid' }], cc_addresses: 'bad old payload' },
  ]);
  assert.deepEqual(history.map(r => r.address), ['joao@example.com', 'ana@example.com', 'bcc@example.com']);
  assert.equal(history[0].name, 'João Silva');
  assert.equal(matchRecipients('joao', history, [])[0].name, 'João Silva');
  assert.equal(matchRecipients('BCC@', history, [])[0].source, 'sent');
  assert.deepEqual(matchRecipients('x', history, []), []);
});

test('history and CRM are merged without duplicate recipients and allow CRM names', () => {
  const history = buildRecipientHistory([{ to_addresses: [{ address: 'ana@example.com' }] }]);
  const crm = [{ address: 'ANA@example.com', name: 'Ana Costa', source: 'crm' }];
  assert.deepEqual(matchRecipients('ana', history, crm), [{ address: 'ana@example.com', name: 'Ana Costa', source: 'sent' }]);
  assert.equal(history[0].name, 'ana@example.com', 'matching must not mutate the query cache');
});

function fakeDb(rows, failure) {
  const calls = [];
  return {
    calls,
    from(table) {
      const filters = [];
      const call = { table, filters, selection: '' };
      calls.push(call);
      const query = {
        select(s) { call.selection = s; return query; },
        eq(k, v) { filters.push([k, v]); return query; },
        order() { return query; },
        limit() {
          return Promise.resolve({ error: failure, data: rows[table].filter(row => filters.every(([k, v]) => row[k] === v)) });
        },
      };
      return query;
    },
  };
}

test('history is mailbox/org scoped; failed, queued and other users hidden recipients are excluded', async () => {
  const command = { organization_id: 'org1', channel_id: 'box1', created_by: 'u1', type: 'send', status: 'done', bcc_addresses: [{ address: 'secret@example.com' }] };
  const message = { organization_id: 'org1', channel_id: 'box1', 'email_folders.role': 'sent', to_addresses: [{ address: 'sent@example.com' }] };
  const db = fakeDb({
    email_messages: [message, { ...message, channel_id: 'box2' }, { ...message, organization_id: 'org2' }, { ...message, 'email_folders.role': 'inbox' }],
    email_commands: [command, ...['pending', 'processing', 'error'].map(status => ({ ...command, status, bcc_addresses: [{ address: 'failed@example.com' }] })), { ...command, created_by: 'u2', bcc_addresses: [{ address: 'other@example.com' }] }],
  });
  const result = await loadRecipientHistory(db, 'org1', 'box1', 'u1');
  assert.deepEqual(result.map(r => r.address), ['sent@example.com', 'secret@example.com']);
  for (const call of db.calls) assert.doesNotMatch(call.selection, /html|text_body|attachments|\*/);
});

test('read failures remain retryable instead of caching an empty successful history', async () => {
  const db = fakeDb({ email_messages: [], email_commands: [] }, new Error('offline'));
  await assert.rejects(loadRecipientHistory(db, 'org1', 'box1', 'u1'), /offline/);
});
