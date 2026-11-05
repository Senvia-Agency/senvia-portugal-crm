import assert from "node:assert/strict";
import test from "node:test";

import { projectAutomationReceivables } from "./automation-receivables.ts";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const SALE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CYCLE_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

test("projects one recurring debt when several partial payments belong to its cycle", () => {
  // Given
  const input = {
    organizationId: ORG_A,
    sales: [{
      id: SALE_A,
      organizationId: ORG_A,
      clientId: "client-a",
      status: "active",
    }],
    cycles: [{
      id: CYCLE_A,
      organizationId: ORG_A,
      saleId: SALE_A,
      dueDate: "2026-10-01",
      amount: 100,
      status: "pending",
      paidAt: null,
      recurrenceServiceStatus: "active",
      billingProvider: "manual",
    }],
    payments: [
      {
        id: "p1",
        organizationId: ORG_A,
        saleId: SALE_A,
        recurringCycleId: CYCLE_A,
        dueDate: "2026-10-01",
        amount: 25,
        status: "paid",
        reversalStatus: "none",
      },
      {
        id: "p2",
        organizationId: ORG_A,
        saleId: SALE_A,
        recurringCycleId: CYCLE_A,
        dueDate: "2026-10-01",
        amount: 15,
        status: "paid",
        reversalStatus: "none",
      },
      {
        id: "p3",
        organizationId: ORG_A,
        saleId: SALE_A,
        recurringCycleId: CYCLE_A,
        dueDate: "2026-10-01",
        amount: 60,
        status: "pending",
        reversalStatus: "none",
      },
    ],
  } as const;

  // When
  const result = projectAutomationReceivables(input);

  // Then
  assert.deepEqual(result.collectible, [{
    kind: "recurring_cycle",
    receivableId: `sale_recurring_cycle:${CYCLE_A}`,
    organizationId: ORG_A,
    saleId: SALE_A,
    clientId: "client-a",
    sourceId: CYCLE_A,
    dueDate: "2026-10-01",
    outstandingAmount: 60,
  }]);
  assert.deepEqual(result.manualReview, []);
});

test("keeps an autonomous payment distinct from a cycle on the same sale and date", () => {
  // Given
  const input = {
    organizationId: ORG_A,
    sales: [{
      id: SALE_A,
      organizationId: ORG_A,
      clientId: "client-a",
      status: "active",
    }],
    cycles: [{
      id: CYCLE_A,
      organizationId: ORG_A,
      saleId: SALE_A,
      dueDate: "2026-10-01",
      amount: 100,
      status: "pending",
      paidAt: null,
      recurrenceServiceStatus: "active",
      billingProvider: "manual",
    }],
    payments: [{
      id: "standalone",
      organizationId: ORG_A,
      saleId: SALE_A,
      recurringCycleId: null,
      dueDate: "2026-10-01",
      amount: 35,
      status: "pending",
      reversalStatus: "none",
    }],
  } as const;

  // When
  const result = projectAutomationReceivables(input);

  // Then
  assert.deepEqual(result.collectible.map((item) => item.receivableId), [
    `sale_recurring_cycle:${CYCLE_A}`,
    "sale_payment:standalone",
  ]);
});

test("routes a reversed linked payment to manual review and never exposes its cycle for collection", () => {
  // Given
  const input = {
    organizationId: ORG_A,
    sales: [{
      id: SALE_A,
      organizationId: ORG_A,
      clientId: "client-a",
      status: "active",
    }],
    cycles: [{
      id: CYCLE_A,
      organizationId: ORG_A,
      saleId: SALE_A,
      dueDate: "2026-10-01",
      amount: 100,
      status: "pending",
      paidAt: null,
      recurrenceServiceStatus: "active",
      billingProvider: "manual",
    }],
    payments: [{
      id: "reversed",
      organizationId: ORG_A,
      saleId: SALE_A,
      recurringCycleId: CYCLE_A,
      dueDate: "2026-10-01",
      amount: 40,
      status: "paid",
      reversalStatus: "refunded",
    }],
  } as const;

  // When
  const result = projectAutomationReceivables(input);

  // Then
  assert.deepEqual(result.collectible, []);
  assert.deepEqual(result.manualReview, [{
    receivableId: `sale_recurring_cycle:${CYCLE_A}`,
    organizationId: ORG_A,
    saleId: SALE_A,
    sourceId: CYCLE_A,
    reason: "payment_reversal",
  }]);
});

test("routes a reversed autonomous payment to manual review", () => {
  // Given
  const input = {
    organizationId: ORG_A,
    sales: [{
      id: SALE_A,
      organizationId: ORG_A,
      clientId: "client-a",
      status: "active",
    }],
    cycles: [],
    payments: [{
      id: "reversed",
      organizationId: ORG_A,
      saleId: SALE_A,
      recurringCycleId: null,
      dueDate: "2026-10-01",
      amount: 40,
      status: "pending",
      reversalStatus: "chargeback",
    }],
  } as const;

  // When
  const result = projectAutomationReceivables(input);

  // Then
  assert.deepEqual(result.collectible, []);
  assert.deepEqual(result.manualReview, [{
    receivableId: "sale_payment:reversed",
    organizationId: ORG_A,
    saleId: SALE_A,
    sourceId: "reversed",
    reason: "payment_reversal",
  }]);
});

