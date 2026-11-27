import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { countsInFinance } from './plan-payments';

describe('plan payments in Financeiro', () => {
  test('a normal sale always counts', () => {
    assert.equal(countsInFinance({ status: 'pending', stripe_invoice_id: null, sale: { client_org_id: null } }), true);
  });
  test('a plan sale shows what was paid', () => {
    assert.equal(countsInFinance({ status: 'paid', stripe_invoice_id: 'in_1', sale: { client_org_id: 'org' } }), true);
  });
  test('a month Stripe refused shows as owed', () => {
    assert.equal(countsInFinance({ status: 'pending', stripe_invoice_id: 'in_nov', sale: { client_org_id: 'org' } }), true);
  });
  test('a plan month with no Stripe invoice stays out (Stripe collects it by itself)', () => {
    assert.equal(countsInFinance({ status: 'pending', stripe_invoice_id: null, sale: { client_org_id: 'org' } }), false);
  });
});
