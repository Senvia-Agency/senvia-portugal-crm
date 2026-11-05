import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, database, fixture } from './automation-engine-runtime-harness.mjs';

function setup(fail) {
  const f = fixture([{ id: 'entry', type: 'end', config: {} }]);
  f.flow.trigger_type = 'message_received';
  f.flow.trigger_config = { buffer_seconds: 0 };
  const db = database(f.run, f.flow);
  db.rpc = async () => ({ error: null });
  const base = db.from; let failures = 0;
  db.from = table => {
    const q = base(table); q.or ??= () => q; let columns; const terms = {};
    const select = q.select; q.select = (value, ...rest) => { columns = value; return select(value, ...rest); };
    const eq = q.eq; q.eq = (key, value) => { terms[key] = value; return eq(key, value); };
    const then = q.then; q.then = (resolve, reject) => {
      if (fail({ table, columns, terms })) { failures++; return Promise.resolve({ data: null, error: { code: '08006', message: 'database unavailable' } }).then(resolve, reject); }
      return then(resolve, reject);
    };
    return q;
  };
  return { ...f, db, failures: () => failures };
}

test('enrollment flow read failure is propagated rather than reported as zero enrollments', async () => {
  const { handleEnroll } = runtime();
  const f = setup(q => q.table === 'automation_flows');
  await assert.rejects(handleEnroll(f.db, { organization_id: 'org', trigger_type: 'message_received', record: { id: 'lead' } }), /consultar as automações/);
  assert.equal(f.failures(), 1);
});

test('once enrollment prior run read failure does not admit a new run', async () => {
  const { handleEnroll } = runtime();
  const f = setup(q => q.table === 'automation_runs'); f.flow.reentry_policy = 'once';
  await assert.rejects(handleEnroll(f.db, { organization_id: 'org', trigger_type: 'message_received', record: { id: 'lead' } }), /inscrições anteriores/);
  assert.equal(f.failures(), 1);
});

test('reply wait lookup failure propagates and never falls through to a new-message trigger', async () => {
  const { handleReply } = runtime();
  const f = setup(q => q.table === 'automation_runs');
  await assert.rejects(handleReply(f.db, { organization_id: 'org', phone: '+351912345678', text: 'hello' }), /espera de resposta/);
  assert.equal(f.failures(), 1);
});

for (const phase of ['flows', 'active', 'once']) {
  test(`message ${phase} lookup failure propagates without silently accepting the event`, async () => {
    const { handleMessageStart } = runtime();
    const f = setup(q => phase === 'flows' ? q.table === 'automation_flows' : q.table === 'automation_runs' &&
      (phase === 'active' ? q.columns?.includes('current_node_id') : q.columns === 'id'));
    if (phase === 'once') f.flow.reentry_policy = 'once';
    await assert.rejects(handleMessageStart(f.db, 'org', '351912345678', 'hello', { phone: '+351912345678', conversation_id: 'conversation' }), /Não foi possível/);
    assert.equal(f.failures(), 1);
  });
}
