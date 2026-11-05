import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, fixture, database } from './automation-engine-runtime-harness.mjs';
import { enrollmentStore } from './automation-engine-enrollment-store.mjs';

const phone = '+351912345678', key = '912345678';
const body = { phone, name: 'Ana', conversation_id: 'new-conversation', channel_id: 'channel', message_at: '2026-11-04T10:00:00Z' };
function setup(type, previous, extra = {}) {
  const flow = { ...fixture([{ id: 'end', type: 'end', config: {} }]).flow, trigger_type: type, reentry_policy: 'after_completion',
    trigger_config: { reentry_cooldown_days: 30, buffer_seconds: 0, keywords: ['oferta'], ...extra } };
  const store = enrollmentStore({ automation_flows: [flow], automation_runs: previous ? [{
    id: 'old-run', flow_id: flow.id, organization_id: 'org', subject_type: 'contact', subject_id: 'old-conversation',
    contact_phone_key: key, status: 'completed', completed_at: '2026-11-03T10:00:00Z', context: {}, ...previous,
  }] : [] });
  return { flow, store };
}

for (const type of ['whatsapp_keyword', 'message_received']) {
  test(`${type} cannot bypass cooldown through another conversation`, async () => {
    const { handleMessageStart } = runtime();
    const { store } = setup(type, {});
    const result = await handleMessageStart(store, 'org', key, 'oferta', body);
    assert.equal(result.started, 0);
    assert.equal(store.queries.filter(query => query.operation === 'insert').length, 0);
  });

  test(`${type} can enter at exact cooldown boundary`, async () => {
    const { handleMessageStart } = runtime();
    const { store } = setup(type, { completed_at: '2026-10-05T10:00:00Z' });
    const result = await handleMessageStart(store, 'org', key, 'oferta', body);
    assert.equal(result.started, 1);
    assert.equal(store.tables.automation_runs.length, 2);
  });
}

test('message cooldown excludes test executions and unrelated organizations', async () => {
  const { handleMessageStart } = runtime();
  for (const previous of [{ context: { __test: true } }, { organization_id: 'other' }]) {
    const { store } = setup('message_received', previous);
    assert.equal((await handleMessageStart(store, 'org', key, 'oferta', body)).started, 1);
  }
});

test('active conversation still prevents a duplicate even with zero cooldown', async () => {
  const { handleMessageStart } = runtime();
  const { store } = setup('message_received', { status: 'running', subject_id: body.conversation_id, completed_at: null }, { reentry_cooldown_days: 0 });
  assert.equal((await handleMessageStart(store, 'org', key, 'oferta', body)).started, 0);
  assert.equal(store.tables.automation_runs.length, 1);
});

test('invalid message cooldown rejects creation instead of silently ignoring configuration', async () => {
  const { handleMessageStart } = runtime();
  const { store } = setup('message_received', undefined, { reentry_cooldown_days: -1 });
  await assert.rejects(() => handleMessageStart(store, 'org', key, 'oferta', body));
  assert.equal(store.queries.filter(query => query.operation === 'insert').length, 0);
});

test('explicit administrator retry remains immediate despite cooldown', async () => {
  const { handleRetry } = runtime();
  const { run, flow } = fixture([{ id: 'end', type: 'end', config: {} }]);
  flow.reentry_policy = 'after_completion';
  flow.trigger_config = { reentry_cooldown_days: 30 };
  run.status = 'failed'; run.completed_at = '2026-11-04T09:59:00Z';
  const db = database(run, flow);
  const result = await handleRetry(db, { run_id: run.id, from: 'start' });
  assert.equal(result.error, null);
  assert.equal(result.status, 'completed');
  assert.equal(db.steps.length, 1);
});
