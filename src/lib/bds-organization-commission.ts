export interface BdsOrganizationCommissionRow {
  readonly sale_id: string;
  readonly user_id: string;
  readonly amount: number;
  readonly paid_at: string | null;
}

export interface BdsOrganizationCommissionItem {
  readonly kind: 'organization';
  readonly id: string;
  readonly userId: string;
  readonly label: string;
  readonly date: null;
  readonly amount: number;
  readonly saleValue: null;
  readonly paid: boolean;
  readonly sourceSaleIds: readonly string[];
}

export function aggregateBdsOrganizationCommissionItems(
  rows: readonly BdsOrganizationCommissionRow[],
  period: string,
  selectedUserId: string | null = null,
): BdsOrganizationCommissionItem[] {
  const grouped = new Map<string, {
    userId: string;
    paid: boolean;
    amount: number;
    saleIds: string[];
  }>();

  for (const row of rows) {
    if (selectedUserId && row.user_id !== selectedUserId) continue;
    const paid = row.paid_at !== null;
    const key = `${row.user_id}:${paid ? 'paid' : 'pending'}`;
    const current = grouped.get(key) ?? {
      userId: row.user_id,
      paid,
      amount: 0,
      saleIds: [],
    };
    current.amount = Math.round((current.amount + row.amount) * 100) / 100;
    current.saleIds.push(row.sale_id);
    grouped.set(key, current);
  }

  return Array.from(grouped.values())
    .sort((left, right) => Number(left.paid) - Number(right.paid))
    .map(({ userId, paid, amount, saleIds }) => ({
      kind: 'organization',
      id: `${period}:organization:${paid ? 'paid' : 'pending'}`,
      userId,
      label: `Comissão da organização · ${saleIds.length} ${saleIds.length === 1 ? 'venda' : 'vendas'}`,
      date: null,
      amount,
      saleValue: null,
      paid,
      sourceSaleIds: saleIds,
    }));
}
