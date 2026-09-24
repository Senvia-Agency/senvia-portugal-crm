import type { Product } from '@/types/proposals';

export interface OrganizationTaxConfig {
  tax_value?: number | null;
  tax_exemption_reason?: string | null;
}

export type ProductFiscalFields = Pick<
  Product,
  'tax_value' | 'tax_exemption_reason' | 'price_includes_vat' | 'retention_rate'
>;

export const PORTUGUESE_VAT_RATES = [23, 22, 16, 13, 12, 9, 6, 5, 4, 0] as const;

/** Resolve a nullable product rate against the organization default. */
export function effectiveProductTaxRate(
  productTaxRate: number | null | undefined,
  organizationTaxConfig: OrganizationTaxConfig | null | undefined,
): number {
  const candidate = productTaxRate ?? organizationTaxConfig?.tax_value ?? 23;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 23;
}

/** Resolve the exemption code/text without discarding the organization fallback. */
export function effectiveTaxExemptionReason(
  productReason: string | null | undefined,
  organizationTaxConfig: OrganizationTaxConfig | null | undefined,
): string | null {
  const reason = productReason?.trim() || organizationTaxConfig?.tax_exemption_reason?.trim();
  return reason || null;
}

/** Convert a catalog price to the gross amount charged to the customer. */
export function grossUnitPrice(
  price: number,
  product: Pick<Product, 'tax_value' | 'price_includes_vat'>,
  organizationTaxConfig: OrganizationTaxConfig | null | undefined,
): number {
  if (!Number.isFinite(price)) return 0;
  if (product.price_includes_vat) return roundCurrency(price);
  const taxRate = effectiveProductTaxRate(product.tax_value, organizationTaxConfig);
  return roundCurrency(price * (1 + taxRate / 100));
}

/** Net and tax portions of a line whose entered price may already include VAT. */
export function splitLineVat(
  amount: number,
  product: Pick<Product, 'tax_value' | 'price_includes_vat'> | null | undefined,
  organizationTaxConfig: OrganizationTaxConfig | null | undefined,
): { net: number; vat: number; gross: number; taxRate: number } {
  const taxRate = effectiveProductTaxRate(product?.tax_value, organizationTaxConfig);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  if (product?.price_includes_vat) {
    const net = taxRate > 0 ? safeAmount / (1 + taxRate / 100) : safeAmount;
    return { net, vat: safeAmount - net, gross: safeAmount, taxRate };
  }
  const vat = safeAmount * (taxRate / 100);
  return { net: safeAmount, vat, gross: safeAmount + vat, taxRate };
}

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
