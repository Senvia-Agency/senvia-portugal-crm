import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, fixture } from './automation-engine-runtime-harness.mjs';
import { enrollmentStore } from './automation-engine-enrollment-store.mjs';

function flow(config = {}) {
  return { ...fixture([{ id: 'end', type: 'end', config: {} }]).flow, reentry_policy: 'after_completion', trigger_type: 'lead_created',
    trigger_config: { reentry_cooldown_days: 30, ...config } };
}
const request = { organization_id: 'org', trigger_type: 'lead_created', subject_type: 'lead', record: { id: 'lead', name: 'Ana' } };
function terminal(extra = {}) {
  return { id: 'old-run', organization_id: 'org', flow_id: 'flow', subject_type: 'lead', subject_id: 'lead', status: 'completed', completed_at: '2026-11-03T10:00:00Z', context: {}, ...extra };
}

test('after-completion cooldown rejects recent terminal run before insertion', async () => {
  const { handleEnroll } = runtime();
  const store = enrollmentStore({ automation_flows: [flow()], automation_runs: [terminal()] });
  const result = await handleEnroll(store, request);
  assert.equal(result.enrolled, 0);
  assert.equal(result.results[0].next_entry_at, '2026-12-03T10:00:00.000Z');
  assert.equal(store.queries.filter(query => query.operation === 'insert').length, 0);
});

test('entry is allowed at exact cooldown boundary', async () => {
  const { handleEnroll } = runtime();
  const store = enrollmentStore({ automation_flows: [flow()], automation_runs: [terminal({ completed_at: '2026-10-05T10:00:00Z' })] });
  assert.equal((await handleEnroll(store, request)).enrolled, 1);
});

test('latest actual terminal run wins while test runs are excluded', async () => {
  const { handleEnroll } = runtime();
  const store = enrollmentStore({ automation_flows: [flow()], automation_runs: [
    terminal({ id: 'old-real', completed_at: '2026-09-01T10:00:00Z' }),
    terminal({ id: 'recent-real', completed_at: '2026-11-01T10:00:00Z' }),
    terminal({ id: 'latest-test', completed_at: '2026-11-03T10:00:00Z', context: { __test: true } }),
  ] });
  const result = await handleEnroll(store, request);
  assert.equal(result.enrolled, 0);
  assert.equal(result.results[0].next_entry_at, '2026-12-01T10:00:00.000Z');
});

test('test or other-organization terminal runs cannot impose cooldown', async () => {
  const { handleEnroll } = runtime();
  const store = enrollmentStore({ automation_flows: [flow()], automation_runs: [
    terminal({ id: 'test', context: { __test: true } }),
    terminal({ id: 'foreign', organization_id: 'other' }),
    terminal({ id: 'other-flow', flow_id: 'other' }),
    terminal({ id: 'other-subject', subject_id: 'other' }),
  ] });
  assert.equal((await handleEnroll(store, request)).enrolled, 1);
});

test('active run still prevents duplicate enrollment despite cooldown eligibility', async () => {
  const { handleEnroll } = runtime();
  const store = enrollmentStore({ automation_flows: [flow()], automation_runs: [terminal({ status: 'waiting', completed_at: null })] });
  assert.equal((await handleEnroll(store, request)).enrolled, 0);
  assert.equal(store.tables.automation_runs.length, 1);
});

test('invalid server cooldown is reported and does not insert a run', async () => {
  const { handleEnroll } = runtime();
  const store = enrollmentStore({ automation_flows: [flow({ reentry_cooldown_days: 3661 })] });
  const result = await handleEnroll(store, request);
  assert.equal(result.enrolled, 0);
  assert.ok(result.results[0].error);
  assert.equal(store.queries.filter(query => query.operation === 'insert').length, 0);
});

test('once policy remains once even after cooldown elapsed', async () => {
  const { handleEnroll } = runtime();
  const configured = flow(); configured.reentry_policy = 'once';
  const store = enrollmentStore({ automation_flows: [configured], automation_runs: [terminal({ completed_at: '2025-01-01T10:00:00Z' })] });
  assert.equal((await handleEnroll(store, request)).enrolled, 0);
});
