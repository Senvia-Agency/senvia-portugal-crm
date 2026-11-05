import assert from 'node:assert/strict';
import test from 'node:test';
import { fieldPatch, taskDueAt, InvalidCrmAction } from './crm-actions.ts';

test('field patch cannot overwrite identity or tenant', () => {
  for (const field of ['id', 'organization_id', 'assigned_to', 'approved_by', 'comissao']) {
    assert.throws(() => fieldPatch('lead', { field, value: 'foreign' }, {}), InvalidCrmAction);
  }
});
test('lead value is numeric and variables are rendered', () => {
  assert.deepEqual(fieldPatch('lead', { field: 'value', value: '{{amount}}' }, { amount: 250 }), { value: 250 });
  assert.deepEqual(fieldPatch('client', { field: 'notes', value: 'Olá {{nome}}' }, { nome: 'Ana' }), { notes: 'Olá Ana' });
  assert.throws(() => fieldPatch('lead', { field: 'value', value: 'abc' }, {}), InvalidCrmAction);
});
test('unsupported entities and accounting fields are rejected', () => {
  assert.throws(() => fieldPatch('invoice', { field: 'status', value: 'paid' }, {}), InvalidCrmAction);
  assert.throws(() => fieldPatch('sale', { field: 'status', value: 'approved' }, {}), InvalidCrmAction);
});
test('task deadline supports minutes and hours while retaining legacy days', () => {
  const now = new Date('2026-11-04T09:00:00Z');
  assert.equal(taskDueAt({ due_amount: 15, due_unit: 'minutes' }, now), '2026-11-04T09:15:00.000Z');
  assert.equal(taskDueAt({ due_amount: 2, due_unit: 'hours' }, now), '2026-11-04T11:00:00.000Z');
  assert.equal(taskDueAt({ due_in_days: 1 }, now), '2026-11-05T09:00:00.000Z');
});
test('invalid deadlines do not create a task due immediately', () => {
  const now = new Date('2026-11-04T09:00:00Z');
  for (const config of [{ due_amount: -1, due_unit: 'minutes' }, { due_amount: 'bad', due_unit: 'hours' }, { due_amount: 1, due_unit: 'weeks' }]) {
    assert.throws(() => taskDueAt(config, now), InvalidCrmAction);
  }
});
