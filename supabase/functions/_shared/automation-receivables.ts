export type AutomationSale = Readonly<{
  id: string;
  organizationId: string;
  clientId: string | null;
  status: string;
}>;

export type AutomationRecurringCycle = Readonly<{
  id: string;
  organizationId: string;
  saleId: string;
  dueDate: string;
  amount: number;
  status: string;
  paidAt: string | null;
  recurrenceServiceStatus: string;
  billingProvider: string;
}>;

export type AutomationSalePayment = Readonly<{
  id: string;
  organizationId: string;
  saleId: string;
  recurringCycleId: string | null;
  dueDate: string;
  amount: number;
  status: "pending" | "paid";
  reversalStatus: string | null;
}>;

export type AutomationReceivableInput = Readonly<{
  organizationId: string;
  sales: readonly AutomationSale[];
  cycles: readonly AutomationRecurringCycle[];
  payments: readonly AutomationSalePayment[];
}>;

export type CollectibleReceivable = Readonly<{
  kind: "recurring_cycle" | "standalone_payment";
  receivableId: string;
  organizationId: string;
  saleId: string;
  clientId: string | null;
  sourceId: string;
  dueDate: string;
  outstandingAmount: number;
}>;

export type ManualReviewReason = "payment_reversal" | "inconsistent_relation";

export type ManualReviewReceivable = Readonly<{
  receivableId: string;
  organizationId: string;
  saleId: string;
  sourceId: string;
  reason: ManualReviewReason;
}>;

export type ReceivableProjection = Readonly<{
  collectible: readonly CollectibleReceivable[];
  manualReview: readonly ManualReviewReceivable[];
}>;

function cents(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

function amount(centsValue: number): number {
  return centsValue / 100;
}

function reversalRequiresReview(payment: AutomationSalePayment): boolean {
  return payment.reversalStatus !== null && payment.reversalStatus !== "none";
}

function isCollectibleCycleStatus(status: string): boolean {
  return status === "pending" || status === "failed";
}

function isSupportedBillingProvider(provider: string): boolean {
  return provider === "manual" || provider === "stripe";
}

export function projectAutomationReceivables(
  input: AutomationReceivableInput,
): ReceivableProjection {
  const sales = new Map(
    input.sales
      .filter((sale) => sale.organizationId === input.organizationId)
      .map((sale) => [sale.id, sale]),
  );
  const cycles = input.cycles.filter((cycle) =>
    cycle.organizationId === input.organizationId
  );
  const cyclesById = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const payments = input.payments.filter((payment) =>
    payment.organizationId === input.organizationId
  );
  const paymentsByCycle = new Map<string, AutomationSalePayment[]>();
  const reviewByReceivable = new Map<string, ManualReviewReceivable>();

  const addReview = (
    receivableId: string,
    saleId: string,
    sourceId: string,
    reason: ManualReviewReason,
  ): void => {
    reviewByReceivable.set(receivableId, {
      receivableId,
      organizationId: input.organizationId,
      saleId,
      sourceId,
      reason,
    });
  };

  for (const payment of payments) {
    if (payment.recurringCycleId === null) continue;
    const cycle = cyclesById.get(payment.recurringCycleId);
    const cycleReceivableId =
      `sale_recurring_cycle:${payment.recurringCycleId}`;
    if (!cycle || cycle.saleId !== payment.saleId) {
      addReview(
        cycleReceivableId,
        payment.saleId,
        payment.recurringCycleId,
        "inconsistent_relation",
      );
      continue;
    }
    const linked = paymentsByCycle.get(cycle.id) ?? [];
    linked.push(payment);
    paymentsByCycle.set(cycle.id, linked);
    if (reversalRequiresReview(payment)) {
      addReview(cycleReceivableId, cycle.saleId, cycle.id, "payment_reversal");
    }
  }

  const collectible: CollectibleReceivable[] = [];
  for (const cycle of cycles) {
    const receivableId = `sale_recurring_cycle:${cycle.id}`;
    const sale = sales.get(cycle.saleId);
    if (!sale) {
      addReview(receivableId, cycle.saleId, cycle.id, "inconsistent_relation");
      continue;
    }
    if (
      reviewByReceivable.has(receivableId) ||
      sale.status === "cancelled" ||
      !isCollectibleCycleStatus(cycle.status) ||
      cycle.paidAt !== null ||
      cycle.recurrenceServiceStatus !== "active" ||
      !isSupportedBillingProvider(cycle.billingProvider)
    ) continue;

    const paidCents = (paymentsByCycle.get(cycle.id) ?? [])
      .filter((payment) => payment.status === "paid")
      .reduce((total, payment) => total + cents(payment.amount), 0);
    const outstandingCents = Math.max(0, cents(cycle.amount) - paidCents);
    if (outstandingCents === 0) continue;
    collectible.push({
      kind: "recurring_cycle",
      receivableId,
      organizationId: input.organizationId,
      saleId: cycle.saleId,
      clientId: sale.clientId,
      sourceId: cycle.id,
      dueDate: cycle.dueDate,
      outstandingAmount: amount(outstandingCents),
    });
  }

  for (const payment of payments) {
    if (payment.recurringCycleId !== null) continue;
    const receivableId = `sale_payment:${payment.id}`;
    const sale = sales.get(payment.saleId);
    if (!sale) {
      addReview(
        receivableId,
        payment.saleId,
        payment.id,
        "inconsistent_relation",
      );
      continue;
    }
    if (reversalRequiresReview(payment)) {
      addReview(receivableId, payment.saleId, payment.id, "payment_reversal");
      continue;
    }
    if (
      sale.status === "cancelled" || payment.status !== "pending" ||
      cents(payment.amount) <= 0
    ) continue;
    collectible.push({
      kind: "standalone_payment",
      receivableId,
      organizationId: input.organizationId,
      saleId: payment.saleId,
      clientId: sale.clientId,
      sourceId: payment.id,
      dueDate: payment.dueDate,
      outstandingAmount: amount(cents(payment.amount)),
    });
  }

  return { collectible, manualReview: [...reviewByReceivable.values()] };
}
