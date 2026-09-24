import { assertEquals, assertThrows } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { stripeGrossUnitAmount } from "./fiscal-pricing.ts";

Deno.test("Stripe keeps a VAT-inclusive catalog price", () => {
  assertEquals(stripeGrossUnitAmount({
    price: 49,
    priceIncludesVat: true,
    productTaxValue: 23,
  }), { unitAmount: 4900, effectiveTaxRate: 23 });
});

Deno.test("Stripe adds the product VAT to a net catalog price", () => {
  assertEquals(stripeGrossUnitAmount({
    price: 49,
    priceIncludesVat: false,
    productTaxValue: 23,
  }), { unitAmount: 6027, effectiveTaxRate: 23 });
});

Deno.test("nullable product VAT inherits organization tax config", () => {
  assertEquals(stripeGrossUnitAmount({
    price: 100,
    priceIncludesVat: false,
    productTaxValue: null,
    organizationTaxConfig: { tax_value: 13 },
  }), { unitAmount: 11300, effectiveTaxRate: 13 });
});

Deno.test("explicit VAT exemption is not replaced by organization VAT", () => {
  assertEquals(stripeGrossUnitAmount({
    price: 100,
    priceIncludesVat: false,
    productTaxValue: 0,
    organizationTaxConfig: { tax_value: 23 },
  }), { unitAmount: 10000, effectiveTaxRate: 0 });
});

Deno.test("half-cent VAT rounds identically to the frontend currency rule", () => {
  assertEquals(stripeGrossUnitAmount({
    price: 0.5,
    priceIncludesVat: false,
    productTaxValue: 13,
  }), { unitAmount: 57, effectiveTaxRate: 13 });
});

Deno.test("invalid prices cannot create a Stripe Price", () => {
  assertThrows(() => stripeGrossUnitAmount({ price: 0, priceIncludesVat: false }));
});
