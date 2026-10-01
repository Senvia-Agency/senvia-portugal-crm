import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SALE_CYCLE_DUE_IN_2_DAYS,
  SALE_CYCLE_DUE_TODAY,
  SALE_CYCLE_OVERDUE,
  saleBillingTriggerForPaymentDate,
} from './sale-cycle-automations.ts';

const TODAY = '2026-10-01';
const IN_TWO_DAYS = '2026-10-03';

test('sends a normal scheduled payment to the two-day reminder', () => {
  assert.equal(saleBillingTriggerForPaymentDate(IN_TWO_DAYS, TODAY, IN_TWO_DAYS), SALE_CYCLE_DUE_IN_2_DAYS);
});

test('sends a normal pending payment due today to the due-today reminder', () => {
  assert.equal(saleBillingTriggerForPaymentDate(TODAY, TODAY, IN_TWO_DAYS), SALE_CYCLE_DUE_TODAY);
});

test('sends a normal pending payment from 29 September to the overdue reminder', () => {
  assert.equal(saleBillingTriggerForPaymentDate('2026-09-29', TODAY, IN_TWO_DAYS), SALE_CYCLE_OVERDUE);
});

test('does not send a payment due tomorrow through a reminder meant for another date', () => {
  assert.equal(saleBillingTriggerForPaymentDate('2026-10-02', TODAY, IN_TWO_DAYS), null);
});
