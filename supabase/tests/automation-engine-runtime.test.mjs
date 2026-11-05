import assert from 'node:assert/strict';
import test from 'node:test';
import { deterministicAssignment } from '../functions/_shared/automation-split.ts';
import { runtime, database, fixture } from './automation-engine-runtime-harness.mjs';

test('real Engine wait_until keeps a long wait alive beyond completed-step budget', async () => {
  const { Engine, clock } = runtime();
  const { run, flow } = fixture([{ id: 'wait', type: 'wait_until', config: { field: 'status', operator: 'equals', value: 'paid', timeout_amount: 24, timeout_unit: 'hours' } }]);
  const db = database(run, flow, { status: 'open' });
  const engine = new Engine(db);
  for (let poll = 0; poll < 5; poll += 1) {
    await engine.advance(run, flow, 'wait');
    clock.time += 60_000;
  }
  assert.equal(run.status, 'waiting');
  assert.equal(db.steps.length, 0);
});

test('real Engine router selects only first matching route', async () => {
  const { Engine } = runtime();
  const { run, flow } = fixture([
    { id: 'router', type: 'router', config: { routes: ['first', 'second'].map(id => ({ id, match: 'all', conditions: [{ field: 'source', operator: 'equals', value: 'web' }] })) } },
    { id: 'first-end', type: 'end', config: {} }, { id: 'second-end', type: 'end', config: {} },
  ], [{ source: 'router', target: 'first-end', branch: 'first' }, { source: 'router', target: 'second-end', branch: 'second' }]);
  run.context.source = 'web';
  const db = database(run, flow);
  await new Engine(db).advance(run, flow, 'router');
  assert.deepEqual(db.steps.map(step => step.node_id), ['router', 'first-end']);
});

test('real Engine goal reloads current record and suppresses the next action', async () => {
  const { Engine } = runtime();
  const { run, flow } = fixture([{ id: 'end', type: 'end', config: {} }]);
  flow.trigger_config.goal = { field: 'status', operator: 'equals', value: 'paid' };
  run.context.status = 'open';
  const db = database(run, flow, { status: 'paid' });
  await new Engine(db).advance(run, flow, 'end');
  assert.equal(run.status, 'completed');
  assert.ok(run.context.__goal_reached_at);
  assert.equal(db.steps.length, 0);
});

test('loadFlow uses pinned graph while retaining current organization and status', async () => {
  const { loadFlow } = runtime();
  const { run, flow } = fixture([{ id: 'new', type: 'end', config: {} }]);
  run.context.__flow_snapshot = { graph: { nodes: [{ id: 'old' }], edges: [] }, organization_id: 'wrong', status: 'wrong' };
  const pinned = await loadFlow(database(run, flow), flow.id, run);
  assert.equal(pinned.graph.nodes[0].id, 'old');
  assert.equal(pinned.organization_id, 'org');
  assert.equal(pinned.status, 'active');
});

test('wait_until preserves deadline across polls then takes timeout path', async () => {
  const { Engine, clock } = runtime();
  const { run, flow } = fixture([
    { id: 'wait', type: 'wait_until', config: { field: 'status', operator: 'equals', value: 'paid', timeout_amount: 5, timeout_unit: 'minutes' } },
    { id: 'expired', type: 'end', config: {} },
  ], [{ source: 'wait', target: 'expired', branch: 'timeout' }]);
  const db = database(run, flow, { status: 'open' });
  const engine = new Engine(db);
  await engine.advance(run, flow, 'wait');
  const deadline = run.context.__wait_deadline_wait;
  clock.time += 60_000;
  await engine.advance(run, flow, 'wait');
  assert.equal(run.context.__wait_deadline_wait, deadline);
  assert.equal(db.steps.length, 0);
  clock.time += 4 * 60_000;
  await engine.advance(run, flow, 'wait');
  assert.equal(run.status, 'completed');
  assert.deepEqual(db.steps.map(step => step.node_id), ['wait', 'expired']);
  assert.equal(db.steps[0].detail.ramo, 'timeout');
});

test('wait_until preserves CRM lookup variables for downstream nodes', async () => {
  const { Engine } = runtime();
  const { run, flow } = fixture([{ id: 'wait', type: 'wait_until', config: { field: 'email', operator: 'in_clients' } }]);
  const db = database(run, flow);
  const engine = new Engine(db);
  engine.findInCrm = async () => ({ client: { id: 'client-found', name: 'Ana' }, lead: null, by: 'email' });
  await engine.advance(run, flow, 'wait');
  assert.equal(run.context.cliente_id, 'client-found');
});

test('retry parks same email node and preserves count until successful retry', async () => {
  const { Engine, clock } = runtime();
  const { run, flow } = fixture([
    { id: 'email', type: 'send_email', config: { subject: 'Olá', html: 'Mensagem', retry: { max_attempts: 3, interval_minutes: 5 } } },
    { id: 'end', type: 'end', config: {} },
  ], [{ source: 'email', target: 'end' }]);
  const db = database(run, flow);
  let calls = 0;
  db.functions = { invoke: async () => {
    calls += 1;
    return calls === 1 ? { error: { message: 'HTTP 503' } } : { data: { results: [{ status: 'sent' }] } };
  } };
  const engine = new Engine(db);
  await engine.advance(run, flow, 'email');
  assert.equal(run.status, 'waiting');
  assert.equal(run.context.__retry_email.attempts, 1);
  assert.equal(run.context.__cursors[0].resume_self, true);
  assert.equal(run.wake_at, '2026-11-04T10:05:00.000Z');
  assert.equal(db.steps.length, 0);
  clock.time += 5 * 60_000;
  await engine.advance(run, flow, 'email');
  assert.equal(run.status, 'completed');
  assert.equal(run.context.__retry_email, undefined);
  assert.equal(calls, 2);
  assert.deepEqual(db.steps.map(step => step.node_id), ['email', 'end']);
});

