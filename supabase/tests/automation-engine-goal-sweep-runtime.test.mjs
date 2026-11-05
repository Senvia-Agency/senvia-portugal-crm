import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, database, fixture } from './automation-engine-runtime-harness.mjs';

test('tick completes a long wait at goal before its wake time', async () => {
  const { Engine, handleTick, clock } = runtime();
  const { run, flow } = fixture([
    { id: 'wait', type: 'wait', config: { amount: 2, unit: 'days' } },
    { id: 'downstream', type: 'end', config: {} },
  ], [{ source: 'wait', target: 'downstream' }]);
  flow.trigger_config.goal = { field: 'status', operator: 'equals', value: 'paid' };
  run.context.__flow_snapshot = { graph: flow.graph, trigger_config: flow.trigger_config };
  const lead = { status: 'open' };
  const db = database(run, flow, lead);
  await new Engine(db).advance(run, flow, 'wait');
  const oldWake = run.wake_at;
  lead.status = 'paid';
  clock.time += 60_000;
  await handleTick(db);
  assert.equal(run.status, 'completed');
  assert.ok(run.context.__goal_reached_at);
  assert.ok(Date.parse(oldWake) > clock.time);
  assert.equal(run.wake_at, null);
  assert.deepEqual(db.steps.map(step => step.node_id), ['wait']);
});

test('stale park cannot revive completed run', async () => {
  const { Engine } = runtime();
  const { run, flow } = fixture([{ id: 'wait', type: 'wait', config: {} }]);
  run.status = 'completed';
  const db = database(run, flow);
  await new Engine(db).parkAll({ ...run, status: 'running' }, [{ node: 'wait', status: 'waiting', wake_at: '2026-11-05T10:00:00Z' }], {});
  assert.equal(run.status, 'completed');
});

test('completion during one effect prevents a stale worker from performing next effect', async () => {
  const { run, flow } = fixture([
    { id: 'first', type: 'webhook', config: { url: 'https://example.invalid/first' } },
    { id: 'second', type: 'webhook', config: { url: 'https://example.invalid/second' } },
  ], [{ source: 'first', target: 'second' }]);
  let calls = 0;
  const { Engine } = runtime(async () => { calls += 1; run.status = 'completed'; return { ok: true, status: 200 }; });
  const db = database(run, flow);
  await new Engine(db).advance(run, flow, 'first');
  assert.equal(calls, 1);
  assert.equal(run.status, 'completed');
});
