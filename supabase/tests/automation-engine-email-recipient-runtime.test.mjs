import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, database, fixture } from './automation-engine-runtime-harness.mjs';

test('internal user email reaches protected sender with verified member address and no contact client identity', async () => {
  const { Engine } = runtime();
  const { run, flow } = fixture([{ id: 'email', type: 'send_email', config: { recipient_mode: 'user', recipient_user_id: 'agent', subject: 'Aviso', html: 'Nova tarefa' } }]);
  run.subject_type = 'client';
  const db = database(run, flow, { id: 'agent', user_id: 'agent', email: 'agent@example.test', full_name: 'Equipa', is_active: true });
  const originalFrom = db.from;
  db.from = table => table === 'crm_clients' ? database(run, flow).from(table) : originalFrom(table);
  const sends = [];
  db.functions = { invoke: async (name, request) => { sends.push({ name, request }); return { data: { results: [{ status: 'sent' }] }, error: null }; } };
  await new Engine(db).advance(run, flow, 'email');
  assert.equal(run.status, 'completed');
  assert.equal(sends.length, 1);
  assert.equal(sends[0].name, 'send-template-email');
  const body = sends[0].request.body;
  assert.equal(body.recipients[0].email, 'agent@example.test');
  assert.equal(body.recipients[0].clientId, undefined);
  assert.equal(body.automationRunId, run.id);
  assert.equal(body.automationNodeId, 'email');
});

test('internal email with wait rejects before any external send', async () => {
  const { Engine } = runtime();
  const { run, flow } = fixture([{ id: 'email', type: 'send_email', config: { recipient_mode: 'owner', wait_event: 'replied' } }]);
  const db = database(run, flow);
  db.functions = { invoke: async () => { assert.fail('must not send'); } };
  await new Engine(db).advance(run, flow, 'email');
  assert.equal(run.status, 'failed');
});
