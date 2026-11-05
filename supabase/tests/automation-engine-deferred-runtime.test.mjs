import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, fixture } from './automation-engine-runtime-harness.mjs';
import { retryFailedRuns } from '../functions/automation-engine/failure-policy.ts';

function queuedDatabase(flow, count = 100) {
  const tables = { automation_flows: [flow], leads: Array.from({ length: count }, (_, i) => ({ id: `lead-${i}`, organization_id: 'org', email: 'a@example.test' })), automation_runs: [], automation_run_steps: [] };
  const db = { tables, functions: {}, from(table) {
    const rows = tables[table] ?? []; let op = 'select', payload, singular = false, limit = Infinity, head = false; const filters = [];
    const q = {
      select(_, opts) { head = opts?.head; return q; }, eq(k, v) { filters.push(r => r[k] === v); return q; },
      neq(k, v) { filters.push(r => r[k] !== v); return q; }, in(k, v) { filters.push(r => v.includes(r[k])); return q; }, lte(k, v) { filters.push(r => r[k] <= v); return q; },
      not() { filters.push(() => false); return q; }, or() { return q; }, order() { return q; }, limit(n) { limit = n; return q; },
      insert(p) { op = 'insert'; payload = p; return q; }, update(p) { op = 'update'; payload = p; return q; }, delete() { op = 'delete'; return q; },
      maybeSingle() { singular = true; return q; }, single() { singular = true; return q; },
      then(resolve, reject) { try {
        let selected = rows.filter(r => filters.every(f => f(r))).slice(0, limit);
        if (op === 'insert') {
          const row = table === 'automation_runs' ? { id: `run-${rows.length}`, status: 'running', steps_taken: 0, ...payload,
            context: { ...payload.context, __flow_snapshot: { graph: structuredClone(flow.graph), entry_node_id: flow.entry_node_id } } } : { id: `step-${rows.length}`, ...payload };
          rows.push(row); selected = [row];
        }
        if (op === 'update') selected.forEach(r => Object.assign(r, payload));
        if (op === 'delete') selected.forEach(r => rows.splice(rows.indexOf(r), 1));
        return Promise.resolve({ data: head ? null : structuredClone(singular ? selected[0] ?? null : selected), count: head ? selected.length : undefined, error: null }).then(resolve, reject);
      } catch (e) { return Promise.reject(e).then(resolve, reject); } },
    }; return q;
  } }; return db;
}

function setup() {
  const api = runtime();
  const { flow } = fixture([{ id: 'email', type: 'send_email', config: {} }]);
  flow.trigger_type = 'lead_created';
  const db = queuedDatabase(flow); let sends = 0;
  db.functions.invoke = async name => {
    assert.equal(name, 'send-template-email'); sends++; api.clock.time += 41_000;
    return { data: { results: [{ status: 'sent' }] }, error: null };
  };
  return { api, db, flow, sends: () => sends };
}

test('manual selection queues all 100 pinned runs without provider calls; tick claims one within budget', async () => {
  const f = setup();
  const result = await f.api.handleManual(f.db, { flow_id: 'flow', subject_type: 'lead', subject_ids: f.db.tables.leads.map(r => r.id) });
  assert.equal(result.enrolled, 100); assert.equal(result.queued, 100); assert.equal(f.sends(), 0);
  assert.equal(f.db.tables.automation_runs.length, 100);
  for (const run of f.db.tables.automation_runs) {
    assert.equal(run.status, 'waiting'); assert.equal(run.context.__cursors[0].resume_self, true);
    assert.equal(run.context.__flow_snapshot.graph.nodes[0].id, 'email');
  }
  await f.api.handleTick(f.db);
  assert.equal(f.sends(), 1);
  assert.equal(f.db.tables.automation_runs.filter(r => r.status === 'waiting').length, 99);
  assert.equal(f.db.tables.automation_runs.filter(r => r.status === 'running').length, 0);
  await f.api.handleTick(f.db);
  assert.equal(f.sends(), 2);
});

test('bulk retry queues 100 failed nodes without provider calls then tick executes only one', async () => {
  const f = setup();
  f.db.tables.automation_runs = f.db.tables.leads.map((lead, i) => ({ id: `failed-${i}`, organization_id: 'org', flow_id: 'flow', status: 'failed', subject_id: lead.id,
    subject_type: 'lead', contact_email: lead.email, context: { __flow_snapshot: { graph: f.flow.graph, entry_node_id: 'email' } }, steps_taken: 0 }));
  f.db.tables.automation_run_steps = f.db.tables.automation_runs.map(run => ({ id: `step-${run.id}`, run_id: run.id, node_id: 'email', status: 'failed' }));
  const result = await retryFailedRuns(f.db, { flowId: 'flow', organizationId: 'org', limit: 100 }, id => f.api.handleRetry(f.db, { run_id: id, from: 'failed_step' }, true));
  assert.equal(result.results.length, 100); assert.equal(f.sends(), 0);
  assert.equal(result.results.filter(r => r.result.queued).length, 100);
  assert.equal(f.db.tables.automation_runs.filter(r => r.status === 'waiting').length, 100);
  await f.api.handleTick(f.db);
  assert.equal(f.sends(), 1);
  assert.equal(f.db.tables.automation_runs.filter(r => r.status === 'waiting').length, 99);
});

test('an exhausted shared tick budget parks the unexecuted node without calling its provider', async () => {
  const f = setup();
  await f.api.handleManual(f.db, { flow_id: 'flow', subject_type: 'lead', subject_ids: ['lead-0'] });
  const run = f.db.tables.automation_runs[0];
  await new f.api.Engine(f.db).advance(run, f.flow, 'email', [], 0);
  assert.equal(f.sends(), 0);
  assert.equal(run.status, 'waiting');
  assert.equal(run.context.__cursors[0].node, 'email');
  assert.equal(run.context.__cursors[0].resume_self, true);
  await f.api.handleTick(f.db);
  assert.equal(f.sends(), 1);
});
