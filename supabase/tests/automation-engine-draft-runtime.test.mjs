import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, database, fixture } from './automation-engine-runtime-harness.mjs';

function draftFixture(taskError = null) {
  const { run, flow } = fixture([
    { id: 'draft', type: 'ai_draft', config: { text: '{{nome}} perguntou sobre o serviço.' } },
    { id: 'review-end', type: 'end', config: {} },
  ], [{ source: 'draft', target: 'review-end', branch: 'review' }]);
  const db = database(run, flow);
  const invocations = [];
  const rpcs = [];
  db.functions = { invoke: async (name, request) => {
    invocations.push({ name, request });
    return { data: {
      branch: 'ready', model: 'fixture-model',
      draft: { suggested_reply: 'Qual é o serviço pretendido?', confidence: 1, motivo: 'Confirmar contexto.' },
      variables: { otto_resposta_sugerida: 'Do not auto-send', arbitrary_model_action: 'send' },
    }, error: null };
  } };
  db.rpc = async (name, args) => { rpcs.push({ name, args }); return { data: taskError ? null : 'draft-task-id', error: taskError }; };
  return { run, flow, db, invocations, rpcs };
}
test('draft execution saves a review task and never exposes provider reply to sending variables', async () => {
  const { Engine } = runtime(async () => { throw new Error('Draft must not send network messages'); });
  const f = draftFixture();
  await new Engine(f.db).advance(f.run, f.flow, 'draft');
  assert.deepEqual(f.invocations.map(call => call.name), ['automation-ai']);
  assert.equal(f.invocations[0].request.body.mode, 'draft');
  assert.equal(f.rpcs[0].name, 'create_automation_reply_draft');
  assert.equal(f.rpcs[0].args.p_organization_id, f.run.organization_id);
  assert.equal(f.rpcs[0].args.p_reply, 'Qual é o serviço pretendido?');
  assert.equal(f.run.context.otto_rascunho_tarefa_id, 'draft-task-id');
  assert.equal(f.run.context.otto_resposta_sugerida, undefined);
  assert.equal(f.run.context.arbitrary_model_action, undefined);
  assert.equal(f.db.steps.find(step => step.node_id === 'draft').detail.ramo, 'review');
  assert.equal(f.run.status, 'completed');
});
test('failure to persist human review task fails draft without proceeding', async () => {
  const { Engine } = runtime();
  const f = draftFixture({ message: 'Task unavailable' });
  await new Engine(f.db).advance(f.run, f.flow, 'draft');
  assert.equal(f.run.status, 'failed');
  assert.equal(f.run.context.otto_rascunho_tarefa_id, undefined);
  assert.equal(f.db.steps.some(step => step.node_id === 'review-end'), false);
});
