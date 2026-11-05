import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalStepNodeId, stepVisitNumber } from './automation-step-identity.ts';

test('histórico usa identidade canónica gravada pelo motor', () => {
  const step = { node_id: '__visit:other:2', detail: { canonical_node_id: 'email', visit: 2 } };
  assert.equal(canonicalStepNodeId(step), 'email');
  assert.equal(stepVisitNumber(step), 3);
});

test('passos antigos continuam com identidade original e primeira passagem', () => {
  assert.equal(canonicalStepNodeId({ node_id: 'email', detail: {} }), 'email');
  assert.equal(stepVisitNumber({ node_id: 'email', detail: {} }), 1);
});

test('identificador codificado de visita é reconhecido sem metadata', () => {
  const step = { node_id: '__visit:email%3A1:2', detail: {} };
  assert.equal(canonicalStepNodeId(step), 'email:1');
  assert.equal(stepVisitNumber(step), 3);
});
