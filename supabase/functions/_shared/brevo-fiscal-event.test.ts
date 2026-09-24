import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { brevoFiscalEventAt, fiscalStatusForBrevoEvent, safeFiscalEventData } from './brevo-fiscal-event.ts'

Deno.test('Brevo fiscal events map spam and unsubscribe safely', () => {
  assertEquals(fiscalStatusForBrevoEvent('delivered'), 'delivered')
  assertEquals(fiscalStatusForBrevoEvent('hard_bounce'), 'bounced')
  assertEquals(fiscalStatusForBrevoEvent('spam'), 'blocked')
  assertEquals(fiscalStatusForBrevoEvent('unsubscribed'), 'suppressed')
  assertEquals(fiscalStatusForBrevoEvent('opened'), null)
})

Deno.test('Brevo fiscal timestamp uses provider event time with deterministic fallback', () => {
  assertEquals(brevoFiscalEventAt({ ts_event: 1_797_000_000 }), '2026-12-11T14:40:00.000Z')
  assertEquals(brevoFiscalEventAt({ date: '2026-09-24 10:15:00' }), '2026-09-24T10:15:00.000Z')
  assertEquals(brevoFiscalEventAt({}, new Date('2026-09-24T12:00:00Z')), '2026-09-24T12:00:00.000Z')
})

Deno.test('fiscal event data excludes recipient and other webhook PII', () => {
  assertEquals(safeFiscalEventData({
    event: 'hard_bounce',
    reason: 'Mailbox\nmissing',
    email: 'client@example.com',
    subject: 'Fatura privada',
  }), { provider: 'brevo', event: 'hard_bounce', reason: 'Mailbox missing' })
})