test("projects a pending Stripe cycle without duplicating its linked payment", () => {
  const result = projectAutomationReceivables(
    {
      organizationId: ORG_A,
      sales: [{
        id: SALE_A,
        organizationId: ORG_A,
        clientId: "client-a",
        status: "active",
      }],
      cycles: [{
        id: CYCLE_A,
        organizationId: ORG_A,
        saleId: SALE_A,
        dueDate: "2026-10-01",
        amount: 100,
        status: "pending",
        paidAt: null,
        recurrenceServiceStatus: "active",
        billingProvider: "stripe",
      }],
      payments: [{
        id: "stripe-linked-pending",
        organizationId: ORG_A,
        saleId: SALE_A,
        recurringCycleId: CYCLE_A,
        dueDate: "2026-10-01",
        amount: 100,
        status: "pending",
        reversalStatus: "none",
      }],
    } as const,
  );

  assert.deepEqual(result.collectible.map((item) => item.receivableId), [
    `sale_recurring_cycle:${CYCLE_A}`,
  ]);
  assert.equal(result.collectible[0]?.outstandingAmount, 100);
  assert.deepEqual(result.manualReview, []);
});

test("excludes settled and void Stripe cycles", () => {
  const result = projectAutomationReceivables(
    {
      organizationId: ORG_A,
      sales: [{
        id: SALE_A,
        organizationId: ORG_A,
        clientId: "client-a",
        status: "active",
      }],
      cycles: [
        {
          id: "stripe-paid",
          organizationId: ORG_A,
          saleId: SALE_A,
          dueDate: "2026-10-01",
          amount: 100,
          status: "paid",
          paidAt: "2026-10-02T00:00:00Z",
          recurrenceServiceStatus: "active",
          billingProvider: "stripe",
        },
        {
          id: "stripe-void",
          organizationId: ORG_A,
          saleId: SALE_A,
          dueDate: "2026-10-01",
          amount: 100,
          status: "void",
          paidAt: null,
          recurrenceServiceStatus: "active",
          billingProvider: "stripe",
        },
        {
          id: "legacy-cancelled",
          organizationId: ORG_A,
          saleId: SALE_A,
          dueDate: "2026-10-01",
          amount: 100,
          status: "cancelled",
          paidAt: null,
          recurrenceServiceStatus: "active",
          billingProvider: "stripe",
        },
      ],
      payments: [],
    } as const,
  );

  assert.deepEqual(result, { collectible: [], manualReview: [] });
});

test("routes a reversed Stripe cycle payment to manual review", () => {
  const result = projectAutomationReceivables(
    {
      organizationId: ORG_A,
      sales: [{
        id: SALE_A,
        organizationId: ORG_A,
        clientId: "client-a",
        status: "active",
      }],
      cycles: [{
        id: CYCLE_A,
        organizationId: ORG_A,
        saleId: SALE_A,
        dueDate: "2026-10-01",
        amount: 100,
        status: "paid",
        paidAt: "2026-10-02T00:00:00Z",
        recurrenceServiceStatus: "active",
        billingProvider: "stripe",
      }],
      payments: [{
        id: "stripe-refund",
        organizationId: ORG_A,
        saleId: SALE_A,
        recurringCycleId: CYCLE_A,
        dueDate: "2026-10-01",
        amount: 100,
        status: "paid",
        reversalStatus: "refunded",
      }],
    } as const,
  );

  assert.deepEqual(result.collectible, []);
  assert.deepEqual(result.manualReview, [{
    receivableId: `sale_recurring_cycle:${CYCLE_A}`,
    organizationId: ORG_A,
    saleId: SALE_A,
    sourceId: CYCLE_A,
    reason: "payment_reversal",
  }]);
});

test("excludes paid and cancelled debts and records from another organization", () => {
  // Given
  const cancelledSale = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const input = {
    organizationId: ORG_A,
    sales: [
      {
        id: SALE_A,
        organizationId: ORG_A,
        clientId: "client-a",
        status: "active",
      },
      {
        id: cancelledSale,
        organizationId: ORG_A,
        clientId: "client-b",
        status: "cancelled",
      },
      {
        id: "foreign-sale",
        organizationId: ORG_B,
        clientId: "foreign",
        status: "active",
      },
    ],
    cycles: [
      {
        id: "paid-cycle",
        organizationId: ORG_A,
        saleId: SALE_A,
        dueDate: "2026-10-01",
        amount: 100,
        status: "paid",
        paidAt: "2026-10-02T00:00:00Z",
        recurrenceServiceStatus: "active",
        billingProvider: "manual",
      },
      {
        id: "cancelled-cycle",
        organizationId: ORG_A,
        saleId: cancelledSale,
        dueDate: "2026-10-01",
        amount: 100,
        status: "pending",
        paidAt: null,
        recurrenceServiceStatus: "active",
        billingProvider: "manual",
      },
      {
        id: "foreign-cycle",
        organizationId: ORG_B,
        saleId: "foreign-sale",
        dueDate: "2026-10-01",
        amount: 100,
        status: "pending",
        paidAt: null,
        recurrenceServiceStatus: "active",
        billingProvider: "manual",
      },
    ],
    payments: [
      {
        id: "paid",
        organizationId: ORG_A,
        saleId: SALE_A,
        recurringCycleId: null,
        dueDate: "2026-10-01",
        amount: 20,
        status: "paid",
        reversalStatus: "none",
      },
      {
        id: "cancelled",
        organizationId: ORG_A,
        saleId: cancelledSale,
        recurringCycleId: null,
        dueDate: "2026-10-01",
        amount: 20,
        status: "pending",
        reversalStatus: "none",
      },
      {
        id: "foreign",
        organizationId: ORG_B,
        saleId: "foreign-sale",
        recurringCycleId: null,
        dueDate: "2026-10-01",
        amount: 20,
        status: "pending",
        reversalStatus: "none",
      },
    ],
  } as const;

  // When
  const result = projectAutomationReceivables(input);

  // Then
  assert.deepEqual(result, { collectible: [], manualReview: [] });
});
