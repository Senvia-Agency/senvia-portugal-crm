import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, database, fixture } from './automation-engine-runtime-harness.mjs';

function faultDatabase(f, fault) {
  const db = database(f.run, f.flow); const base = db.from;
  db.from = table => {
    const q = base(table); let operation = 'select', payload;
    const update = q.update; q.update = value => { operation = 'update'; payload = value; return update(value); };
    const then = q.then; q.then = (resolve, reject) => fault({ table, operation, payload })
      ? Promise.resolve({ data: null, error: { code: '08006', message: 'database unavailable' } }).then(resolve, reject)
      : then(resolve, reject);
    return q;
  };
  let sends = 0;
  db.functions = { invoke: async () => { sends++; return { data: { results: [{ status: 'sent' }] }, error: null }; } };
  return { db, sends: () => sends };
}

test('history read failure cannot become empty history and replay provider effects', async () => {
  const api = runtime(); const f = fixture([{ id: 'email', type: 'send_email', config: {} }]);
  const d = faultDatabase(f, q => q.table === 'automation_run_steps' && q.operation === 'select');
  await new api.Engine(d.db).advance(f.run, f.flow, 'email');
  assert.equal(d.sends(), 0); assert.equal(f.run.status, 'failed');
  assert.match(f.run.last_error, /histórico/); assert.ok(f.run.context.__requires_review);
});

test('flow lookup outage is a persistence failure and never treated as a deleted flow', async () => {
  const api = runtime(); const f = fixture([{ id: 'email', type: 'send_email', config: {} }]);
  f.run.status = 'waiting'; f.run.wake_at = new Date(api.clock.time).toISOString();
  const d = faultDatabase(f, q => q.table === 'automation_flows' && q.operation === 'select');
  await assert.rejects(api.loadFlow(d.db, f.flow.id), /consultar a automação/);
  await api.handleTick(d.db);
  assert.equal(d.sends(), 0); assert.equal(f.run.status, 'failed');
  assert.match(f.run.last_error, /consultar a automação/); assert.doesNotMatch(f.run.last_error, /apagado/);
});

test('parking write failure produces visible manual-review failure', async () => {
  const api = runtime(); const f = fixture([{ id: 'wait', type: 'wait', config: { amount: 1, unit: 'minutes' } }]);
  const d = faultDatabase(f, q => q.table === 'automation_runs' && q.operation === 'update' && q.payload.status === 'waiting');
  await new api.Engine(d.db).advance(f.run, f.flow, 'wait');
  assert.equal(f.run.status, 'failed'); assert.match(f.run.last_error, /guardar a espera/);
  assert.ok(f.run.context.__requires_review); assert.equal(d.sends(), 0);
});

test('database recovery marks stale running execution failed for review without replaying effects', async () => {
  const api = runtime(); const f = fixture([{ id: 'wait', type: 'wait', config: { amount: 1, unit: 'minutes' } }]);
  f.run.updated_at = new Date(api.clock.time).toISOString(); let offline = true;
  const d = faultDatabase(f, q => offline && q.table === 'automation_runs' && q.operation === 'update');
  await new api.Engine(d.db).advance(f.run, f.flow, 'wait');
  assert.equal(f.run.status, 'running');
  offline = false; api.clock.time += 6 * 60_000;
  const result = await api.handleTick(d.db);
  assert.equal(result.recovered, 1); assert.equal(f.run.status, 'failed');
  assert.ok(f.run.context.__requires_review); assert.equal(d.sends(), 0);
  assert.equal(d.db.steps.length, 1);
});

test('stale recovery cannot fail an execution updated after the stale read', async () => {
  const api = runtime(); const f = fixture([{ id: 'email', type: 'send_email', config: {} }]);
  f.run.updated_at = new Date(api.clock.time - 6 * 60_000).toISOString();
  const d = faultDatabase(f, () => false); const base = d.db.from;
  d.db.from = table => { const q = base(table); const then = q.then; let status;
    const eq = q.eq; q.eq = (key, value) => { if (key === 'status') status = value; return eq(key, value); };
    q.then = async (resolve, reject) => {
      const result = await then(value => value, reject);
      if (table === 'automation_runs' && status === 'running' && Array.isArray(result.data)) f.run.updated_at = new Date(api.clock.time).toISOString();
      return resolve(result);
    }; return q;
  };
  const result = await api.handleTick(d.db);
  assert.equal(result.recovered, 0); assert.equal(f.run.status, 'running'); assert.equal(d.sends(), 0);
});
