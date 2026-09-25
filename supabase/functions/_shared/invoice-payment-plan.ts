type PaymentPlanRow = {
  amount: number | string
  payment_date: string
  status: string
  reversed_amount?: number | string | null
}

function euros(amount: number): string {
  return `${amount.toFixed(2).replace('.', ',')} €`
}

function fiscalDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : date
}

/** Describe only a complete, non-reversed payment schedule. Never imply that
 * an incomplete set of sale payments settles the whole invoice. */
export function invoicePaymentPlan(payments: PaymentPlanRow[], invoiceTotal: number): string {
  if (!payments.length || !Number.isFinite(invoiceTotal) || invoiceTotal <= 0) return ''
  if (payments.some((payment) => Number(payment.reversed_amount || 0) > 0)) return ''
  if (payments.some((payment) => !Number.isFinite(Number(payment.amount)) || Number(payment.amount) <= 0 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(payment.payment_date) || !['paid', 'pending'].includes(payment.status))) return ''

  const totalCents = payments.reduce((sum, payment) => sum + Math.round(Number(payment.amount) * 100), 0)
  if (Math.abs(totalCents - Math.round(invoiceTotal * 100)) > 1) return ''

  const sorted = [...payments].sort((a, b) => a.payment_date.localeCompare(b.payment_date))
  const header = sorted.length === 1 ? 'Condições de pagamento:' : `Pagamento em ${sorted.length} parcelas:`
  const lines = sorted.map((payment, index) => {
    const amount = euros(Number(payment.amount))
    const date = fiscalDate(payment.payment_date)
    const label = sorted.length === 1 ? 'Pagamento' : `${index + 1}.ª parcela`
    return payment.status === 'paid'
      ? `${label}: ${amount} — pago em ${date}`
      : `${label}: ${amount} — a pagar até ${date}`
  })
  // Fiscal providers may print escaped JSON newlines as a literal "n".
  return `${header} ${lines.join('; ')}`
}

export function appendInvoicePaymentPlan(observations: unknown, plan: string): string {
  const notes = typeof observations === 'string' ? observations.trim() : ''
  if (!plan) return notes
  // Old browser bundles already prefilled a schedule in this field.
  if (/Pagamento em \d+ parcelas:|Data de pagamento:|Condições de pagamento:/i.test(notes)) return notes
  return [notes, plan].filter(Boolean).join('\n\n')
}
