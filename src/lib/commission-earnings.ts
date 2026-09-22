interface CommissionSale {
  status: string;
  is_paid: boolean;
  total_value: number;
  paid_amount: number;
  comissao: number | null;
  earned_by_operator?: boolean;
}

/** Operator-earned commissions do not depend on the client's bill or receipts. */
export function commissionPortions(s: CommissionSale) {
  if (s.status === 'cancelled') return { confirmed: 0, pending: 0, fraction: 0 };
  const concluded = s.status === 'delivered' || s.status === 'fulfilled';
  const value = Number(s.total_value) || 0;
  const fraction = !concluded ? 0 : s.earned_by_operator || s.is_paid ? 1
    : value > 0 ? Math.min(1, Math.max(0, Number(s.paid_amount || 0) / value)) : 0;
  const commission = Number(s.comissao) || 0;
  return { confirmed: commission * fraction, pending: commission * (1 - fraction), fraction };
}
