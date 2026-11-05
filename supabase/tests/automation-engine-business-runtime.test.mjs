import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, database, fixture } from './automation-engine-runtime-harness.mjs';

test('cancelled run performs no next external action', async () => {
  let calls = 0;
  const { Engine } = runtime(async () => { calls += 1; return { ok: true, status: 200 }; });
  const { run, flow } = fixture([{ id: 'webhook', type: 'webhook', config: { url: 'https://example.invalid' } }]);
  run.status = 'cancelled';
  const db = database(run, flow);
  await new Engine(db).advance(run, flow, 'webhook');
  assert.equal(calls, 0);
  assert.equal(run.status, 'cancelled');
});

test('cancellation during one action prevents the following action', async () => {
  const { run, flow } = fixture([
    { id: 'first', type: 'webhook', config: { url: 'https://example.invalid/first' } },
    { id: 'second', type: 'webhook', config: { url: 'https://example.invalid/second' } },
  ], [{ source: 'first', target: 'second' }]);
  let calls = 0;
  const { Engine } = runtime(async () => {
    calls += 1;
    run.status = 'cancelled';
    return { ok: true, status: 200 };
  });
  const db = database(run, flow);
  await new Engine(db).advance(run, flow, 'first');
  assert.equal(calls, 1);
  assert.equal(run.status, 'cancelled');
  assert.deepEqual(db.steps.map(step => step.node_id), ['first']);
});

function childFlowDatabase(run, flow) {
  const db = database(run, flow);
  const originalFrom = db.from;
  db.from = (table) => {
    if (table !== 'automation_flows') return originalFrom(table);
    const query = {
      select() { return query; }, eq() { return query; },
      async maybeSingle() { return { data: { id: 'child-flow', trigger_type: 'lead_created' }, error: null }; },
    };
    return query;
  };
  return db;
}

test('subflow call carries lineage and records child enrollment in step history', async () => {
  const { Engine } = runtime();
  const { run, flow } = fixture([{ id: 'child', type: 'execute_flow', config: { flow_id: 'child-flow' } }]);
  run.context = { __flow_chain: ['ancestor-flow'], __flow_snapshot: { secret: true }, source: 'web' };
  const db = childFlowDatabase(run, flow);
  const calls = [];
  db.functions = { invoke: async (name, request) => { calls.push({ name, request }); return { data: { enrolled: 1 } }; } };
  await new Engine(db).advance(run, flow, 'child');
  assert.equal(run.status, 'completed');
  assert.equal(calls.length, 1);
  const body = calls[0].request.body;
  assert.equal(body.flow_id, 'child-flow');
  assert.deepEqual(body.flow_chain, ['ancestor-flow', 'flow']);
  assert.equal(body.record.id, 'lead');
  assert.equal(body.record.__flow_snapshot, undefined);
  assert.equal(body.record.__flow_chain, undefined);
  assert.equal(db.steps[0].detail.fluxo, 'child-flow');
  assert.equal(db.steps[0].detail.inscritos, 1);
});

for (const chain of [['child-flow'], Array.from({ length: 8 }, (_, index) => `ancestor-${index}`)]) {
  test(`subflow rejects ${chain.length === 8 ? 'excessive depth' : 'cycle'} before invoking another engine`, async () => {
    const { Engine } = runtime();
    const { run, flow } = fixture([{ id: 'child', type: 'execute_flow', config: { flow_id: 'child-flow' } }]);
    run.context.__flow_chain = chain;
    const db = childFlowDatabase(run, flow);
    let calls = 0;
    db.functions = { invoke: async () => { calls += 1; return { data: { enrolled: 1 } }; } };
    await new Engine(db).advance(run, flow, 'child');
    assert.equal(run.status, 'failed');
    assert.equal(calls, 0);
    assert.equal(db.steps[0].status, 'failed');
    assert.match(run.last_error, /ciclo/);
  });
}

test('disabling lead after first effect prevents second effect and cancels run', async () => {
  const { run, flow } = fixture([
    { id: 'first', type: 'webhook', config: { url: 'https://example.invalid/first' } },
    { id: 'second', type: 'webhook', config: { url: 'https://example.invalid/second' } },
  ], [{ source: 'first', target: 'second' }]);
  const currentLead = { automation_enabled: true };
  let calls = 0;
  const { Engine } = runtime(async () => {
    calls += 1;
    currentLead.automation_enabled = false;
    return { ok: true, status: 200 };
  });
  const db = database(run, flow, currentLead);
  await new Engine(db).advance(run, flow, 'first');
  assert.equal(calls, 1);
  assert.equal(run.status, 'cancelled');
  assert.deepEqual(db.steps.map(step => step.node_id), ['first']);
});
