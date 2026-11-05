import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, fixture } from './automation-engine-runtime-harness.mjs';
import { enrollmentStore } from './automation-engine-enrollment-store.mjs';
function setup(policy = 'once', days = 0) {
 const flow = { ...fixture([{ id: 'end', type: 'end', config: {} }]).flow, trigger_type: 'email_opened', reentry_policy: policy, trigger_config: { reentry_cooldown_days: days } };
 return enrollmentStore({ automation_flows: [flow], automation_runs: [] });
}
const event = id => ({ organization_id: 'org', trigger_type: 'email_opened', subject_type: 'contact', record: { id, email: ' Ana@Example.test ' } });
test('different email event ids cannot bypass once enrollment for the same normalized contact', async () => {
 const { handleEnroll } = runtime(); const db = setup();
 assert.equal((await handleEnroll(db, event('email-event-a'))).enrolled, 1);
 assert.equal((await handleEnroll(db, event('email-event-b'))).enrolled, 0);
 assert.equal(db.tables.automation_runs.length, 1);
 assert.equal(db.tables.automation_runs[0].context.__origin_subject_id, 'email-event-a');
});
test('different email event ids cannot create simultaneous active executions for the same contact', async () => {
 const { handleEnroll } = runtime(); const db = setup('always');
 assert.equal((await handleEnroll(db, event('email-event-a'), true)).enrolled, 1);
 assert.equal((await handleEnroll(db, event('email-event-b'), true)).enrolled, 0);
 assert.equal(db.tables.automation_runs.length, 1);
});
test('email-only webhook respects cooldown against a legacy event-id execution', async () => {
 const { handleEnroll } = runtime(); const db = setup('after_completion', 30);
 db.tables.automation_runs.push({ id: 'old', flow_id: 'flow', organization_id: 'org', subject_type: 'contact', subject_id: 'legacy-event', contact_email: 'ana@example.test', status: 'completed', completed_at: '2026-11-03T10:00:00Z', context: {} });
 const body = event(undefined);
 assert.equal((await handleEnroll(db, body)).enrolled, 0);
 assert.equal(db.tables.automation_runs.length, 1);
});

for (const status of ['completed', 'waiting']) {
 test(`legacy phone ${status} execution is recognized despite a new event subject`, async () => {
  const { handleEnroll } = runtime(); const db = setup(status === 'completed' ? 'once' : 'always');
  db.tables.automation_runs.push({ id: 'old', flow_id: 'flow', organization_id: 'org', subject_type: 'contact', subject_id: 'old-conversation', contact_phone_key: '912345678', status, context: {} });
  const body = event('new-event'); body.record.phone = '+351912345678';
  assert.equal((await handleEnroll(db, body, true)).enrolled, 0);
  assert.equal(db.tables.automation_runs.length, 1);
 });
}
test('legacy mixed-case email is recognized and unrelated organization or test executions are excluded', async () => {
 const { handleEnroll } = runtime();
 for (const [extra, expected] of [[{}, 0], [{ organization_id: 'other' }, 1], [{ context: { __test: true } }, 1]]) {
  const db = setup();
  db.tables.automation_runs.push({ id: 'old', flow_id: 'flow', organization_id: 'org', subject_type: 'contact', subject_id: 'old-event', contact_email: 'Ana@Example.test', status: 'completed', context: {}, ...extra });
  assert.equal((await handleEnroll(db, event('new-event'))).enrolled, expected);
 }
});
test('email-only webhook without event id enrolls at cooldown boundary with a stable logical UUID', async () => {
 const { handleEnroll } = runtime(); const db = setup('after_completion', 30);
 db.tables.automation_runs.push({ id: 'old', flow_id: 'flow', organization_id: 'org', subject_type: 'contact', subject_id: 'legacy-event', contact_email: 'ana@example.test', status: 'completed', completed_at: '2026-10-05T10:00:00Z', context: {} });
 assert.equal((await handleEnroll(db, event(undefined))).enrolled, 1);
 assert.match(db.tables.automation_runs[1].subject_id, /^[0-9a-f-]{14}8[0-9a-f-]{21}$/);
 assert.equal(db.tables.automation_runs[1].contact_email, 'ana@example.test');
});

for (const mode of ['start', 'failed_step']) {
 test(`administrator ${mode} retry bypasses cooldown but cannot duplicate an active legacy email contact`, async () => {
  const { handleRetry } = runtime(); const db = setup('after_completion', 30);
  db.tables.automation_runs.push({ id: 'failed', flow_id: 'flow', organization_id: 'org', subject_type: 'contact', subject_id: 'old-event', contact_email: 'ana@example.test', status: 'failed', context: {} },
   { id: 'active', flow_id: 'flow', organization_id: 'org', subject_type: 'contact', subject_id: 'other-event', contact_email: 'Ana@Example.test', status: 'waiting', context: {} });
  const result = await handleRetry(db, { run_id: 'failed', from: mode }, true);
  assert.ok(result.error);
  assert.equal(db.tables.automation_runs.length, 2);
  assert.equal(db.tables.automation_runs[0].status, 'failed');
 });
}
test('administrator retry of a legacy contact remains immediate and upgrades new run identity', async () => {
 const { handleRetry } = runtime(); const db = setup('after_completion', 30);
 db.tables.automation_runs.push({ id: 'failed', flow_id: 'flow', organization_id: 'org', subject_type: 'contact', subject_id: 'old-event', contact_email: 'Ana@Example.test', status: 'failed', completed_at: '2026-11-04T09:59:00Z', context: {} });
 const result = await handleRetry(db, { run_id: 'failed', from: 'start' }, true);
 assert.equal(result.error, null);
 assert.equal(db.tables.automation_runs.length, 2);
 assert.notEqual(db.tables.automation_runs[1].subject_id, 'old-event');
 assert.match(db.tables.automation_runs[1].subject_id, /^[0-9a-f]{8}-/);
});
