import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, database, fixture } from './automation-engine-runtime-harness.mjs';

function loopFixture(withWait = false, maxVisits = 3) {
  const nodes = [
    { id: 'entry', type: 'lead_created', config: {} },
    { id: 'webhook', type: 'webhook', config: { url: 'https://example.invalid' } },
    ...(withWait ? [{ id: 'wait', type: 'wait', config: { amount: 1, unit: 'minutes' } }] : []),
    { id: 'jump', type: 'goto', config: { target_node_id: 'webhook', max_visits: maxVisits } },
    { id: 'end', type: 'end', config: {} },
  ];
  const edges = nodes.slice(0, -1).map((node, index) => ({ source: node.id, target: nodes[index + 1].id }));
  const result = fixture(nodes, edges);
  result.flow.max_steps_per_run = 100;
  return result;
}

test('bounded jump sends three times and records distinct visit history', async () => {
  let calls = 0;
  const { Engine } = runtime(async () => { calls += 1; return { ok: true, status: 200 }; });
  const { run, flow } = loopFixture();
  const db = database(run, flow);
  await new Engine(db).advance(run, flow, 'entry');
  assert.equal(run.status, 'completed');
  assert.equal(calls, 3);
  assert.deepEqual(db.steps.filter(step => step.node_type === 'webhook').map(step => step.node_id), ['webhook', '__visit:webhook:1', '__visit:webhook:2']);
  assert.equal(db.steps.filter(step => step.node_type === 'goto').length, 3);
});

test('tick resumes wait within each visit without replaying earlier completed effects', async () => {
  let calls = 0;
  const { Engine, handleTick, clock } = runtime(async () => { calls += 1; return { ok: true, status: 200 }; });
  const { run, flow } = loopFixture(true, 2);
  const db = database(run, flow);
  await new Engine(db).advance(run, flow, 'entry');
  assert.equal(calls, 1);
  clock.time += 60_000;
  await handleTick(db);
  assert.equal(calls, 2);
  assert.equal(run.status, 'waiting');
  clock.time += 60_000;
  await handleTick(db);
  assert.equal(calls, 2);
  assert.equal(run.status, 'completed');
  const waits = db.steps.filter(step => step.node_type === 'wait');
  assert.deepEqual(waits.map(step => step.node_id), ['wait', '__visit:wait:1']);
  assert.ok(waits.every(step => step.status === 'ok'));
});

test('retry failed synthetic visit resumes the canonical node and preserves earlier visit', async () => {
  let calls = 0;
  const { handleRetry } = runtime(async () => { calls += 1; return { ok: true, status: 200 }; });
  const { run, flow } = fixture([{ id: 'webhook', type: 'webhook', config: { url: 'https://example.invalid' } }]);
  run.status = 'failed';
  run.context.__node_visits = { webhook: 1 };
  const db = database(run, flow);
  db.steps.push({ run_id: run.id, node_id: 'webhook', node_type: 'webhook', status: 'ok', detail: {} },
    { run_id: run.id, node_id: '__visit:webhook:1', node_type: 'webhook', status: 'failed', detail: {} });
  await handleRetry(db, { run_id: run.id, from: 'failed_step' });
  assert.equal(run.status, 'completed');
  assert.equal(calls, 1);
  assert.deepEqual(db.steps.map(step => [step.node_id, step.status]), [['webhook', 'ok'], ['__visit:webhook:1', 'ok']]);
});

test('cancellation during the final effect cannot be overwritten by completion', async () => {
  const { run, flow } = fixture([{ id: 'last', type: 'webhook', config: { url: 'https://example.invalid' } }]);
  const { Engine } = runtime(async () => { run.status = 'cancelled'; return { ok: true, status: 200 }; });
  const db = database(run, flow);
  await new Engine(db).advance(run, flow, 'last');
  assert.equal(run.status, 'cancelled');
});
