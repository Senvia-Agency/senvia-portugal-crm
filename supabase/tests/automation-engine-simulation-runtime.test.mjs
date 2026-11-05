import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, fixture } from './automation-engine-runtime-harness.mjs';
import { enrollmentStore } from './automation-engine-enrollment-store.mjs';

function simulationStore(type, config) {
  const flow = fixture([{ id: 'node', type, config }]).flow;
  const store = enrollmentStore({ automation_flows: [flow], leads: [{ id: 'lead', organization_id: 'org', name: 'Ana', email: 'ana@example.test', source: 'web' }] });
  let effects = 0;
  store.functions = { invoke: async () => { effects += 1; throw new Error('Simulation attempted external invocation'); } };
  return { store, effects: () => effects };
}
const request = { flow_id: 'flow', node_id: 'node', subject_type: 'lead', subject_id: 'lead' };

test('step simulation previews email without sends or database mutations', async () => {
  const { handleStepSimulation } = runtime(() => { throw new Error('Simulation attempted HTTP'); });
  const { store, effects } = simulationStore('send_email', { subject: 'Olá {{nome}}', html: '<p>{{email}}</p>' });
  const result = await handleStepSimulation(store, request);
  assert.equal(result.simulation, true);
  assert.equal(result.status, 'simulated');
  assert.equal('variables' in result, false);
  assert.equal(result.detail.assunto, 'Olá Ana');
  assert.equal(result.detail.html, '<p>ana@example.test</p>');
  assert.equal(effects(), 0);
  assert.ok(store.queries.every(query => query.operation === 'select'));
});

test('step simulation evaluates condition against current record without run insertion', async () => {
  const { handleStepSimulation } = runtime();
  const { store } = simulationStore('condition', { field: 'source', operator: 'equals', value: 'web' });
  const result = await handleStepSimulation(store, request);
  assert.equal(result.detail.resultado, true);
  assert.ok(store.queries.every(query => query.operation === 'select'));
});
