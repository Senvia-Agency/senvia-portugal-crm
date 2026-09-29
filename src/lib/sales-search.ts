import { matchesSearch } from './utils.ts';

type SearchableSale = {
  readonly code?: string | null;
  readonly notes?: string | null;
  readonly lead?: { readonly name?: string | null; readonly email?: string | null } | null;
  readonly client?: {
    readonly name?: string | null;
    readonly company?: string | null;
    readonly code?: string | null;
    readonly nif?: string | null;
    readonly company_nif?: string | null;
  } | null;
};

export function matchesSaleSearch(sale: SearchableSale, query: string, isTelecom: boolean): boolean {
  return matchesSearch(
    query,
    sale.lead?.name,
    sale.lead?.email,
    sale.client?.name,
    sale.client?.company,
    sale.client?.code,
    sale.code,
    sale.notes,
    isTelecom ? sale.client?.nif : null,
    isTelecom ? sale.client?.company_nif : null,
  );
}
