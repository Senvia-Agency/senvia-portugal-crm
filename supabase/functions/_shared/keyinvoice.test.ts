import { assertEquals, assertRejects, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  callKeyInvoice,
  documentIdentityFromApi,
  documentIdentityFromRawData,
  KeyInvoiceError,
  lisbonFiscalDate,
  prepareKeyInvoiceSaleLines,
  resolveKeyInvoiceProducts,
  resolveKeyInvoiceApiUrl,
} from './keyinvoice.ts'
import { confirmedPaymentNet } from './keyinvoice-sale-document.ts'

Deno.test('KeyInvoice URL only accepts the official API endpoint', () => {
  assertEquals(resolveKeyInvoiceApiUrl(null), 'https://login.keyinvoice.com/API5.php')
  assertEquals(resolveKeyInvoiceApiUrl('https://login.keyinvoice.com/API5.php'), 'https://login.keyinvoice.com/API5.php')
  for (const url of [
    'http://login.keyinvoice.com/API5.php',
    'https://example.com/API5.php',
    'https://login.keyinvoice.com/other.php',
    'https://login.keyinvoice.com/API5.php?target=internal',
  ]) {
    let failed = false
    try { resolveKeyInvoiceApiUrl(url) } catch { failed = true }
    assertEquals(failed, true)
  }
})

Deno.test('document identity keeps type, series and number distinct', () => {
  const identity = documentIdentityFromApi({ DocType: 4, DocSeries: '2026-A', DocNum: 17, FullDocNumber: 'FT 2026-A/17', ATCUD: 'ABC-17' })
  assertEquals(identity.identityKey, 'keyinvoice:4:2026-A:17')
  assertEquals(identity.fullDocNumber, 'FT 2026-A/17')
  assertEquals(identity.atcud, 'ABC-17')
  assertEquals(documentIdentityFromRawData({ identity }).identityKey, identity.identityKey)
})

Deno.test('Lisbon fiscal date does not use UTC midnight', () => {
  assertEquals(lisbonFiscalDate('2026-01-01T00:30:00Z'), '2026-01-01')
  assertEquals(lisbonFiscalDate('2026-07-01T23:30:00Z'), '2026-07-02')
})

Deno.test('API errors are sanitized and never include API keys', async () => {
  const fetcher = async () => new Response(JSON.stringify({
    Status: 0,
    ErrorMessage: 'Apikey=SECRET rejected for user billing@example.com',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const error = await assertRejects(() => callKeyInvoice(
    'https://login.keyinvoice.com/API5.php',
    { method: 'listProducts' },
    { sid: 'SID' },
    { fetcher: fetcher as typeof fetch },
  ))
  const message = error instanceof Error ? error.message : String(error)
  assertEquals(message.includes('SECRET'), false)
  assertEquals(message.includes('billing@example.com'), false)
})

Deno.test('unsupported KeyInvoice method is blocked before fetch', async () => {
  await assertRejects(() => callKeyInvoice(
    'https://login.keyinvoice.com/API5.php',
    { method: 'arbitraryMethod' },
    { sid: 'SID' },
  ))
})

Deno.test('frozen product mappings do not read or create provider products', async () => {
  let calls = 0
  const resolved = await resolveKeyInvoiceProducts(
    { apiUrl: 'https://login.keyinvoice.com/API5.php', sid: 'SID' },
    [{ providerProductId: 'SKU-EXACT', code: 'SKU', name: 'Serviço', unitPrice: 10, taxValue: 23 }],
    (async () => { calls++; throw new Error('fetch must not run') }) as typeof fetch,
  )
  assertEquals(resolved.get(0), 'SKU-EXACT')
  assertEquals(calls, 0)
})

Deno.test('product create race re-lists and accepts only exact code and tax', async () => {
  let lists = 0
  let inserts = 0
  const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body || '{}'))
    if (request.method === 'listProducts') {
      lists++
      return Response.json({
        Status: 1,
        Data: lists === 1 ? { Products: [] } : { Products: [{ IdProduct: 'SKU-1', TaxValue: 23 }] },
      })
    }
    inserts++
    return Response.json({ Status: 0, ErrorMessage: 'duplicate code' })
  }
  const resolved = await resolveKeyInvoiceProducts(
    { apiUrl: 'https://login.keyinvoice.com/API5.php', sid: 'SID' },
    [{ code: 'SKU-1', name: 'Serviço', unitPrice: 10, taxValue: 23 }],
    fetcher as typeof fetch,
  )
  assertEquals(resolved.get(0), 'SKU-1')
  assertEquals(lists, 2)
  assertEquals(inserts, 1)
})

