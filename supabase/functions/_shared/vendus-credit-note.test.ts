import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { fullCreditItems } from './vendus-credit-note.ts'
import { VendusError } from './vendus.ts'

Deno.test('full Vendus credit note retains original row, amount and M10 exemption', () => {
  assertEquals(fullCreditItems({ number: 'FT 1/24', items: [{
    id: 42, qty: 2, qty_nc: 2, amounts: { gross_total: 100 },
    tax: { id: 'ISE', exemption: 'M10' },
  }] }), [{
    id: 42, qty: 2, gross_price: 50, tax_id: 'ISE', tax_exemption: 'M10',
    reference_document: { document_number: 'FT 1/24', document_row: 1 },
  }])
})

Deno.test('already credited line cannot be credited again', () => {
  const error = assertThrows(() => fullCreditItems({ number: 'FT 1/24', items: [{
    id: 42, qty: 2, qty_nc: 0, amounts: { gross_total: 100 },
    tax: { id: 'ISE', exemption: 'M10' },
  }] }))
  assertEquals(error instanceof VendusError && error.code, 'original_line_not_creditable')
})
