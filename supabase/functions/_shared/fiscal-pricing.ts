export interface TaxConfigLike {
  tax_value?: number | string | null;
}

function safeTaxRate(value: unknown, fallback = 23): number {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return fallback;
  return parsed;
}

/**
 * Final recurring amount sent to Stripe, in cents.
 *
 * Catalog prices may be net or gross. Stripe must always receive the amount
 * that the customer actually pays. A nullable product tax inherits the
 * organization's fiscal rate; an explicit zero remains zero.
 */
export function stripeGrossUnitAmount(input: {
  price: number;
  priceIncludesVat: boolean;
  productTaxValue?: number | null;
  organizationTaxConfig?: TaxConfigLike | null;
}): { unitAmount: number; effectiveTaxRate: number } {
  if (!Number.isFinite(input.price) || input.price <= 0) {
    throw new Error("O produto precisa de um preço positivo");
  }

  const organizationRate = safeTaxRate(input.organizationTaxConfig?.tax_value, 23);
  const effectiveTaxRate = input.productTaxValue == null
    ? organizationRate
    : safeTaxRate(input.productTaxValue, organizationRate);
  const gross = input.priceIncludesVat
    ? input.price
    : input.price * (1 + effectiveTaxRate / 100);

  return { unitAmount: Math.round((gross + Number.EPSILON) * 100), effectiveTaxRate };
}
