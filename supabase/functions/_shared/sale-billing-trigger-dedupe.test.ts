import assert from 'node:assert/strict';
import test from 'node:test';

import { requiresSingleBillingEnrollment } from './sale-billing-trigger-dedupe.ts';

test('treats every sale billing reminder as a single enrollment per payment', () => {
  assert.equal(requiresSingleBillingEnrollment('sale_renewal_due_in_2_days'), true);
  assert.equal(requiresSingleBillingEnrollment('sale_renewal_due_today'), true);
  assert.equal(requiresSingleBillingEnrollment('sale_renewal_overdue'), true);
});

test('does not change the reentry policy of unrelated automations', () => {
  assert.equal(requiresSingleBillingEnrollment('lead_created'), false);
  assert.equal(requiresSingleBillingEnrollment('stripe_subscription_past_due'), false);
});
