import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { overduePayments, overdueOutsideCycles, sumAmounts } from './sale-overdue';

// Escolha Inteligente, sale 0009: the November month refused by Stripe is a
// pending payment dated 25/11; earlier months are paid.
const payments = [
  { amount: 54, status: 'paid', payment_date: '2026-10-25', stripe_invoice_id: 'in_oct' },
  { amount: '54.00', status: 'pending', payment_date: '2026-11-25', stripe_invoice_id: 'in_nov' },
  { amount: 54, status: 'pending', payment_date: '2026-12-25', stripe_invoice_id: null },
];

describe('sale overdue', () => {
  test('a pending payment past its date is late, a future one is not', () => {
    const late = overduePayments(payments, '2026-11-27');
    assert.deepEqual(late.map((p) => p.stripe_invoice_id), ['in_nov']);
    assert.equal(sumAmounts(late), 54);
  });
  test('due today is not late yet', () => {
    assert.equal(overduePayments(payments, '2026-11-25').length, 0);
  });
  test('a late payment already shown as an unpaid cycle is not counted twice', () => {
    const cycles = [{ status: 'failed', stripe_invoice_id: 'in_nov' }];
    assert.equal(overdueOutsideCycles(payments, cycles, '2026-11-27').length, 0);
    assert.equal(overdueOutsideCycles(payments, [{ status: 'paid', stripe_invoice_id: 'in_nov' }], '2026-11-27').length, 1);
    assert.equal(overdueOutsideCycles(payments, [], '2026-11-27').length, 1);
  });
});
