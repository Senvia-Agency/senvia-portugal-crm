import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { resolveActionTarget } from './action-target.ts';

const origin = { id: 'run', flow_id: 'flow', organization_id: 'org', subject_type: 'contact', subject_id: 'contact', contact_name: 'Old', contact_email: 'old@example.test', contact_phone: 'old', context: {} };
function client(rows: Record<string, Record<string, unknown>>) {
  return createClient('https://db.example.test', 'test-key', { global: { fetch: async request => {
    const url = new URL(String(request));
    assert.equal(url.searchParams.get('organization_id'), 'eq.org');
    const id = url.searchParams.get('id')?.slice(3) ?? '';
    return new Response(JSON.stringify(rows[id] ?? null));
  } } });
}
test('created target reloads latest contact without mutating enrollment identity', async () => {
  const run = { ...origin, context: { __action_target: { type: 'lead', id: 'new-lead' }, source_event: 'form' } };
  const effective = await resolveActionTarget(client({ 'new-lead': { id: 'new-lead', name: 'New', email: 'new@example.test', phone: '+351123456789', status: 'new' } }), run);
  assert.equal(effective.subject_type, 'lead');
  assert.equal(effective.subject_id, 'new-lead');
  assert.equal(effective.contact_email, 'new@example.test');
  assert.equal(effective.context.source_event, 'form');
  assert.equal(effective.context.nome, 'New');
  assert.equal(run.subject_type, 'contact');
  assert.equal(run.subject_id, 'contact');
  assert.equal(run.contact_email, 'old@example.test');
});
test('base lead refresh drops stale identity after email and name change', async () => {
  const run = { ...origin, subject_type: 'lead', subject_id: 'lead', context: { email: 'old@example.test', nome: 'Old', telefone: 'old' } };
  const effective = await resolveActionTarget(client({ lead: { id: 'lead', name: 'Current', email: null, phone: null } }), run);
  assert.equal(effective.contact_name, 'Current');
  assert.equal(effective.contact_email, null);
  assert.equal(effective.context.email, '');
  assert.equal(effective.context.telefone, '');
});
test('cross organization or missing action target is rejected', async () => {
  const run = { ...origin, context: { __action_target: { type: 'client', id: 'foreign' } } };
  await assert.rejects(resolveActionTarget(client({}), run), /organização/);
});
test('sale target resolves persisted linked contact scoped to the organization', async () => {
  const run = { ...origin, context: { __action_target: { type: 'sale', id: 'sale' } } };
  const effective = await resolveActionTarget(client({ sale: { id: 'sale', client_id: 'client', status: 'pending' }, client: { id: 'client', name: 'Client', email: 'client@example.test', phone: '351999999999' } }), run);
  assert.equal(effective.subject_id, 'sale');
  assert.equal(effective.context.status, 'pending');
  assert.equal(effective.contact_email, 'client@example.test');
});