test('retry from start uses the version pinned to the newly created run', async () => {
  const { handleRetry } = runtime();
  const { run, flow } = fixture([{ id: 'new-end', type: 'end', config: {} }]);
  run.status = 'completed';
  run.context.__flow_snapshot = { graph: { nodes: [{ id: 'old-end', type: 'end', config: {} }], edges: [] }, entry_node_id: 'old-end' };
  const db = database(run, flow);
  await handleRetry(db, { run_id: run.id, from: 'start' });
  assert.deepEqual(db.steps.map(step => step.node_id), ['new-end']);
});

test('retry from start clears old wait deadlines and retry counters', async () => {
  const { handleRetry } = runtime();
  const { run, flow } = fixture([{ id: 'end', type: 'end', config: {} }]);
  run.status = 'completed';
  run.context.__wait_deadline_wait = '2026-10-01T00:00:00Z';
  run.context.__retry_email = { attempts: 2 };
  run.context.__goal_reached_at = '2026-10-01T00:00:00Z';
  const db = database(run, flow);
  await handleRetry(db, { run_id: run.id, from: 'start' });
  assert.equal(run.context.__wait_deadline_wait, undefined);
  assert.equal(run.context.__retry_email, undefined);
  assert.equal(run.context.__goal_reached_at, undefined);
});

test('webhook HTTP 503 follows retry policy instead of completing successfully', async () => {
  const { Engine } = runtime(async () => ({ status: 503, ok: false }));
  const { run, flow } = fixture([{ id: 'webhook', type: 'webhook', config: { url: 'https://example.invalid', retry: { max_attempts: 3, interval_minutes: 5 } } }]);
  const db = database(run, flow);
  await new Engine(db).advance(run, flow, 'webhook');
  assert.equal(run.status, 'waiting');
  assert.equal(run.context.__retry_webhook.attempts, 1);
  assert.equal(db.steps.length, 0);
});

test('filter false ends its path without executing downstream action', async () => {
  const { Engine } = runtime();
  const { run, flow } = fixture([
    { id: 'filter', type: 'filter', config: { field: 'source', operator: 'equals', value: 'web' } },
    { id: 'downstream', type: 'end', config: {} },
  ], [{ source: 'filter', target: 'downstream' }]);
  run.context.source = 'manual';
  const db = database(run, flow);
  await new Engine(db).advance(run, flow, 'filter');
  assert.equal(run.status, 'completed');
  assert.deepEqual(db.steps.map(step => step.node_id), ['filter']);
});

test('split_ab uses stable subject identity across new run ids', async () => {
  const { Engine } = runtime();
  const variants = [{ id: 'a', label: 'A', weight: 50 }, { id: 'b', label: 'B', weight: 50 }];
  const expected = deterministicAssignment('flow', 'lead', variants);
  for (const runId of ['run-one', 'run-two']) {
    const { run, flow } = fixture([
      { id: 'split', type: 'split_ab', config: { variants } },
      { id: 'a-end', type: 'end', config: {} }, { id: 'b-end', type: 'end', config: {} },
    ], [{ source: 'split', target: 'a-end', branch: 'a' }, { source: 'split', target: 'b-end', branch: 'b' }]);
    run.id = runId;
    const db = database(run, flow);
    await new Engine(db).advance(run, flow, 'split');
    assert.deepEqual(db.steps.map(step => step.node_id), ['split', `${expected}-end`]);
  }
});

for (const policy of ['continue', 'error_branch']) {
  test(`on_error ${policy} follows configured path only after retry is exhausted`, async () => {
    const { Engine } = runtime(async () => ({ status: 503, ok: false }));
    const { run, flow } = fixture([
      { id: 'webhook', type: 'webhook', config: { url: 'https://example.invalid', retry: { max_attempts: 3, interval_minutes: 5 }, on_error: policy } },
      { id: 'normal', type: 'end', config: {} }, { id: 'error', type: 'end', config: {} },
    ], [{ source: 'webhook', target: 'normal' }, { source: 'webhook', target: 'error', branch: 'error' }]);
    const db = database(run, flow);
    const engine = new Engine(db);
    await engine.advance(run, flow, 'webhook');
    assert.equal(run.status, 'waiting');
    assert.equal(db.steps.length, 0);
    run.context.__retry_webhook = { attempts: 2 };
    await engine.advance(run, flow, 'webhook');
    assert.equal(run.status, 'completed');
    assert.deepEqual(db.steps.map(step => step.node_id), ['webhook', policy === 'continue' ? 'normal' : 'error']);
    assert.equal(db.steps[0].detail.falhou, true);
  });
}
