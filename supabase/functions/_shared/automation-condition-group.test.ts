import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateConditionGroup, InvalidConditionGroup } from './automation-condition-group.ts';

test('Todas exige que todas as regras correspondam', async () => {
  const config = { match: 'all', conditions: [{ value: true }, { value: false }] };
  const result = await evaluateConditionGroup(config, async rule => rule.value === true);
  assert.deepEqual(result, { matched: false, results: [true, false] });
});

test('Qualquer aceita uma correspondência e mantém resultados para o histórico', async () => {
  const config = { match: 'any', conditions: [{ value: false }, { value: true }] };
  const result = await evaluateConditionGroup(config, async rule => rule.value === true);
  assert.deepEqual(result, { matched: true, results: [false, true] });
});

test('grupo vazio e modo desconhecido não encaminham contactos silenciosamente', async () => {
  await assert.rejects(evaluateConditionGroup({ match: 'all', conditions: [] }, async () => true), InvalidConditionGroup);
  await assert.rejects(evaluateConditionGroup({ match: 'unknown', conditions: [{}] }, async () => true), InvalidConditionGroup);
});

test('falha na consulta de uma regra interrompe a avaliação', async () => {
  await assert.rejects(evaluateConditionGroup({ match: 'any', conditions: [{}] }, async () => { throw new Error('CRM indisponível'); }), /CRM indisponível/);
});
