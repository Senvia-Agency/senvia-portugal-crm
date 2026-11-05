import assert from 'node:assert/strict';
import test from 'node:test';
import { conditionValueIssue } from './automation-condition-validation.ts';

test('numeric comparison accepts finite values including zero and rejects text and infinity', () => {
  for (const operator of ['greater_than', 'less_than', 'greater_or_equal', 'less_or_equal']) {
    assert.equal(conditionValueIssue(operator, '0'), null);
    assert.equal(conditionValueIssue(operator, -1.5), null);
    assert.ok(conditionValueIssue(operator, 'not a number'));
    assert.ok(conditionValueIssue(operator, 'Infinity'));
    assert.ok(conditionValueIssue(operator, false));
  }
});

test('age allows zero days and rejects negative or non-numeric days', () => {
  assert.equal(conditionValueIssue('older_than_days', 0), null);
  assert.ok(conditionValueIssue('older_than_days', -1));
  assert.ok(conditionValueIssue('older_than_days', 'later'));
});

test('date operands accept real dates and ISO instants and reject nonexistent calendar days', () => {
  assert.equal(conditionValueIssue('before', '2026-11-04'), null);
  assert.equal(conditionValueIssue('after', '2026-11-04T09:30:00+00:00'), null);
  assert.ok(conditionValueIssue('before', '04/11/2026'));
  assert.ok(conditionValueIssue('after', '2026-02-30'));
});

test('contains any requires a nonempty comma-separated or array choice', () => {
  assert.equal(conditionValueIssue('contains_any', 'hot, warm'), null);
  assert.equal(conditionValueIssue('contains_any', ['hot', 'warm']), null);
  assert.ok(conditionValueIssue('contains_any', ',\n ,'));
  assert.ok(conditionValueIssue('contains_any', []));
});

test('dynamic operands are resolved during execution and equality remains textual', () => {
  assert.equal(conditionValueIssue('greater_than', '{{valor}}'), null);
  assert.equal(conditionValueIssue('before', '{{data_vencimento}}'), null);
  assert.equal(conditionValueIssue('equals', 'qualquer texto'), null);
  assert.equal(conditionValueIssue('is_empty', undefined), null);
});
