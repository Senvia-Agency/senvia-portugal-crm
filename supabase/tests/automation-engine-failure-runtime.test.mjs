import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, database, fixture } from './automation-engine-runtime-harness.mjs';

function failureFixture() {
  const f = fixture([{ id: 'effect', type: 'end', config: {} }]);
  f.flow.max_steps_per_run = 0;
  f.flow.created_by = 'owner';
  f.flow.trigger_config = { failure_alert_enabled: true,
    failure_policy: { enabled: true, threshold_percent: 20, min_runs: 2, window_minutes: 60 } };
  const db = database(f.run, f.flow, { user_id: 'owner', is_active: true });
  const counts = { notifications: 0, tasks: 0, policies: 0 };
  const from = db.from.bind(db);
  db.from = table => {
    const q = from(table);
    if (table === 'inbox_tasks') { const insert = q.insert; q.insert = value => { counts.tasks += 1; return insert(value); }; }
    return q;
  };
  db.functions = { invoke: async name => { assert.equal(name, 'send-push-notification'); counts.notifications += 1; return { data: { success: true, sent: 1 }, error: null }; } };
  db.rpc = async name => { assert.equal(name, 'apply_automation_failure_policy'); counts.policies += 1; return { data: { paused: false }, error: null }; };
  return { ...f, db, counts };
}

test('maximum step budget failure runs the same notification, task and protection policy as node failures', async () => {
  const { Engine } = runtime();
  const f = failureFixture();
  await new Engine(f.db).advance(f.run, f.flow, 'effect');
  assert.equal(f.run.status, 'failed');
  assert.deepEqual(f.counts, { notifications: 1, tasks: 1, policies: 1 });
});
test('already cancelled execution cannot emit failure side effects', async () => {
  const { Engine } = runtime();
  const f = failureFixture(); f.run.status = 'cancelled';
  assert.equal(await new Engine(f.db).fail(f.run, 'late failure'), false);
  assert.equal(f.run.status, 'cancelled');
  assert.deepEqual(f.counts, { notifications: 0, tasks: 0, policies: 0 });
});
test('only one concurrent failure transition emits notifications and protection policy', async () => {
  const { Engine } = runtime();
  const f = failureFixture();
  const first = structuredClone(f.run), second = structuredClone(f.run);
  const results = await Promise.all([new Engine(f.db).fail(first, 'first'), new Engine(f.db).fail(second, 'second')]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.deepEqual(f.counts, { notifications: 1, tasks: 1, policies: 1 });
});

for (const code of ['08006', '23505']) {
  test(`successful send followed by step INSERT ${code} never proceeds downstream or resends`, async () => {
    const { Engine, handleTick } = runtime();
    const f = failureFixture();
    f.flow.max_steps_per_run = 20;
    f.flow.graph = { nodes: [
      { id: 'email', type: 'send_email', config: { retry: { max_attempts: 3, interval_minutes: 1 } } },
      { id: 'downstream', type: 'send_email', config: {} },
    ], edges: [{ source: 'email', target: 'downstream' }] };
    let sends = 0;
    const invoke = f.db.functions.invoke;
    f.db.functions.invoke = async (name, request) => {
      if (name !== 'send-template-email') return invoke(name, request);
      sends += 1;
      return { data: { results: [{ status: 'sent' }] }, error: null };
    };
    const from = f.db.from;
    f.db.from = table => {
      const q = from(table);
      if (table === 'automation_run_steps') q.insert = () => Promise.resolve({ data: null,
        error: { code, message: code === '23505' ? 'duplicate key' : 'database connection timeout' } });
      return q;
    };
    await new Engine(f.db).advance(f.run, f.flow, 'email');
    assert.equal(sends, 1);
    assert.equal(f.db.steps.some(step => step.node_id === 'downstream'), false);
    if (code !== '23505') {
      assert.equal(f.run.status, 'failed');
      assert.equal(f.run.context.__requires_review.node_id, 'email');
      assert.equal(f.run.context.__retry_email, undefined);
      assert.deepEqual(f.counts, { notifications: 1, tasks: 1, policies: 1 });
    }
    await handleTick(f.db);
    assert.equal(sends, 1);
  });
}

test('waiting step with rejected history write fails durably instead of escaping with a running run', async () => {
  const { Engine, handleTick } = runtime();
  const { run, flow } = fixture([{ id: 'wait', type: 'wait', config: { amount: 1, unit: 'minutes' } }]);
  const db = database(run, flow);
  const from = db.from;
  db.from = table => {
    const q = from(table);
    if (table === 'automation_run_steps') q.insert = () => Promise.reject(new Error('network lost'));
    return q;
  };
  await new Engine(db).advance(run, flow, 'wait');
  assert.equal(run.status, 'failed');
  assert.equal(run.context.__requires_review.node_id, 'wait');
  assert.equal(run.wake_at, null);
  await handleTick(db);
  assert.equal(run.status, 'failed');
});
