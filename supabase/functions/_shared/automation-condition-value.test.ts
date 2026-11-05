import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateConditionValue, InvalidConditionValue } from './automation-condition-value.ts';

const compare = (operator: string, actual: unknown, expected: unknown, field = 'value') =>
  evaluateConditionValue({ operator, actual, expected, field, now: new Date('2026-11-04T12:00:00Z') });

test('inclusive numeric comparisons include the boundary and reject missing data', () => {
  assert.equal(compare('greater_or_equal', '10', '10'), true);
  assert.equal(compare('less_or_equal', 10, '10'), true);
  assert.equal(compare('greater_or_equal', 9, 10), false);
  assert.equal(compare('less_or_equal', null, 10), false);
  assert.equal(compare('greater_than', '', -1), false);
  assert.equal(compare('greater_than', Infinity, 10), false);
  assert.throws(() => compare('greater_or_equal', 10, 'invalid'), InvalidConditionValue);
  assert.throws(() => compare('less_or_equal', 10, ''), InvalidConditionValue);
});

test('dates compare instants including timezone offsets', () => {
  assert.equal(compare('before', '2026-11-04T09:00:00+01:00', '2026-11-04T08:30:00Z'), true);
  assert.equal(compare('after', '2026-11-04', '2026-11-03'), true);
  assert.equal(compare('before', undefined, '2026-11-03'), false);
  assert.equal(compare('after', 'invalid', '2026-11-03'), false);
  assert.throws(() => compare('before', '2026-11-04', 'invalid'), InvalidConditionValue);
  assert.throws(() => compare('after', '2026-11-04', '2026-02-30'), InvalidConditionValue);
  assert.equal(compare('before', '2026-02-30', '2026-11-04'), false);
});

test('older than days uses an injected clock and strict boundary', () => {
  assert.equal(compare('older_than_days', '2026-11-01T11:59:59Z', '3'), true);
  assert.equal(compare('older_than_days', '2026-11-01T12:00:00Z', '3'), false);
  assert.equal(compare('older_than_days', '2026-11-05T12:00:00Z', '0'), false);
  assert.throws(() => compare('older_than_days', '2026-11-01', '-1'), InvalidConditionValue);
});

test('list membership compares whole normalized items instead of substrings', () => {
  assert.equal(compare('contains_any', [' VIP ', 'cliente'], 'vip, parceiro'), true);
  assert.equal(compare('contains_any', ['cliente'], ['vip', 'parceiro']), false);
  assert.equal(compare('contains_any', ['supervip'], 'vip'), false);
  assert.equal(compare('contains_any', 'VIP, cliente', 'vip'), true);
  assert.equal(compare('contains_any', null, 'vip'), false);
});

test('legacy equality, phone normalization and empty operators remain supported', () => {
  assert.equal(compare('equals', '+351 912 345 678', '912345678', 'telefone'), true);
  assert.equal(compare('equals', '', '', 'telefone'), false);
  assert.equal(compare('equals', ' Sim ', 'sim'), true);
  assert.equal(compare('is_empty', null, undefined), true);
  assert.equal(compare('is_not_empty', 0, undefined), true);
  assert.throws(() => compare('invented', 'x', 'x'), InvalidConditionValue);
});
