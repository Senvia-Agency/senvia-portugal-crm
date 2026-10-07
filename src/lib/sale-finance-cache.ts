import type { QueryClient } from '@tanstack/react-query';

export const SALE_FINANCE_QUERY_KEYS = [
  ['finance-sales'], ['finance-stats'], ['commercial-commissions'],
  ['sale-chargebacks'],
  ['team-commission-total'], ['my-commissions'], ['team-commissions'],
  ['commissions-detail'], ['commissions-live'], ['sales-commissions'],
  ['activations-monthly'], ['activations-annual'],
];

export function invalidateSaleFinance(queryClient: QueryClient) {
  return Promise.all(SALE_FINANCE_QUERY_KEYS.map(queryKey => queryClient.invalidateQueries({ queryKey })));
}
