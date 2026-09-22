/**
 * Filters for the telecom commission cards in Financeiro.
 *
 * Operators are opt-OUT: everything counts until an operator is switched off,
 * so "all except Digi" is one click. The excluded set is what gets persisted,
 * which also means an operator created tomorrow shows up ticked. A product
 * with no operator on it (the generic "1P ou 2P" sold under any brand) is its
 * own switch, NO_OPERATOR.
 */
import type { CatalogProduct, ServicosDetails } from '@/types/proposals';

/** Sentinel for sale lines that carry no operator at all. */
export const NO_OPERATOR = '__none__';
/** Sentinel for lines whose product has no type yet. */
export const NO_TYPE = '__notype__';

/** Sale → the product-type ids on its lines (NO_TYPE for untyped ones). */
export type SaleTypeIdsResolver = (sale: CommissionFilterableSale) => string[];

export interface CommissionFilters {
  /** Operator ids switched OFF, plus NO_OPERATOR for generic lines. Empty = all. */
  excludedOperators: string[];
  /** The seller a sale is assigned to; null = everyone. */
  userId: string | null;
  /** Telecom states switched OFF (pendente, em_instalacao, ativo, …). Empty = all. */
  excludedStatuses: string[];
  /** Product types switched OFF, plus NO_TYPE for untyped products. Empty = all. */
  excludedTypes?: string[];
}

export const DEFAULT_COMMISSION_FILTERS: CommissionFilters = {
  excludedOperators: [],
  userId: null,
  excludedStatuses: [],
};

export function hasCommissionFilters(f: CommissionFilters | undefined): boolean {
  return !!f && (
    f.excludedOperators.length > 0
    || f.userId !== null
    || (f.excludedStatuses ?? []).length > 0
    || (f.excludedTypes ?? []).length > 0
  );
}

/** Minimal shape of a sale row the predicate needs. */
export interface CommissionFilterableSale {
  seller_id?: string | null;
  created_by?: string | null;
  servicos_details?: unknown;
  telecom_status?: string | null;
}

/** The operators frozen on a sale's lines — read off the lines, never the catalog. */
export function saleOperatorKeys(sale: CommissionFilterableSale): string[] {
  const details = (sale.servicos_details ?? {}) as ServicosDetails;
  const keys = Object.values(details).map((d) => d?.operator_id || NO_OPERATOR);
  return keys.length > 0 ? [...new Set(keys)] : [NO_OPERATOR];
}

/**
 * Whether a sale survives the filters. A sale carrying lines from several
 * operators stays in while ANY of them is still switched on — the commission
 * is booked per sale, not per line, so it cannot be split here.
 */
export function saleMatchesCommissionFilters(
  sale: CommissionFilterableSale,
  filters: CommissionFilters | undefined,
  typeIdsOf?: SaleTypeIdsResolver,
): boolean {
  if (!hasCommissionFilters(filters)) return true;
  const f = filters as CommissionFilters;
  // Types, like operators: the sale stays while ANY line's type is still on.
  const excludedTypes = f.excludedTypes ?? [];
  if (excludedTypes.length > 0 && typeIdsOf) {
    const off = new Set(excludedTypes);
    if (!typeIdsOf(sale).some((t) => !off.has(t))) return false;
  }
  if (f.userId && (sale.seller_id || sale.created_by) !== f.userId) return false;
  // A sale with no telecom state yet is not in any bucket, so no switch
  // can turn it off. (`?? []` because the filters are persisted and older
  // saved copies predate this field.)
  if (sale.telecom_status && (f.excludedStatuses ?? []).includes(sale.telecom_status)) return false;
  if (f.excludedOperators.length > 0) {
    const excluded = new Set(f.excludedOperators);
    if (!saleOperatorKeys(sale).some((k) => !excluded.has(k))) return false;
  }
  return true;
}

/**
 * Builds the sale → type ids resolver from the catalog. A line's product is
 * found by name, preferring the entry under the line's own operator (the
 * same name can exist once per operator). A product with no types, or a
 * line whose product is gone from the catalog, resolves to NO_TYPE.
 */
export function buildSaleTypeIds(catalog: CatalogProduct[]): SaleTypeIdsResolver {
  const find = (name: string, operatorId?: string | null) =>
    (operatorId ? catalog.find((c) => c.name === name && c.operator_id === operatorId) : undefined)
    ?? catalog.find((c) => c.name === name && !c.operator_id)
    ?? catalog.find((c) => c.name === name);
  return (sale) => {
    const details = (sale.servicos_details ?? {}) as ServicosDetails;
    const names = Object.keys(details);
    if (names.length === 0) return [NO_TYPE];
    const ids = names.flatMap((name) => {
      const product = find(name, details[name]?.operator_id);
      const typeIds = product?.type_ids ?? [];
      const technology = details[name]?.tecnologia;
      if (!technology) return typeIds.length > 0 ? typeIds : [NO_TYPE];
      // Fibra/Satélite is a choice made on this sale line. A generic catalog
      // product can carry other broad tags (for example "Cartões"), but those
      // must not keep a fibre line visible after Fibra is switched off.
      return [technology];
    });
    return [...new Set(ids)];
  };
}