Deno.test('invalid JSON after a fiscal write is ambiguous and never retryable', async () => {
  const error = await assertRejects(() => callKeyInvoice(
    'https://login.keyinvoice.com/API5.php',
    { method: 'insertDocument' },
    { sid: 'SID' },
    { fetcher: (async () => new Response('not-json', { status: 200 })) as typeof fetch },
  ))
  assertEquals(error instanceof KeyInvoiceError, true)
  if (error instanceof KeyInvoiceError) {
    assertEquals(error.ambiguous, true)
    assertEquals(error.manualReview, true)
    assertEquals(error.retryable, false)
  }
})

Deno.test('FR payment total excludes refunds, chargebacks and unsynchronised reversals', () => {
  assertEquals(confirmedPaymentNet({ status: 'paid', amount: 100, reversal_status: 'none', reversed_amount: 0 }), 100)
  assertEquals(confirmedPaymentNet({ status: 'paid', amount: 100, reversal_status: 'refunded', reversed_amount: 25 }), 75)
  assertEquals(confirmedPaymentNet({ status: 'paid', amount: 100, reversal_status: 'chargeback', reversed_amount: 100 }), 0)
  assertEquals(confirmedPaymentNet({ status: 'paid', amount: 100, reversal_status: 'refund_pending', reversed_amount: 0 }), 0)
  assertEquals(confirmedPaymentNet({ status: 'pending', amount: 100 }), 0)
})

Deno.test('fiscal lines preserve discounts and convert VAT-inclusive prices to net', () => {
  const inclusive = prepareKeyInvoiceSaleLines(
    { subtotal: 123, total_value: 123, discount: 0 },
    [{ name: 'Plano', quantity: 1, unit_price: 123, tax_value: 23, price_includes_vat: true }],
  )
  assertEquals(inclusive.products[0].unitPrice, 100)
  assertEquals((inclusive.fiscalSnapshot.lines as any[])[0].sourceLineTotal, 123)

  const discounted = prepareKeyInvoiceSaleLines(
    { subtotal: 100, total_value: 80, discount: 10 },
    [{ name: 'Plano', quantity: 1, unit_price: 100, tax_value: 23, discount_percent: 10 }],
  )
  assertEquals(discounted.products[0].unitPrice, 80)
  assertEquals((discounted.fiscalSnapshot.lines as any[])[0].allocatedDiscount, 20)
  assertEquals((discounted.fiscalSnapshot.lines as any[])[0].sourceLineTotal, 80)
})

Deno.test('sale item fiscal snapshot overrides product and organization defaults', () => {
  const prepared = prepareKeyInvoiceSaleLines(
    { subtotal: 100, total_value: 100, discount: 0 },
    [{
      name: 'Linha congelada',
      quantity: 1,
      unit_price: 100,
      product_code: 'ITEM-CODE',
      keyinvoice_product_id: 'ITEM-PROVIDER-ID',
      tax_value: 0,
      tax_exemption_reason: 'M01',
      price_includes_vat: false,
      retention_rate: 0,
      product: {
        code: 'PRODUCT-CODE',
        keyinvoice_product_id: 'PRODUCT-PROVIDER-ID',
        tax_value: 23,
        tax_exemption_reason: 'M02',
        price_includes_vat: true,
        retention_rate: 0,
      },
    }],
    { tax_value: 13, tax_exemption_reason: 'M99', prices_include_vat: true },
  )
  const line = (prepared.fiscalSnapshot.lines as any[])[0]
  assertEquals(prepared.products[0].code, 'ITEM-CODE')
  assertEquals(prepared.products[0].providerProductId, 'ITEM-PROVIDER-ID')
  assertEquals(prepared.products[0].taxValue, 0)
  assertEquals(prepared.products[0].taxExemptionReason, 'M01')
  assertEquals(prepared.products[0].unitPrice, 100)
  assertEquals(line.priceIncludesVat, false)
})

Deno.test('retention on a sale item fails closed before automatic issuance', () => {
  const error = assertThrows(() => prepareKeyInvoiceSaleLines(
    { subtotal: 100, total_value: 100, discount: 0 },
    [{
      name: 'Linha com retenção',
      quantity: 1,
      unit_price: 100,
      tax_value: 23,
      retention_rate: 11.5,
      product: { retention_rate: 0 },
    }],
  ))
  assertEquals(error instanceof KeyInvoiceError, true)
  if (error instanceof KeyInvoiceError) assertEquals(error.manualReview, true)
})
