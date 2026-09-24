import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  fiscalFailureMode,
  fiscalSnapshotContext,
  renderFiscalTemplate,
  resolveFiscalEmailConfig,
  retryAt,
} from './fiscal-worker.ts'

Deno.test('partial fiscal writes are retried only before the fifth attempt', () => {
  assertEquals(fiscalFailureMode({ retryable: true }, 'invoice', 1), 'retry')
  assertEquals(fiscalFailureMode({ retryable: true }, 'invoice', 5), 'manual_review')
})

Deno.test('ambiguous FT can reconcile but ambiguous RC requires manual review', () => {
  assertEquals(fiscalFailureMode({ ambiguous: true }, 'invoice', 1), 'reconciliation')
  assertEquals(fiscalFailureMode({ ambiguous: true }, 'invoice_receipt', 1), 'reconciliation')
  assertEquals(fiscalFailureMode({ ambiguous: true }, 'receipt', 1), 'manual_review')
})

Deno.test('retry schedule backs off deterministically', () => {
  const now = new Date('2026-09-24T10:00:00.000Z')
  assertEquals(retryAt(1, now), '2026-09-24T10:05:00.000Z')
  assertEquals(retryAt(3, now), '2026-09-24T11:00:00.000Z')
  assertEquals(retryAt(99, now), '2026-09-24T22:00:00.000Z')
})

Deno.test('snapshot parser supports immutable wrapped lines', () => {
  const parsed = fiscalSnapshotContext({
    fiscalDate: '2026-09-24',
    organization: { taxConfig: { tax_value: 23 } },
    items: [{ saleItem: { id: 'i1', name: 'Mensalidade' }, product: { id: 'p1', is_recurring: true } }],
  })
  assertEquals(parsed.fiscalDate, '2026-09-24')
  assertEquals(parsed.items[0].id, 'i1')
  assertEquals(parsed.items[0].product.id, 'p1')
  assertEquals(parsed.taxConfig.tax_value, 23)
})

Deno.test('email config uses the client snapshot and escapes its body', () => {
  const config = resolveFiscalEmailConfig({
    id: 'j1',
    organization_id: 'o1',
    sale_id: 's1',
    recurring_cycle_id: 'c1',
    document_type: 'invoice',
    fiscal_idempotency_key: 'key',
    fiscal_snapshot: {
      client: { name: 'Cliente <Teste>', email: 'cliente@example.com' },
      email: {
        config: {
          recipient_mode: 'client',
          subject_template: '{{document_type}} {{document_number}}',
          body_template: 'Olá {{client_name}}',
        },
      },
    },
  }, { id: 'o1', name: 'Empresa', brevo_sender_email: 'faturas@example.com' }, {
    provider: 'keyinvoice',
    docType: '4',
    docSeries: '2026',
    docNum: '7',
    fullDocNumber: 'FT 2026/7',
    atcud: 'ABC-7',
    identityKey: 'keyinvoice:4:2026:7',
  })

  assertEquals(config.to, 'cliente@example.com')
  assertEquals(config.subject, 'Fatura FT 2026/7')
  assertStringIncludes(config.html, 'Cliente &lt;Teste&gt;')
  assertEquals(config.idempotencyKey, 'j1')
})

Deno.test('unknown template variables remain visible instead of disappearing', () => {
  assertEquals(renderFiscalTemplate('{{document_type}} {{unknown}}', { document_type: 'Fatura' }), 'Fatura {{unknown}}')
})
