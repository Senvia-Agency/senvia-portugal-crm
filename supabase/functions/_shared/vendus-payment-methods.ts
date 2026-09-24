import { VendusError, vendusRequest } from './vendus.ts'

export interface SalePaymentForVendus {
  payment_method: string | null
  amount: number
}

interface VendusPaymentMethod {
  id: number
  type: string
}

const METHOD_TYPES: Record<string, string[]> = {
  mbway: ['MBWAY'],
  transfer: ['TB'],
  transferencia: ['TB'],
  cash: ['NU'],
  card: ['CC', 'CD'],
  credit_card: ['CC'],
  debit_card: ['CD'],
  check: ['CH'],
  cheque: ['CH'],
  other: ['OU'],
}

const METHOD_LABELS: Record<string, string> = {
  mbway: 'MB Way', transfer: 'transferência', transferencia: 'transferência', cash: 'dinheiro', card: 'cartão',
  credit_card: 'cartão de crédito', debit_card: 'cartão de débito',
  check: 'cheque', cheque: 'cheque', other: 'outro',
}

export async function getVendusPaymentMethods(apiKey: string): Promise<VendusPaymentMethod[]> {
  const rows = await vendusRequest<unknown>(apiKey, '/documents/paymentmethods/?per_page=1000')
  if (!Array.isArray(rows) || rows.length >= 1000) {
    throw new VendusError('Não foi possível obter todos os métodos de pagamento da Vendus.', 502, 'payment_methods_unavailable')
  }
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const item = row as Record<string, unknown>
    const id = Number(item.id)
    if (!Number.isSafeInteger(id) || id <= 0 || String(item.status || 'on').toLowerCase() === 'off') return []
    return [{ id, type: String(item.type || '').trim().toUpperCase() }]
  })
}

export function resolveVendusPaymentMethod(
  paymentMethod: string | null,
  methods: VendusPaymentMethod[],
): number {
  const source = String(paymentMethod || '').trim().toLowerCase()
  const types = METHOD_TYPES[source]
  if (!types) {
    throw new VendusError('Indica o método de pagamento na venda antes de emitir na Vendus.', 422, 'missing_payment_method')
  }
  const candidates = methods.filter((method) => types.includes(method.type))
  if (candidates.length === 0) {
    throw new VendusError(`A Vendus não tem um método ativo para ${METHOD_LABELS[source]}. Configura-o na Vendus antes de emitir.`, 422, 'payment_method_unavailable')
  }
  if (candidates.length !== 1) {
    const message = source === 'card' && new Set(candidates.map((candidate) => candidate.type)).size > 1
      ? 'Escolhe cartão de crédito ou cartão de débito no pagamento da venda antes de emitir na Vendus.'
      : `A Vendus devolveu vários métodos ativos para ${METHOD_LABELS[source]}. Não é possível escolher um sem uma correspondência exata.`
    throw new VendusError(message, 422, 'ambiguous_payment_method')
  }
  return candidates[0].id
}

export function allocateVendusPayments(
  payments: SalePaymentForVendus[],
  methods: VendusPaymentMethod[],
  total: number,
): Array<{ id: number; amount: number }> {
  let remainingCents = Math.round(total * 100)
  const allocations = new Map<number, number>()
  for (const payment of payments) {
    if (remainingCents <= 0) break
    const paidCents = Math.round(Number(payment.amount) * 100)
    if (!Number.isSafeInteger(paidCents) || paidCents <= 0) {
      throw new VendusError('A venda contém um pagamento inválido.', 422, 'invalid_payment')
    }
    const id = resolveVendusPaymentMethod(payment.payment_method, methods)
    const allocated = Math.min(paidCents, remainingCents)
    allocations.set(id, (allocations.get(id) || 0) + allocated)
    remainingCents -= allocated
  }
  if (remainingCents !== 0) {
    throw new VendusError('Os pagamentos confirmados não cobrem a fatura-recibo.', 409, 'not_fully_paid')
  }
  return [...allocations].map(([id, cents]) => ({ id, amount: cents / 100 }))
}
