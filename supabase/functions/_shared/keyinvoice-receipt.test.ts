import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { documentIdentityFromApi, issueKeyInvoiceReceipt, KeyInvoiceError } from './keyinvoice.ts'

Deno.test('automatic receipt resolves the fiscal client before settling the invoice', async () => {
  const methods: string[] = []
  const client = { name: 'Fiscal client', vatin: '999999990', countryCode: 'PT' }
  const original = documentIdentityFromApi({ DocType: 4, DocSeries: '23', DocNum: 5 })
  const identity = await issueKeyInvoiceReceipt(
    { apiUrl: 'https://login.keyinvoice.com/API5.php', sid: 'TEST' },
    { original, amount: 50, client },
    async (_url, init) => {
      const payload = JSON.parse(String(init?.body))
      methods.push(payload.method)
      if (payload.method === 'listClients') {
        return Response.json({ Status: 1, Data: [{ IdClient: 'CLIENT-7', VATIN: '999999990' }] })
      }
      assertEquals(payload.IdClient, 'CLIENT-7')
      assertEquals(payload.DocLines, [{ DocType: '4', DocSeries: '23', DocNum: '5', SettleValue: '50.00' }])
      return Response.json({ Status: 1, Data: { DocType: 9, DocSeries: '23', DocNum: 2 } })
    },
  )
  assertEquals(methods, ['listClients', 'insertReceipt'])
  assertEquals(identity.docNum, '2')
})

Deno.test('receipt without a provider client or VATIN stops before any fiscal request', async () => {
  let calls = 0
  await assertRejects(() => issueKeyInvoiceReceipt(
    { apiUrl: 'https://login.keyinvoice.com/API5.php', sid: 'TEST' },
    { original: documentIdentityFromApi({ DocType: 4, DocNum: 5 }), amount: 50, client: { name: 'Fiscal client' } },
    async () => { calls++; return Response.json({ Status: 1, Data: { DocType: 9, DocNum: 2 } }) },
  ), KeyInvoiceError)
  assertEquals(calls, 0)
})
