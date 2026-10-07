import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateBdsOrganizationCommissionItems } from './bds-organization-commission.ts';

test('BDS organization commission is summarized separately from sellers’ sales', () => {
  const items = aggregateBdsOrganizationCommissionItems([
    { sale_id: 'commercial-sale', user_id: 'sara', amount: 125.5, paid_at: null },
    { sale_id: 'vitor-sale', user_id: 'sara', amount: 210, paid_at: null },
    { sale_id: 'already-paid', user_id: 'sara', amount: 20, paid_at: '2026-10-06T12:00:00Z' },
  ], '2026-10');

  assert.deepEqual(items, [
    {
      kind: 'organization',
      id: '2026-10:organization:pending',
      userId: 'sara',
      label: 'Comissão da organização · 2 vendas',
      date: null,
      amount: 335.5,
      saleValue: null,
      paid: false,
      sourceSaleIds: ['commercial-sale', 'vitor-sale'],
    },
    {
      kind: 'organization',
      id: '2026-10:organization:paid',
      userId: 'sara',
      label: 'Comissão da organização · 1 venda',
      date: null,
      amount: 20,
      saleValue: null,
      paid: true,
      sourceSaleIds: ['already-paid'],
    },
  ]);

  assert.deepEqual(
    aggregateBdsOrganizationCommissionItems([
      { sale_id: 'vitor-sale', user_id: 'sara', amount: 210, paid_at: null },
    ], '2026-10', 'commercial'),
    [],
    'a seller filter must not show Sara’s organization commission under another commercial',
  );

  assert.equal(
    aggregateBdsOrganizationCommissionItems([
      { sale_id: 'vitor-sale', user_id: 'sara', amount: 210, paid_at: null },
    ], '2026-10', 'sara')[0]?.amount,
    210,
    'filtering Sara must include organization commission earned from other sellers’ sales',
  );
});
