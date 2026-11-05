import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, database, fixture } from './automation-engine-runtime-harness.mjs';

for (const type of ['send_email', 'ai_classify']) {
  for (const status of [503, 429, 400]) {
    test(`${type} preserves real HTTP ${status} for retry policy`, async () => {
      const { Engine } = runtime();
      const { run, flow } = fixture([{ id: 'effect', type, config: { retry: { max_attempts: 3, interval_minutes: 1 } } }]);
      const db = database(run, flow);
      db.functions = { invoke: async () => ({ data: null, error: {
        message: 'Edge Function returned a non-2xx status code', context: new Response(null, { status }),
      } }) };
      await new Engine(db).advance(run, flow, 'effect');
      assert.equal(run.status, status === 400 ? 'failed' : 'waiting');
      if (status !== 400) assert.equal(run.context.__retry_effect.attempts, 1);
    });
  }
}

for (const [type, subject, config, rpc] of [
  ['create_lead', 'lead', { name: 'Ana', email: 'ana@example.test' }, 'automation_apply_record_action'],
  ['request_issue_invoice', 'sale', { reason: 'Emitir fatura' }, 'automation_request_financial_action'],
  ['mark_proposal_expired', 'proposal', {}, 'automation_expire_proposal'],
]) {
  test(`${type} passes a different idempotency identity on each bounded visit`, async () => {
    const { Engine } = runtime();
    const { run, flow } = fixture([{ id: 'effect', type, config }]);
    run.subject_type = subject;
    const db = database(run, flow, { status: 'sent', valid_until: '2000-01-01' });
    const calls = [];
    db.rpc = async (name, args) => { calls.push({ name, args }); return { data: { id: 'result', lead_id: 'new-lead' }, error: null }; };
    const engine = new Engine(db);
    assert.equal((await engine.execute(run, flow, flow.graph.nodes[0])).kind, 'next');
    run.context.__node_visits = { effect: 1 };
    assert.equal((await engine.execute(run, flow, flow.graph.nodes[0])).kind, 'next');
    assert.deepEqual(calls.map(call => [call.name, call.args.p_node_id]), [[rpc, 'effect'], [rpc, '__visit:effect:1']]);
  });
}

test('draft effect identity changes by visit while AI graph authorization stays canonical', async () => {
  const { Engine } = runtime();
  const { run, flow } = fixture([{ id: 'draft', type: 'ai_draft', config: {} }]);
  run.context.__node_visits = { draft: 2 };
  const db = database(run, flow);
  const providers = [], persisted = [];
  db.functions = { invoke: async (_, request) => {
    providers.push(request.body.node_id);
    return { data: { branch: 'ready', variables: {}, draft: { suggested_reply: 'Olá', confidence: 1, motivo: 'Revisão' } }, error: null };
  } };
  db.rpc = async (_, args) => { persisted.push(args.p_node_id); return { data: 'task-id', error: null }; };
  assert.equal((await new Engine(db).execute(run, flow, flow.graph.nodes[0])).kind, 'next');
  assert.deepEqual(providers, ['draft']);
  assert.deepEqual(persisted, ['__visit:draft:2']);
});
