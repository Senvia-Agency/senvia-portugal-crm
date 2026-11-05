import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, database, fixture } from './automation-engine-runtime-harness.mjs';

test('elapsed invocation budget durably defers the next effect and tick resumes exactly once', async () => {
  let calls = 0;
  const rt = runtime(async () => { calls += 1; if (calls === 1) rt.clock.time += 45_000; return { ok: true, status: 200 }; });
  const { run, flow } = fixture([
    { id: 'first', type: 'webhook', config: { url: 'https://example.invalid' } },
    { id: 'second', type: 'webhook', config: { url: 'https://example.invalid' } },
  ], [{ source: 'first', target: 'second' }]);
  const db = database(run, flow);
  await new rt.Engine(db).advance(run, flow, 'first');
  assert.equal(calls, 1);
  assert.equal(run.status, 'waiting');
  assert.equal(run.steps_taken, 1);
  assert.deepEqual(structuredClone(run.context.__cursors), [{ node: 'second', status: 'waiting', wake_at: '2026-11-04T10:00:45.000Z', resume_self: true }]);
  await rt.handleTick(db);
  assert.equal(calls, 2);
  assert.equal(run.status, 'completed');
  assert.deepEqual(db.steps.map(step => step.node_id), ['first', 'second']);
  await rt.handleTick(db);
  assert.equal(calls, 2);
});

test('budget yield retains an independent parked wait while deferring only unfinished effects', async () => {
  let calls = 0;
  const rt = runtime(async () => { calls += 1; if (calls === 1) rt.clock.time += 45_000; return { ok: true, status: 200 }; });
  const { run, flow } = fixture([
    { id: 'wait', type: 'wait', config: { amount: 1, unit: 'minutes' } },
    { id: 'first', type: 'webhook', config: { url: 'https://example.invalid' } },
    { id: 'second', type: 'webhook', config: { url: 'https://example.invalid' } },
  ], [{ source: 'first', target: 'second' }]);
  const db = database(run, flow);
  await new rt.Engine(db).advance(run, flow, ['wait', 'first']);
  assert.equal(calls, 1);
  assert.deepEqual(Array.from(run.context.__cursors, cursor => cursor.node), ['wait', 'second']);
  assert.equal(run.context.__cursors[0].resume_self, undefined);
  assert.equal(run.context.__cursors[1].resume_self, true);
  await rt.handleTick(db);
  assert.equal(calls, 2);
  assert.equal(run.status, 'waiting');
  rt.clock.time += 15_000;
  await rt.handleTick(db);
  assert.equal(run.status, 'completed');
  assert.equal(calls, 2);
  assert.equal(db.steps.filter(step => step.node_id === 'wait').length, 1);
});
