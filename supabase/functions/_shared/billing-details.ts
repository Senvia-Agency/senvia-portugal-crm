import type Stripe from "https://esm.sh/stripe@18.5.0";

/** What an organization keeps to be invoiced (organizations.billing_*). */
export interface BillingDetails {
  billing_name: string | null;
  billing_nif: string | null;
  billing_address_line1: string | null;
  billing_address_line2: string | null;
  billing_postal_code: string | null;
  billing_city: string | null;
  billing_country: string;
  billing_email: string | null;
}

export const BILLING_COLUMNS =
  "billing_name, billing_nif, billing_address_line1, billing_address_line2, billing_postal_code, billing_city, billing_country, billing_email, billing_synced_at";

const EU = new Set(["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK"]);

/** Portuguese NIF check digit (mod 11). */
export function validPortugueseNif(nif: string): boolean {
  if (!/^[1-35-9]\d{8}$/.test(nif)) return false;
  const sum = [...nif.slice(0, 8)].reduce((acc, d, i) => acc + Number(d) * (9 - i), 0);
  const check = 11 - (sum % 11);
  return (check >= 10 ? 0 : check) === Number(nif[8]);
}

const clean = (v: unknown, max: number) => {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  return s ? s.slice(0, max) : null;
};

/** Validates what the form sends. Returns the row to save, or the message to show. */
export function parseBillingDetails(input: Record<string, unknown>): { ok: true; value: BillingDetails } | { ok: false; error: string } {
  const country = (clean(input.billing_country, 2) ?? "PT").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return { ok: false, error: "País inválido." };
  // People type the NIF with the country prefix and spaces: keep only the number.
  let nif = typeof input.billing_nif === "string" ? input.billing_nif.toUpperCase().replace(/[\s.-]/g, "") : "";
  if (nif.startsWith(country)) nif = nif.slice(2);
  if (nif && country === "PT" && !validPortugueseNif(nif)) return { ok: false, error: "O NIF não é válido." };
  if (nif && !/^[A-Z0-9]{2,15}$/.test(nif)) return { ok: false, error: "O NIF / VAT não é válido." };
  const email = clean(input.billing_email, 254)?.toLowerCase() ?? null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "O email de faturação não é válido." };
  const postal = clean(input.billing_postal_code, 20);
  if (postal && country === "PT" && !/^\d{4}-\d{3}$/.test(postal)) return { ok: false, error: "O código postal tem de ser 0000-000." };
  return {
    ok: true,
    value: {
      billing_name: clean(input.billing_name, 200),
      billing_nif: nif || null,
      billing_address_line1: clean(input.billing_address_line1, 200),
      billing_address_line2: clean(input.billing_address_line2, 200),
      billing_postal_code: postal,
      billing_city: clean(input.billing_city, 100),
      billing_country: country,
      billing_email: email,
    },
  };
}

/** The Stripe customer fields these details fill. Empty fields are left as Stripe has them. */
export function stripeCustomerFields(d: BillingDetails, fallbackName: string): Stripe.CustomerUpdateParams {
  const fields: Stripe.CustomerUpdateParams = { name: d.billing_name || fallbackName };
  if (d.billing_email) fields.email = d.billing_email;
  if (d.billing_address_line1) {
    fields.address = {
      line1: d.billing_address_line1,
      line2: d.billing_address_line2 ?? "",
      postal_code: d.billing_postal_code ?? "",
      city: d.billing_city ?? "",
      country: d.billing_country,
    };
  }
  return fields;
}

/** Puts the NIF on the Stripe customer as an EU VAT id (PT123456789), replacing an old one. */
export async function syncStripeTaxId(stripe: Stripe, customerId: string, d: BillingDetails): Promise<void> {
  const wanted = d.billing_nif && EU.has(d.billing_country)
    ? `${d.billing_country === "GR" ? "EL" : d.billing_country}${d.billing_nif}` : null;
  const existing = await stripe.customers.listTaxIds(customerId, { limit: 20 });
  for (const tax of existing.data) {
    if (tax.type === "eu_vat" && tax.value !== wanted) await stripe.customers.deleteTaxId(customerId, tax.id);
  }
  if (wanted && !existing.data.some(tax => tax.type === "eu_vat" && tax.value === wanted)) {
    await stripe.customers.createTaxId(customerId, { type: "eu_vat", value: wanted });
  }
}
