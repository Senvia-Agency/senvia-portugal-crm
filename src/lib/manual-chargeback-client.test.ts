import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveManualChargebackClient } from './manual-chargeback-client.ts';

test('keeps an unregistered legacy customer name without linking a CRM client', () => {
  assert.deepEqual(resolveManualChargebackClient(' Cliente antigo ', []), {
    clientId: null,
    clientName: 'Cliente antigo',
  });
});

test('links an exact existing customer name while preserving its display name', () => {
  assert.deepEqual(resolveManualChargebackClient('cliente conhecido', [
    { id: 'client-1', name: 'Cliente Conhecido' },
  ]), {
    clientId: 'client-1',
    clientName: 'Cliente Conhecido',
  });
});
