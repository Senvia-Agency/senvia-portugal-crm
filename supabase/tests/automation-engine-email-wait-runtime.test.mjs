import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, database, fixture } from './automation-engine-runtime-harness.mjs';

function emailFixture(event) {
  const { run, flow } = fixture([
    { id: 'email', type: 'send_email', config: { subject: 'Olá', html: 'Mensagem', wait_event: event, timeout_amount: 5, timeout_unit: 'minutes' } },
    { id: 'engaged', type: 'end', config: {} }, { id: 'expired', type: 'end', config: {} },
  ], [{ source: 'email', target: 'engaged', branch: 'happened' }, { source: 'email', target: 'expired', branch: 'timeout' }]);
  const stored = { automation_enabled: true, opened_at: null, clicked_at: null };
  const db = database(run, flow, stored);
  const sends = [];
  db.functions = { invoke: async (name, request) => { sends.push({ name, request }); return { data: { results: [{ status: 'sent', email_send_id: 'send-1' }] } }; } };
  return { run, flow, db, stored, sends };
}

for (const event of ['opened', 'clicked', 'replied']) {
  test(`email waits for ${event} without resending during polls`, async () => {
    const { Engine, clock } = runtime();
    const { run, flow, db, stored, sends } = emailFixture(event);
    const engine = new Engine(db);
    await engine.advance(run, flow, 'email');
    const deadline = run.context.__email_wait_email.deadline;
    for (let poll = 0; poll < 3; poll += 1) {
      clock.time += 60_000;
      await engine.advance(run, flow, 'email');
      assert.equal(run.status, 'waiting');
      assert.equal(run.context.__email_wait_email.deadline, deadline);
    }
    stored[`${event}_at`] = new Date(clock.time).toISOString();
    await engine.advance(run, flow, 'email');
    assert.equal(run.status, 'completed');
    assert.equal(sends.length, 1);
    assert.equal(sends[0].request.body.automationRunId, run.id);
    assert.equal(sends[0].request.body.automationNodeId, 'email');
    assert.equal(run.context.__email_wait_email, undefined);
    assert.deepEqual(db.steps.map(step => step.node_id), ['email', 'engaged']);
    assert.equal(db.steps[0].detail.ramo, 'happened');
  });
}

test('email click wait ignores open-only event and times out without resending', async () => {
  const { Engine, clock } = runtime();
  const { run, flow, db, stored, sends } = emailFixture('clicked');
  const engine = new Engine(db);
  await engine.advance(run, flow, 'email');
  stored.opened_at = new Date(clock.time).toISOString();
  clock.time += 60_000;
  await engine.advance(run, flow, 'email');
  assert.equal(run.status, 'waiting');
  assert.equal(db.steps.length, 0);
  clock.time += 4 * 60_000;
  await engine.advance(run, flow, 'email');
  assert.equal(run.status, 'completed');
  assert.equal(sends.length, 1);
  assert.deepEqual(db.steps.map(step => step.node_id), ['email', 'expired']);
  assert.equal(db.steps[0].detail.ramo, 'timeout');
});

test('email interaction in a repeated visit ignores prior visit interaction', async () => {
  const { Engine, clock } = runtime();
  const { run, flow, db, stored, sends } = emailFixture('opened');
  run.context.__node_visits = { email: 1 };
  stored.automation_node_id = 'email';
  stored.opened_at = '2026-11-04T09:00:00Z';
  const engine = new Engine(db);
  await engine.advance(run, flow, 'email');
  assert.equal(sends[0].request.body.automationNodeId, '__visit:email:1');
  clock.time += 60_000;
  await engine.advance(run, flow, 'email');
  assert.equal(run.status, 'waiting');
  stored.automation_node_id = '__visit:email:1';
  stored.opened_at = new Date(clock.time).toISOString();
  await engine.advance(run, flow, 'email');
  assert.equal(run.status, 'completed');
  assert.equal(sends.length, 1);
  assert.deepEqual(db.steps.map(step => step.node_id), ['__visit:email:1', 'engaged']);
});
