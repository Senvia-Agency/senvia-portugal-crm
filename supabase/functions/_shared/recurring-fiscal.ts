// Pure recurring fiscal rules. Keeping this module free of I/O makes the
// document sequence testable without contacting KeyInvoice or Supabase.

export type FiscalDocumentPolicy = "invoice_then_receipt" | "invoice_receipt_when_paid";
export type FiscalDocumentKind = "invoice" | "invoice_receipt" | "receipt" | "credit_note";

export interface FiscalPayment {
  id: string;
  amount: number;
  status: string;
  reversalStatus?: "none" | "refund_pending" | "refunded" | "chargeback" | "reversed";
  reversedAmount?: number;
}

export interface FiscalDocument {
  kind: FiscalDocumentKind;
  paymentId?: string | null;
  status: "pending" | "processing" | "issued" | "retry" | "failed" | "cancelled" | "void";
}

export interface FiscalJob {
  kind: FiscalDocumentKind;
  paymentId?: string;
  amount: number;
  reason: "cycle_due" | "cycle_paid" | "payment_confirmed" | "refund_confirmed";
}

export interface FiscalPlan {
  paidAmount: number;
  fullyPaid: boolean;
  jobs: FiscalJob[];
  manualReview: string[];
}

const ACTIVE_DOCUMENT_STATES = new Set(["pending", "processing", "issued", "retry"]);

function cents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value * 100));
}

function hasDocument(documents: FiscalDocument[], kind: FiscalDocumentKind, paymentId?: string): boolean {
  return documents.some((document) =>
    document.kind === kind &&
    ACTIVE_DOCUMENT_STATES.has(document.status) &&
    (paymentId === undefined || document.paymentId === paymentId)
  );
}

/**
 * Decide which documents may be queued for a recurring cycle.
 *
 * - FT + RC: queue one FT for the cycle, then one RC per confirmed payment.
 * - FR when paid: queue one FR only after confirmed payments cover the cycle.
 * - If an FT already exists, FR is never allowed; confirmed payments get RCs.
 * - Chargebacks always need human review. A confirmed refund only becomes an
 *   automatic credit note when the organisation explicitly enabled it.
 */
export function planRecurringFiscalDocuments(input: {
  policy: FiscalDocumentPolicy;
  cycleAmount: number;
  payments: FiscalPayment[];
  documents: FiscalDocument[];
  autoCreditNote?: boolean;
}): FiscalPlan {
  const cycleCents = cents(input.cycleAmount);
  const confirmed = input.payments.filter((payment) => payment.status === "paid");
  const paidCents = confirmed.reduce((total, payment) => total + cents(payment.amount), 0);
  const fullyPaid = cycleCents > 0 && paidCents >= cycleCents;
  const jobs: FiscalJob[] = [];
  const manualReview: string[] = [];

  const hasInvoice = hasDocument(input.documents, "invoice");
  const hasInvoiceReceipt = hasDocument(input.documents, "invoice_receipt");
  const primaryDocumentExists = hasInvoice || hasInvoiceReceipt;

  if (input.policy === "invoice_then_receipt") {
    if (!primaryDocumentExists) {
      jobs.push({ kind: "invoice", amount: input.cycleAmount, reason: "cycle_due" });
    }

    // A receipt must reference an issued FT. Do not queue it while the FT is
    // merely pending: the next pass will see the issued document and continue.
    const issuedInvoice = input.documents.some((document) =>
      document.kind === "invoice" && document.status === "issued"
    );
    if (issuedInvoice) {
      for (const payment of confirmed) {
        if (cents(payment.amount) === 0 || hasDocument(input.documents, "receipt", payment.id)) continue;
        jobs.push({
          kind: "receipt",
          paymentId: payment.id,
          amount: payment.amount,
          reason: "payment_confirmed",
        });
      }
    }
  } else if (hasInvoice) {
    // A manually issued FT wins over the configured FR policy. Mixing FT and
    // FR for the same cycle would duplicate the taxable document.
    for (const payment of confirmed) {
      if (cents(payment.amount) === 0 || hasDocument(input.documents, "receipt", payment.id)) continue;
      jobs.push({
        kind: "receipt",
        paymentId: payment.id,
        amount: payment.amount,
        reason: "payment_confirmed",
      });
    }
  } else if (fullyPaid && !hasInvoiceReceipt) {
    jobs.push({ kind: "invoice_receipt", amount: input.cycleAmount, reason: "cycle_paid" });
  }

  for (const payment of input.payments) {
    const reversal = payment.reversalStatus ?? "none";
    if (reversal === "chargeback") {
      manualReview.push(`chargeback:${payment.id}`);
      continue;
    }
    if (reversal !== "refunded" && reversal !== "reversed") continue;

    const amount = Math.min(cents(payment.reversedAmount ?? payment.amount), cents(payment.amount)) / 100;
    if (amount <= 0 || hasDocument(input.documents, "credit_note", payment.id)) continue;
    if (!input.autoCreditNote) {
      manualReview.push(`refund:${payment.id}`);
      continue;
    }
    if (!primaryDocumentExists) {
      manualReview.push(`refund_without_document:${payment.id}`);
      continue;
    }
    jobs.push({
      kind: "credit_note",
      paymentId: payment.id,
      amount,
      reason: "refund_confirmed",
    });
  }

  return { paidAmount: paidCents / 100, fullyPaid, jobs, manualReview };
}

/** Retry schedule for unambiguous pre-delivery failures. Ambiguous provider
 * responses must be reconciled instead of calling the provider again. */
export function fiscalRetryDelaySeconds(attempt: number): number {
  const safeAttempt = Math.max(1, Math.min(10, Math.trunc(attempt) || 1));
  return Math.min(6 * 60 * 60, 30 * (2 ** (safeAttempt - 1)));
}

export function formatLisbonFiscalDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
