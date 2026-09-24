type PaymentForFiscalEligibility = {
  amount: number | string;
  status: string;
  reversed_amount?: number | string | null;
  reversal_status?: string | null;
};

function toCents(value: number | string): number {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

export function paidAmountInCents(payments: readonly PaymentForFiscalEligibility[]): number {
  return payments.reduce(
    (sum, payment) => {
      if (payment.status !== 'paid') return sum;
      const net = Math.max(0, toCents(payment.amount) - toCents(payment.reversed_amount ?? 0));
      return sum + net;
    },
    0,
  );
}

/** A FR is only valid when the paid amount covers the complete sale value. */
export function isSalePaidInFull(
  saleTotal: number | string,
  payments: readonly PaymentForFiscalEligibility[],
): boolean {
  const total = toCents(saleTotal);
  return total > 0 && paidAmountInCents(payments) >= total;
}
