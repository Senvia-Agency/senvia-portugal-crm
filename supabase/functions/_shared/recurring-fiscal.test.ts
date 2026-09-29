import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  fiscalRetryDelaySeconds,
  formatLisbonFiscalDate,
  planRecurringFiscalDocuments,
} from "./recurring-fiscal.ts";

Deno.test("FT é criada no vencimento e RC espera a FT estar emitida", () => {
  const first = planRecurringFiscalDocuments({
    policy: "invoice_then_receipt",
    cycleAmount: 49,
    payments: [{ id: "pay-1", amount: 20, status: "paid" }],
    documents: [],
  });
  assertEquals(first.jobs, [{ kind: "invoice", amount: 49, reason: "cycle_due" }]);

  const afterIssue = planRecurringFiscalDocuments({
    policy: "invoice_then_receipt",
    cycleAmount: 49,
    payments: [{ id: "pay-1", amount: 20, status: "paid" }],
    documents: [{ kind: "invoice", status: "issued" }],
  });
  assertEquals(afterIssue.jobs, [{
    kind: "receipt", paymentId: "pay-1", amount: 20, reason: "payment_confirmed",
  }]);
});

Deno.test("pagamentos parciais geram um RC por pagamento sem duplicar", () => {
  const plan = planRecurringFiscalDocuments({
    policy: "invoice_then_receipt",
    cycleAmount: 100,
    payments: [
      { id: "pay-1", amount: 30, status: "paid" },
      { id: "pay-2", amount: 70, status: "paid" },
    ],
    documents: [
      { kind: "invoice", status: "issued" },
      { kind: "receipt", paymentId: "pay-1", status: "issued" },
    ],
  });
  assertEquals(plan.fullyPaid, true);
  assertEquals(plan.jobs, [{
    kind: "receipt", paymentId: "pay-2", amount: 70, reason: "payment_confirmed",
  }]);
});

Deno.test("FR só é criada quando a soma confirmada cobre o ciclo", () => {
  const partial = planRecurringFiscalDocuments({
    policy: "invoice_receipt_when_paid",
    cycleAmount: 49,
    payments: [{ id: "pay-1", amount: 20, status: "paid" }],
    documents: [],
  });
  assertEquals(partial.jobs, []);
  assertEquals(partial.fullyPaid, false);

  const paid = planRecurringFiscalDocuments({
    policy: "invoice_receipt_when_paid",
    cycleAmount: 49,
    payments: [
      { id: "pay-1", amount: 20, status: "paid" },
      { id: "pay-2", amount: 29, status: "paid" },
    ],
    documents: [],
  });
  assertEquals(paid.jobs, [{ kind: "invoice_receipt", amount: 49, reason: "cycle_paid" }]);
});

Deno.test("FT manual impede FR e converte pagamentos em RC", () => {
  const plan = planRecurringFiscalDocuments({
    policy: "invoice_receipt_when_paid",
    cycleAmount: 49,
    payments: [{ id: "pay-1", amount: 49, status: "paid" }],
    documents: [{ kind: "invoice", status: "issued" }],
  });
  assertEquals(plan.jobs, [{
    kind: "receipt", paymentId: "pay-1", amount: 49, reason: "payment_confirmed",
  }]);
});

Deno.test("chargeback pede revisão e refund só automatiza com opção explícita", () => {
  const review = planRecurringFiscalDocuments({
    policy: "invoice_then_receipt",
    cycleAmount: 49,
    payments: [
      { id: "pay-1", amount: 49, status: "paid", reversalStatus: "chargeback", reversedAmount: 49 },
      { id: "pay-2", amount: 10, status: "paid", reversalStatus: "refunded", reversedAmount: 5 },
    ],
    documents: [{ kind: "invoice", status: "issued" }],
  });
  assertEquals(review.manualReview, ["chargeback:pay-1", "refund:pay-2"]);

  const automatic = planRecurringFiscalDocuments({
    policy: "invoice_then_receipt",
    cycleAmount: 49,
    payments: [{ id: "pay-2", amount: 10, status: "paid", reversalStatus: "refunded", reversedAmount: 5 }],
    documents: [{ kind: "invoice", status: "issued" }],
    autoCreditNote: true,
  });
  assertEquals(automatic.jobs.some((job) => job.kind === "credit_note" && job.amount === 5), true);
});

Deno.test("datas fiscais usam Europe/Lisbon nos limites UTC", () => {
  assertEquals(formatLisbonFiscalDate(new Date("2026-03-29T00:30:00Z")), "2026-03-29");
  assertEquals(formatLisbonFiscalDate(new Date("2026-03-29T23:30:00Z")), "2026-03-30");
});

Deno.test("backoff é exponencial e limitado a seis horas", () => {
  assertEquals(fiscalRetryDelaySeconds(1), 30);
  assertEquals(fiscalRetryDelaySeconds(2), 60);
  assertEquals(fiscalRetryDelaySeconds(10), 15_360);
});
