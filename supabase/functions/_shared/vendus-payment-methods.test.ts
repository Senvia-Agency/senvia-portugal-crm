import { allocateVendusPayments, resolveVendusPaymentMethod } from './vendus-payment-methods.ts'
import { VendusError } from './vendus.ts'

Deno.test('Vendus FR allocates each sale payment to its own payment method', () => {
  const methods = [{ id: 10, type: 'TB' }, { id: 20, type: 'MBWAY' }]
  const allocated = allocateVendusPayments([
    { payment_method: 'transfer', amount: 40 },
    { payment_method: 'mbway', amount: 60 },
  ], methods, 100)
  if (JSON.stringify(allocated) !== JSON.stringify([{ id: 10, amount: 40 }, { id: 20, amount: 60 }])) {
    throw new Error('Payment allocation did not preserve sale payment methods')
  }
})

Deno.test('Vendus FR caps allocations to the invoice total', () => {
  const allocated = allocateVendusPayments([
    { payment_method: 'cash', amount: 40 },
    { payment_method: 'cash', amount: 61 },
  ], [{ id: 5, type: 'NU' }], 100)
  if (JSON.stringify(allocated) !== JSON.stringify([{ id: 5, amount: 100 }])) {
    throw new Error('Payment allocation exceeded the invoice total')
  }
})

Deno.test('Vendus never guesses an ambiguous card method', () => {
  try {
    resolveVendusPaymentMethod('card', [{ id: 1, type: 'CC' }, { id: 2, type: 'CD' }])
  } catch (error) {
    if (error instanceof VendusError && error.code === 'ambiguous_payment_method') return
    throw error
  }
  throw new Error('Ambiguous card payment was accepted')
})

Deno.test('Vendus recognizes legacy payment values already stored in sales', () => {
  if (resolveVendusPaymentMethod('transferencia', [{ id: 8, type: 'TB' }]) !== 8
    || resolveVendusPaymentMethod('cheque', [{ id: 9, type: 'CH' }]) !== 9) {
    throw new Error('Legacy payment values were not recognized')
  }
})

Deno.test('Vendus card subtype selects the correct fiscal method', () => {
  const methods = [{ id: 1, type: 'CC' }, { id: 2, type: 'CD' }]
  if (resolveVendusPaymentMethod('credit_card', methods) !== 1
    || resolveVendusPaymentMethod('debit_card', methods) !== 2) {
    throw new Error('Card subtype was not mapped to the correct Vendus method')
  }
})

Deno.test('Vendus rejects a paid sale without a payment method', () => {
  try {
    allocateVendusPayments([{ payment_method: null, amount: 25 }], [{ id: 3, type: 'OU' }], 25)
  } catch (error) {
    if (error instanceof VendusError && error.code === 'missing_payment_method') return
    throw error
  }
  throw new Error('A payment without a method was accepted')
})
