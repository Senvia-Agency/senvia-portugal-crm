import {
  assert,
  assertEquals,
} from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  callKeyInvoice,
  findKeyInvoiceDocumentByIdempotency,
  getKeyInvoicePdf,
  issueKeyInvoiceDocument,
  issueKeyInvoiceReceipt,
  resolveKeyInvoiceClient,
  resolveKeyInvoiceProducts,
  sendKeyInvoiceDocumentEmail,
  voidKeyInvoiceDocument,
} from './keyinvoice.ts'

/**
 * Destructive integration test for a KeyInvoice DEMO account.
 *
 * It is ignored unless every opt-in variable below is present. The hostname is
 * checked again here so copying production credentials into the shell cannot
 * accidentally issue certified documents in a live account.
 *
 * Required variables:
 *   RUN_KEYINVOICE_DEMO=1
 *   KEYINVOICE_DEMO_API_KEY=...
 *   KEYINVOICE_DEMO_EMAIL=...
 * Optional:
 *   KEYINVOICE_DEMO_API_URL=https://demo.keyinvoice.com/API5.php
 *   KEYINVOICE_DEMO_SERIES=...
 */

const runDemo = Deno.env.get('RUN_KEYINVOICE_DEMO') === '1'
const apiKey = Deno.env.get('KEYINVOICE_DEMO_API_KEY')?.trim() || ''
const destination = Deno.env.get('KEYINVOICE_DEMO_EMAIL')?.trim() || ''
const apiUrl = Deno.env.get('KEYINVOICE_DEMO_API_URL')?.trim()
  || 'https://demo.keyinvoice.com/API5.php'
const series = Deno.env.get('KEYINVOICE_DEMO_SERIES')?.trim() || null
const enabled = runDemo && !!apiKey && !!destination

Deno.test({
  name: 'KeyInvoice demo: FT, RC parcial/final, FR, anulação/NC, PDF e email',
  ignore: !enabled,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    assertEquals(new URL(apiUrl).hostname, 'demo.keyinvoice.com', 'O ensaio só aceita o host demo.keyinvoice.com')

    const authenticated = await callKeyInvoice(
      apiUrl,
      { method: 'authenticate' },
      { apiKey },
    )
    const sid = authenticated.Sid?.trim() || ''
    assert(sid, 'A conta demo não devolveu SID')
    const session = { apiUrl, sid }

    const nonce = crypto.randomUUID().slice(0, 8)
    const marker = `demo:${new Date().toISOString()}:${nonce}`
    const clientName = `SENVIA Teste Fiscal ${nonce}`
    // NIF genérico de consumidor final. A conta demo deve aceitar este cliente
    // apenas para validar o contrato técnico; não representa uma entidade real.
    const clientId = await resolveKeyInvoiceClient(session, {
      name: clientName,
      vatin: '999999990',
      email: destination,
      country: 'PT',
    })

    const productIds = await resolveKeyInvoiceProducts(session, [{
      code: `SENVIA-DEMO-${nonce}`,
      name: `Serviço demo ${nonce}`,
      unitPrice: 10,
      taxValue: 23,
    }])
    const productId = productIds.get(0)
    assert(productId, 'O produto demo não ficou disponível')

    const invoiceKey = `${marker}:ft`
    const invoice = await issueKeyInvoiceDocument(session, {
      kind: 'invoice',
      lines: [{ productId, quantity: 1, unitPrice: 10 }],
      clientId,
      clientVATIN: '999999990',
      clientName,
      comments: `SENVIA:${invoiceKey}`,
      docSeries: series,
    })
    assert(invoice.docNum)
    assert(invoice.docSeries, 'A FT demo não devolveu a série fiscal')
    assert((await getKeyInvoicePdf(session, invoice)).byteLength > 100)
    assertEquals(
      (await findKeyInvoiceDocumentByIdempotency(session, invoiceKey, { docType: invoice.docType }))?.identityKey,
      invoice.identityKey,
    )

    const partialReceipt = await issueKeyInvoiceReceipt(session, {
      original: invoice,
      amount: 4,
      clientId,
      client: { name: clientName, countryCode: 'PT' },
    })
    assert(partialReceipt.docNum)
    assert((await getKeyInvoicePdf(session, partialReceipt)).byteLength > 100)

    const finalReceipt = await issueKeyInvoiceReceipt(session, {
      original: invoice,
      amount: 8.3,
      clientId,
      client: { name: clientName, countryCode: 'PT' },
    })
    assert(finalReceipt.docNum)
    assert((await getKeyInvoicePdf(session, finalReceipt)).byteLength > 100)

    const frKey = `${marker}:fr`
    const invoiceReceipt = await issueKeyInvoiceDocument(session, {
      kind: 'invoice_receipt',
      lines: [{ productId, quantity: 1, unitPrice: 10 }],
      clientId,
      clientVATIN: '999999990',
      clientName,
      comments: `SENVIA:${frKey}`,
      docSeries: series,
    })
    assert(invoiceReceipt.docNum)
    assert((await getKeyInvoicePdf(session, invoiceReceipt)).byteLength > 100)
    await sendKeyInvoiceDocumentEmail(session, {
      identity: invoiceReceipt,
      email: destination,
      subject: `SENVIA OS — teste fiscal ${nonce}`,
      body: 'Documento criado automaticamente na conta demo para validar PDF e email.',
    })

    const voidKey = `${marker}:void-source`
    const voidSource = await issueKeyInvoiceDocument(session, {
      kind: 'invoice',
      lines: [{ productId, quantity: 1, unitPrice: 10 }],
      clientId,
      clientVATIN: '999999990',
      clientName,
      comments: `SENVIA:${voidKey}`,
      docSeries: series,
    })
    const voided = await voidKeyInvoiceDocument(session, {
      identity: voidSource,
      reason: `Teste automático SENVIA ${nonce}`,
    })
    assert(voided.raw, 'A anulação demo não devolveu confirmação')
    assert(
      voided.generatedDocument?.docNum,
      'O contrato demo não devolveu a identidade da nota de crédito; não ativar NC automática antes de rever a resposta',
    )
    assert((await getKeyInvoicePdf(session, voided.generatedDocument)).byteLength > 100)
  },
})
