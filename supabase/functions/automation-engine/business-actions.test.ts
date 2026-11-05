import assert from 'node:assert/strict';
import test from 'node:test';
import { eventTimes, targetFlowId } from './business-actions.ts';
import { InvalidCrmAction } from './crm-actions.ts';

test('event times resolve variables and normalize timezone', () => {
  assert.deepEqual(eventTimes({ start_time: '{{start}}', end_time: '{{end}}' }, {
    start: '2026-11-04T09:00:00+01:00', end: '2026-11-04T10:00:00+01:00',
  }), { start_time: '2026-11-04T08:00:00.000Z', end_time: '2026-11-04T09:00:00.000Z' });
});
test('event without end is supported but malformed and inverted dates fail', () => {
  assert.equal(eventTimes({ start_time: '2026-11-04T09:00:00Z' }, {}).end_time, null);
  assert.throws(() => eventTimes({ start_time: 'invalid' }, {}), InvalidCrmAction);
  assert.throws(() => eventTimes({ start_time: '2026-11-04T09:00:00Z', end_time: '2026-11-04T08:00:00Z' }, {}), InvalidCrmAction);
});
test('flow actions reject self-targets and missing targets', () => {
  assert.throws(() => targetFlowId({ flow_id: 'current' }, 'current'), InvalidCrmAction);
  assert.throws(() => targetFlowId({}, 'current'), InvalidCrmAction);
  assert.equal(targetFlowId({ flow_id: 'other' }, 'current'), 'other');
});

test('new lead requires a name and at least one usable contact channel', async () => {
  const { validateNewLead } = await import('./business-actions.ts');
  assert.throws(() => validateNewLead({ name: '', email: 'a@example.test' }), InvalidCrmAction);
  assert.throws(() => validateNewLead({ name: 'Ana', email: ' ', phone: '' }), InvalidCrmAction);
  assert.doesNotThrow(() => validateNewLead({ name: 'Ana', phone: '912345678' }));
  assert.doesNotThrow(() => validateNewLead({ name: 'Ana', email: 'a@example.test' }));
});

test('proposal email preserves each stored quantity price and discounted total', async () => {
  const { proposalEmailProducts } = await import('./business-actions.ts');
  assert.deepEqual(proposalEmailProducts([
    { product_id: 'a', quantity: 2, unit_price: 100, total: 180 },
    { product_id: 'b', quantity: 3, unit_price: 12.3, total: 36.9 },
  ], [{ id: 'a', name: 'Serviço A' }, { id: 'b', name: 'Serviço B' }]), [
    { name: 'Serviço A', quantity: 2, unitPrice: 100, total: 180 },
    { name: 'Serviço B', quantity: 3, unitPrice: 12.3, total: 36.9 },
  ]);
  assert.throws(() => proposalEmailProducts([{ product_id: 'foreign', quantity: 1, unit_price: 1, total: 1 }], []), InvalidCrmAction);
});
