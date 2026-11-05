import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { resolveAutomationEmailRecipient } from './email-recipient.ts';

const run = { id: 'r', flow_id: 'f', organization_id: 'org', subject_type: 'lead', subject_id: 'lead', contact_name: 'Ana', contact_email: 'contact@example.test', contact_phone: null, context: { assigned_to: 'untrusted' } };
function fixture(options: { member?: boolean; profile?: boolean; email?: string | null; owner?: string | null; record?: boolean } = {}) {
  const requests: URL[] = [];
  const db = createClient('https://db.example.test', 'key', { auth: { persistSession: false }, global: { fetch: async request => {
    const url = new URL(String(request)); requests.push(url);
    const table = url.pathname.split('/').pop();
    const rows = table === 'organization_members' ? options.member === false ? [] : [{ user_id: 'agent' }]
      : table === 'profiles' ? options.profile === false ? [] : [{ email: options.email === undefined ? 'agent@example.test' : options.email, full_name: 'Agente' }]
      : options.record === false ? [] : [{ assigned_to: options.owner === undefined ? 'agent' : options.owner }];
    return Response.json(rows);
  } } });
  return { db, requests };
}

test('default contact preserves client identity without a database lookup', async () => {
  const { db, requests } = fixture();
  assert.deepEqual(await resolveAutomationEmailRecipient(db, { ...run, subject_type: 'client' }, {}), { kind: 'recipient', email: run.contact_email, name: 'Ana', clientId: 'lead', internal: false });
  assert.equal(requests.length, 0);
});
test('owner resolves current organization record and active member instead of context', async () => {
  const { db, requests } = fixture();
  assert.equal((await resolveAutomationEmailRecipient(db, run, { recipient_mode: 'owner' })).kind, 'recipient');
  assert.equal(requests[0].searchParams.get('organization_id'), 'eq.org');
  assert.equal(requests[1].searchParams.get('user_id'), 'eq.agent');
  assert.equal(requests[1].searchParams.get('is_active'), 'eq.true');
});
test('explicit user requires same organization active membership and an email', async () => {
  for (const options of [{ member: false }, { profile: false }, { email: null }, { email: 'invalid' }]) {
    const { db } = fixture(options);
    assert.equal((await resolveAutomationEmailRecipient(db, run, { recipient_mode: 'user', recipient_user_id: 'agent' })).kind, 'fail');
  }
});
test('missing owner or foreign record never falls back to context', async () => {
  for (const options of [{ owner: null }, { record: false }]) {
    const { db } = fixture(options);
    assert.equal((await resolveAutomationEmailRecipient(db, run, { recipient_mode: 'owner' })).kind, 'fail');
  }
});
test('internal notifications reject interaction waits and invalid modes before lookup', async () => {
  const { db, requests } = fixture();
  for (const config of [{ recipient_mode: 'user', recipient_user_id: 'agent', wait_event: 'replied' }, { recipient_mode: 'all' }]) {
    assert.equal((await resolveAutomationEmailRecipient(db, run, config)).kind, 'fail');
  }
  assert.equal(requests.length, 0);
});

test('explicit member address is resolved only after organization membership is confirmed', async () => {
  const { db, requests } = fixture();
  const result = await resolveAutomationEmailRecipient(db, { ...run, subject_type: 'client' }, { recipient_mode: 'user', recipient_user_id: 'agent' });
  assert.deepEqual(result, { kind: 'recipient', email: 'agent@example.test', name: 'Agente', internal: true });
  assert.equal(requests[0].pathname, '/rest/v1/organization_members');
  assert.equal(requests[0].searchParams.get('organization_id'), 'eq.org');
  assert.equal(requests[0].searchParams.get('user_id'), 'eq.agent');
  assert.equal(requests[1].searchParams.get('id'), 'eq.agent');
});

test('proposal owner follows its current linked lead with organization scopes', async () => {
  const requests: URL[] = [];
  const db = createClient('https://db.example.test', 'key', { auth: { persistSession: false }, global: { fetch: async request => {
    const url = new URL(String(request)); requests.push(url);
    const table = url.pathname.split('/').pop();
    return Response.json(table === 'proposals' ? [{ lead_id: 'linked', client_id: 'ignored' }]
      : table === 'leads' ? [{ assigned_to: 'agent' }] : table === 'organization_members' ? [{ user_id: 'agent' }]
      : [{ email: 'agent@example.test', full_name: 'Agente' }]);
  } } });
  const result = await resolveAutomationEmailRecipient(db, { ...run, subject_type: 'proposal', subject_id: 'proposal' }, { recipient_mode: 'owner' });
  assert.equal(result.kind, 'recipient');
  assert.equal(requests[1].pathname, '/rest/v1/leads');
  assert.equal(requests[1].searchParams.get('id'), 'eq.linked');
  assert.ok(requests.slice(0, 3).every(url => url.searchParams.get('organization_id') === 'eq.org'));
});
