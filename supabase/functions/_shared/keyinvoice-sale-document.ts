import {
  documentNumberAsInteger,
  getKeyInvoicePdf,
  getKeyInvoiceSession,
  identityRawData,
  issueKeyInvoiceDocument,
  KEYINVOICE_ISSUE_DOC_TYPES,
  KeyInvoiceError,
  KeyInvoiceOrganization,
  KeyInvoiceProductInput,
  prepareKeyInvoiceSaleLines,
  resolveKeyInvoiceClient,
  resolveKeyInvoiceProducts,
  safeKeyInvoiceError,
} from './keyinvoice.ts'
import { saleBillingRecipient } from './sale-billing-recipient.ts'

export interface IssueSaleDocumentInput {
  organizationId: string
  saleId: string
  kind?: 'invoice' | 'invoice_receipt'
  observations?: string | null
  recurringCycleId?: string | null
  idempotencyKey?: string | null
  requestEmail?: boolean
}

function documentType(kind: 'invoice' | 'invoice_receipt'): 'invoice' | 'invoice_receipt' {
  return kind
}

function filePart(value: string | null): string {
  return (value || 'default').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)
}

function canonicalSnapshot(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
      : item,
  ) ?? ''
}

/** A cancelled fiscal document remains in the ledger. Reissue is possible only
 * after its provider credit note has been persisted with the exact origin ID. */
async function verifiedVoidedPredecessor(db: any, input: IssueSaleDocumentInput): Promise<string | null> {
  if (input.recurringCycleId) return null
  const { data: prior, error: priorError } = await db.from('invoices')
    .select('id,processing_status')
    .eq('organization_id', input.organizationId)
    .eq('sale_id', input.saleId)
    .eq('provider', 'keyinvoice')
    .in('document_type', ['invoice', 'invoice_receipt'])
    .in('status', ['canceled', 'cancelled'])
    .is('recurring_cycle_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (priorError) throw new KeyInvoiceError('Não foi possível verificar a anulação anterior', {
    code: 'prior_void_lookup_failed', httpStatus: 500, retryable: true,
  })
  if (!prior) return null
  if (prior.processing_status !== 'void') throw new KeyInvoiceError(
    'A anulação anterior ainda não está reconciliada. Confirme o estado no KeyInvoice antes de emitir outra fatura.',
    { code: 'prior_void_unconfirmed', httpStatus: 409, manualReview: true },
  )
  const { data: credit, error: creditError } = await db.from('invoices')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('provider', 'keyinvoice')
    .eq('related_invoice_id', prior.id)
    .eq('document_type', 'credit_note')
    .eq('status', 'final')
    .eq('processing_status', 'issued')
    .limit(1)
    .maybeSingle()
  if (creditError) throw new KeyInvoiceError('Não foi possível verificar a nota de crédito', {
    code: 'prior_credit_lookup_failed', httpStatus: 500, retryable: true,
  })
  if (!credit) throw new KeyInvoiceError(
    'A fatura anterior foi anulada, mas a nota de crédito ainda não está confirmada. Não repita a emissão.',
    { code: 'prior_credit_unconfirmed', httpStatus: 409, manualReview: true },
  )
  return prior.id
}

export function confirmedPaymentNet(payment: Record<string, unknown>): number {
  if (payment.status !== 'paid') return 0
  const amount = Number(payment.amount || 0)
  const reversalStatus = String(payment.reversal_status ?? payment.reversalStatus ?? 'none').trim().toLowerCase()
  const reversed = Number(
    payment.reversed_amount ?? payment.refunded_amount ?? payment.chargeback_amount ?? 0,
  )
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(reversed) || reversed < 0) return 0
  // Fail closed when a provider says the payment is reversed/refunded but the
  // amount has not been synchronized yet. This must never make an FR eligible.
  if (reversalStatus !== '' && reversalStatus !== 'none' && reversed <= 0) return 0
  return Math.max(0, amount - reversed)
}

export interface PreparedKeyInvoiceSaleDocument {
  sale: any
  payments: any[]
  kind: 'invoice' | 'invoice_receipt'
  expectedTotal: number
  paidTotal: number
  fullyPaid: boolean
  clientName: string
  clientNif: string
  fiscalDate: string
  fiscalSnapshot: Record<string, unknown>
  session: Awaited<ReturnType<typeof getKeyInvoiceSession>>
  providerClientId: string | null
  lines: Array<{ productId: string; quantity: number; unitPrice: number }>
  docSeries: string | null
  docTypeCode: string
  idempotencyKey: string
  comments: string
}

/** Prepare an already-created durable job only from its immutable snapshot. */
export async function prepareKeyInvoiceSnapshotContext(
  db: any,
  org: KeyInvoiceOrganization & {
    tax_config?: Record<string, any> | null
    keyinvoice_series_config?: Record<string, any> | null
  },
  job: Record<string, any>,
): Promise<PreparedKeyInvoiceSaleDocument> {
  if (job.provider && job.provider !== 'keyinvoice') {
    throw new KeyInvoiceError('O trabalho fiscal não pertence ao KeyInvoice', { code: 'wrong_provider', httpStatus: 400 })
  }
  const kind = job.document_type as 'invoice' | 'invoice_receipt'
  if (kind !== 'invoice' && kind !== 'invoice_receipt') {
    throw new KeyInvoiceError('Tipo de documento não suportado para emissão automática', {
      code: 'unsupported_document_kind',
      httpStatus: 422,
      manualReview: true,
    })
  }
  const expectedDocTypeCode = KEYINVOICE_ISSUE_DOC_TYPES[kind]
  const frozenDocTypeCode = String(job.provider_document_type_code || '').trim()
  const frozenSeries = String(job.provider_series || '').trim()
  if (!frozenSeries || frozenDocTypeCode !== expectedDocTypeCode) {
    throw new KeyInvoiceError('O trabalho fiscal não tem uma série e tipo de documento KeyInvoice validados', {
      code: 'invalid_frozen_series_configuration',
      httpStatus: 422,
      manualReview: true,
    })
  }
  const snapshot = job.fiscal_snapshot
  if (!snapshot || typeof snapshot !== 'object') {
    throw new KeyInvoiceError('O trabalho fiscal não tem snapshot imutável', {
      code: 'missing_fiscal_snapshot',
      httpStatus: 422,
      manualReview: true,
    })
  }
  const rawLines = Array.isArray(snapshot.lines) ? snapshot.lines : Array.isArray(snapshot.items) ? snapshot.items : []
  if (rawLines.length === 0) {
    throw new KeyInvoiceError('O snapshot fiscal não tem linhas', { code: 'empty_fiscal_snapshot', httpStatus: 422, manualReview: true })
  }
  if (Number(org.tax_config?.tax_value) === 0 && org.tax_config?.tax_value != null
    && rawLines.some((line: Record<string, any>) => Number(line.taxRate ?? line.taxValue ?? line.tax_value ?? 0) !== 0
      || (line.taxExemptionReason ?? line.tax_exemption_reason ?? null) !== org.tax_config?.tax_exemption_reason)) {
    throw new KeyInvoiceError('A configuração fiscal da organização mudou. Reveja o trabalho antes de emitir.', {
      code: 'organization_exemption_snapshot_mismatch', httpStatus: 422, manualReview: true,
    })
  }
  const retention = Number(snapshot.retentionRate ?? snapshot.retention_rate ?? snapshot.retention ?? 0)
  if (Number.isFinite(retention) && retention > 0) {
    throw new KeyInvoiceError('A emissão automática com retenção requer validação na conta demo', {
      code: 'retention_contract_unverified',
      httpStatus: 422,
      manualReview: true,
    })
  }
  const expectedTotal = Number(job.total ?? snapshot.total ?? snapshot.sale?.total)
  if (!Number.isFinite(expectedTotal) || expectedTotal <= 0) {
    throw new KeyInvoiceError('O trabalho fiscal não tem total válido', { code: 'invalid_job_total', httpStatus: 422, manualReview: true })
  }
  let frozenTotal = 0
  const products: Array<KeyInvoiceProductInput & { quantity: number }> = rawLines.map((line: Record<string, any>) => {
    const quantity = Number(line.quantity)
    const taxValue = Number(line.taxRate ?? line.taxValue ?? line.tax_value ?? 0)
    const unitPrice = Number(line.billedUnitPrice ?? line.unit_price ?? line.unitPrice)
    const sourceLineTotal = Number(line.sourceLineTotal ?? line.source_line_total)
    const lineRetention = Number(line.retentionRate ?? line.retention_rate ?? 0)
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(taxValue) || taxValue < 0) {
      throw new KeyInvoiceError('O snapshot fiscal contém uma linha inválida', { code: 'invalid_snapshot_line', httpStatus: 422, manualReview: true })
    }
    if (!Number.isFinite(sourceLineTotal) || sourceLineTotal < 0) {
      throw new KeyInvoiceError('O snapshot fiscal não preserva o total original de uma linha', {
        code: 'missing_source_line_total',
        httpStatus: 422,
        manualReview: true,
      })
    }
    if (lineRetention > 0) {
      throw new KeyInvoiceError('A emissão automática com retenção por linha requer validação na conta demo', {
        code: 'retention_contract_unverified',
        httpStatus: 422,
        manualReview: true,
      })
    }
    frozenTotal += sourceLineTotal
    return {
      localId: line.localProductId ?? line.product_id ?? null,
      providerProductId: line.providerProductId ?? line.provider_product_id ?? null,
      code: line.code ?? line.productCode ?? line.product_code ?? null,
      name: String(line.description ?? line.name ?? 'Serviço'),
      unitPrice,
      taxValue,
      taxExemptionReason: line.taxExemptionReason ?? line.tax_exemption_reason ?? null,
      quantity,
    }
  })
  if (Math.abs(Math.round(frozenTotal * 100) / 100 - Math.round(expectedTotal * 100) / 100) > 0.01) {
    throw new KeyInvoiceError('A soma do snapshot fiscal não coincide com o total do trabalho', {
      code: 'snapshot_total_mismatch',
      httpStatus: 422,
      manualReview: true,
    })
  }
  const client = snapshot.client || {}
  const clientName = String(client.name || '').trim()
  const clientNif = String(client.vatin ?? client.nif ?? '').trim()
  if (!clientName || !clientNif) {
    throw new KeyInvoiceError('O snapshot fiscal não tem nome e NIF do cliente', {
      code: 'missing_snapshot_client',
      httpStatus: 422,
      manualReview: true,
    })
  }
  const session = await getKeyInvoiceSession(db, org, String(job.organization_id))
  const providerClientId = await resolveKeyInvoiceClient(session, {
    name: clientName,
    vatin: clientNif,
    email: client.email,
    phone: client.phone,
    address: client.address,
    locality: client.locality,
    postalCode: client.postalCode ?? client.postal_code,
    country: client.countryCode ?? client.country_code,
  })
  const providerProducts = await resolveKeyInvoiceProducts(session, products)
  const lines = products.map((product, index) => ({
    productId: providerProducts.get(index) || '',
    quantity: product.quantity,
    unitPrice: product.unitPrice,
  }))
  const docSeries = frozenSeries
  const idempotencyKey = String(job.fiscal_idempotency_key || '').trim()
  if (!idempotencyKey) {
    throw new KeyInvoiceError('O trabalho fiscal não tem chave de idempotência', {
      code: 'missing_idempotency_key',
      httpStatus: 422,
      manualReview: true,
    })
  }
  return {
    sale: snapshot.sale || { id: job.sale_id },
    payments: [],
    kind,
    expectedTotal,
    paidTotal: Number(snapshot.payment?.paidTotal ?? snapshot.payment?.paid_total ?? 0),
    fullyPaid: kind === 'invoice_receipt',
    clientName,
    clientNif,
    fiscalDate: String(snapshot.fiscalDate ?? snapshot.fiscal_date ?? job.date),
    fiscalSnapshot: snapshot,
    session,
    providerClientId,
    lines,
    docSeries,
    docTypeCode: expectedDocTypeCode,
    idempotencyKey,
    comments: '',
  }
}

/**
 * Prepare a durable job for emission without writing another ledger row.
 * Workers can call this, issueKeyInvoiceDocument, then complete their claimed
 * invoice row through the database RPC.
 */
export async function prepareKeyInvoiceSaleDocumentContext(
  db: any,
  org: KeyInvoiceOrganization & {
    tax_config?: Record<string, any> | null
    keyinvoice_series_config?: Record<string, any> | null
  },
  input: IssueSaleDocumentInput,
): Promise<PreparedKeyInvoiceSaleDocument> {
  const { data: sale, error: saleError } = await db
    .from('sales')
    .select('*, client:crm_clients(*), lead:leads(name,email,phone)')
    .eq('id', input.saleId)
    .eq('organization_id', input.organizationId)
    .single()
  if (saleError || !sale) throw new KeyInvoiceError('Venda não encontrada', { code: 'sale_not_found', httpStatus: 404 })
  const voidedPredecessorId = await verifiedVoidedPredecessor(db, input)

  const { data: payments, error: paymentsError } = await db
    .from('sale_payments')
    .select('*')
    .eq('sale_id', input.saleId)
    .eq('organization_id', input.organizationId)
  if (paymentsError) throw new KeyInvoiceError('Não foi possível validar os pagamentos da venda', { code: 'payment_lookup_failed', httpStatus: 500, retryable: true })
  const scopedPayments = input.recurringCycleId
    ? (payments || []).filter((payment: any) => payment.recurring_cycle_id === input.recurringCycleId)
    : (payments || [])
  const paidTotal = scopedPayments.reduce((sum: number, payment: any) => sum + confirmedPaymentNet(payment), 0)
  let cycle: any = null
  let recurrence: any = null
  if (input.recurringCycleId) {
    const { data, error } = await db
      .from('sale_recurring_cycles')
      .select('id,recurrence_id,sale_id,organization_id,amount,currency,status,paid_at,period_start,period_end,due_date')
      .eq('id', input.recurringCycleId)
      .eq('sale_id', input.saleId)
      .eq('organization_id', input.organizationId)
      .single()
    if (error || !data) throw new KeyInvoiceError('Ciclo recorrente não encontrado', { code: 'recurring_cycle_not_found', httpStatus: 404 })
    cycle = data
    const { data: recurrenceData, error: recurrenceError } = await db
      .from('sale_recurrences')
      .select('id,sale_id,organization_id,amount,currency,interval,interval_count')
      .eq('id', cycle.recurrence_id)
      .eq('sale_id', input.saleId)
      .eq('organization_id', input.organizationId)
      .single()
    if (recurrenceError || !recurrenceData) {
      throw new KeyInvoiceError('Configuração da recorrência não encontrada', { code: 'recurrence_not_found', httpStatus: 404 })
    }
    recurrence = recurrenceData
  }
  let expectedTotal = input.recurringCycleId
    ? Number(cycle.amount || 0)
    : Number(sale.gross_value ?? sale.total_value ?? 0)
  let fullyPaid = false
  let kind: 'invoice' | 'invoice_receipt' = input.kind || 'invoice'

  const client = sale.client || null
  const recipient = saleBillingRecipient(sale)
  const { name: clientName, nif: clientNif } = recipient
  if (!clientName || !clientNif) {
    throw new KeyInvoiceError('Adicione o nome e NIF do destinatário selecionado na venda antes de emitir o documento', {
      code: 'missing_client_tax_identity',
      httpStatus: 400,
    })
  }
  if (recipient.target === 'company' && (!recipient.address || !recipient.city || !recipient.postalCode || !recipient.country)) {
    throw new KeyInvoiceError('Preencha a morada escolhida para a empresa na ficha do cliente antes de emitir.', {
      code: 'missing_company_address', httpStatus: 400,
    })
  }
  const { data: saleItems, error: itemsError } = await db
    .from('sale_items')
    .select('*, product:products(*)')
    .eq('sale_id', input.saleId)
  if (itemsError) throw new KeyInvoiceError('Não foi possível carregar os produtos da venda', { code: 'sale_items_failed', httpStatus: 500, retryable: true })
  let fiscalItems = saleItems || []
  let fiscalSale = sale
  if (input.recurringCycleId) {
    fiscalItems = (saleItems || []).filter((item: any) => item.product?.is_recurring === true)
    if (fiscalItems.length === 0) {
      // Legacy recurring sales may not have product rows. A synthetic line is
      // safer than accidentally billing one-time products from the sale.
      const syntheticName = `Renovação recorrente${sale.code ? ` — ${sale.code}` : ''}`
      const syntheticCode = `SENVIA-REC-${String(recurrence?.id || input.recurringCycleId).slice(0, 8)}`
      fiscalItems = [{
        id: null,
        product_id: null,
        name: syntheticName,
        quantity: 1,
        unit_price: expectedTotal,
        total: expectedTotal,
        discount_percent: 0,
        tax_value: org.tax_config?.tax_value ?? 0,
        tax_exemption_reason: org.tax_config?.tax_exemption_reason ?? null,
        price_includes_vat: true,
        product: {
          id: null,
          code: syntheticCode,
          name: syntheticName,
          tax_value: org.tax_config?.tax_value ?? 0,
          tax_exemption_reason: org.tax_config?.tax_exemption_reason ?? null,
        },
      }]
      fiscalSale = {
        ...sale,
        code: `${sale.code || sale.id}-REC`,
        subtotal: expectedTotal,
        total_value: expectedTotal,
        discount: 0,
      }
    } else {
      const recurringNetSource = fiscalItems.reduce(
        (sum: number, item: any) => sum
          + Number(item.quantity || 0) * Number(item.unit_price || 0)
          * (1 - Number(item.discount_percent || 0) / 100),
        0,
      )
      if (!Number.isFinite(recurringNetSource) || recurringNetSource <= 0 || !Number.isFinite(expectedTotal) || expectedTotal <= 0) {
        throw new KeyInvoiceError('Os produtos recorrentes não perfazem o valor congelado do ciclo', {
          code: 'cycle_products_total_mismatch',
          httpStatus: 422,
          manualReview: true,
        })
      }
      const scale = expectedTotal / recurringNetSource
      fiscalItems = fiscalItems.map((item: any) => ({
        ...item,
        unit_price: Number(item.unit_price || 0) * scale,
        // cycle.amount is the charged gross amount; KeyInvoice receives the
        // corresponding net unit value after prepareKeyInvoiceSaleLines.
        price_includes_vat: true,
      }))
      const recurringSubtotal = fiscalItems.reduce(
        (sum: number, item: any) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0),
        0,
      )
      fiscalSale = {
        ...sale,
        subtotal: recurringSubtotal,
        total_value: expectedTotal,
        discount: 0,
      }
    }
  }
  const prepared = prepareKeyInvoiceSaleLines(fiscalSale, fiscalItems, org.tax_config || {})
  const fiscalGrossTotal = Math.round(prepared.products.reduce((sum, product, index) => {
    const net = product.unitPrice * Number(prepared.quantities[index] || 0)
    return sum + net * (1 + product.taxValue / 100)
  }, 0) * 100) / 100
  if (!Number.isFinite(fiscalGrossTotal) || fiscalGrossTotal <= 0) {
    throw new KeyInvoiceError('O total fiscal calculado não é válido', {
      code: 'invalid_fiscal_total',
      httpStatus: 422,
      manualReview: true,
    })
  }
  if (input.recurringCycleId) {
    if (Math.abs(fiscalGrossTotal - expectedTotal) > 0.01) {
      throw new KeyInvoiceError('O valor bruto das linhas fiscais não coincide com o valor do ciclo recorrente', {
        code: 'cycle_gross_total_mismatch',
        httpStatus: 422,
        manualReview: true,
      })
    }
  } else if (Math.abs(fiscalGrossTotal - expectedTotal) > 0.01) {
    throw new KeyInvoiceError('O valor bruto das linhas fiscais não coincide com o total cobrado na venda', {
      code: 'sale_gross_total_mismatch',
      httpStatus: 422,
      manualReview: true,
    })
  }
  fullyPaid = expectedTotal > 0
    && paidTotal + 0.005 >= expectedTotal
    && (input.recurringCycleId ? cycle.status === 'paid' : sale.payment_status === 'paid')
  kind = input.kind || (fullyPaid ? 'invoice_receipt' : 'invoice')
  if (kind === 'invoice_receipt' && !fullyPaid) {
    throw new KeyInvoiceError('A Fatura-Recibo só pode ser emitida após pagamento integral confirmado', {
      code: 'sale_not_fully_paid',
      httpStatus: 409,
    })
  }
  if (kind === 'invoice_receipt') {
    const existingInvoice = await findExisting(db, input, 'invoice')
    if (existingInvoice?.status === 'final' || existingInvoice?.processing_status === 'issued') {
      throw new KeyInvoiceError('Esta venda já tem Fatura. Emita um Recibo para o pagamento confirmado.', {
        code: 'invoice_requires_receipt',
        httpStatus: 409,
      })
    }
  }
  if (input.recurringCycleId) {
    ;(prepared.fiscalSnapshot as Record<string, any>).grossTotal = fiscalGrossTotal
  }
  const fiscalSnapshot = {
    ...prepared.fiscalSnapshot,
    grossTotal: fiscalGrossTotal,
    sale: {
      id: sale.id,
      code: sale.code,
      total: expectedTotal,
      recurringCycleId: input.recurringCycleId || null,
      recurrenceId: recurrence?.id || null,
      recurrenceAmount: recurrence?.amount ?? null,
      cyclePeriodStart: cycle?.period_start || null,
      cyclePeriodEnd: cycle?.period_end || null,
    },
    client: {
      id: client?.id || null,
      name: clientName,
      vatin: clientNif,
      email: client?.email || sale.lead?.email || null,
      address: recipient.address || null,
      locality: recipient.city || null,
      postalCode: recipient.postalCode || null,
      countryCode: recipient.country || 'PT',
    },
    payment: {
      expectedTotal,
      paidTotal,
      fullyPaid,
      paymentIds: scopedPayments.filter((payment: any) => confirmedPaymentNet(payment) > 0).map((payment: any) => payment.id),
      cycleStatus: cycle?.status || null,
    },
  }
  const seriesConfig = org.keyinvoice_series_config || (org.tax_config as any)?.keyinvoice_series || {}
  const kindConfig = kind === 'invoice'
    ? seriesConfig.invoice || seriesConfig.ft
    : seriesConfig.invoice_receipt || seriesConfig.fr
  const configuredSeries = typeof kindConfig === 'object' ? String(kindConfig?.series || '').trim() : ''
  const configuredDocTypeCode = typeof kindConfig === 'object'
    ? String(kindConfig?.provider_document_type_code || '').trim()
    : ''
  const expectedDocTypeCode = KEYINVOICE_ISSUE_DOC_TYPES[kind]
  if ((configuredSeries && configuredDocTypeCode !== expectedDocTypeCode)
    || (!configuredSeries && configuredDocTypeCode)) {
    throw new KeyInvoiceError('A série KeyInvoice configurada não corresponde ao tipo de documento', {
      code: 'invalid_series_configuration',
      httpStatus: 422,
      manualReview: true,
    })
  }
  const session = await getKeyInvoiceSession(db, org, input.organizationId)
  const providerClientId = await resolveKeyInvoiceClient(session, {
    name: clientName,
    vatin: clientNif,
    email: client?.email || sale.lead?.email || null,
    phone: client?.phone || sale.lead?.phone || null,
    address: recipient.address || null,
    locality: recipient.city || null,
    postalCode: recipient.postalCode || null,
    country: recipient.country || 'PT',
  })
  const productIds = await resolveKeyInvoiceProducts(session, prepared.products)
  const lines = prepared.products.map((product, index) => ({
    productId: productIds.get(index) || '',
    quantity: prepared.quantities[index],
    unitPrice: product.unitPrice,
  }))
  const idempotencyKey = input.idempotencyKey || (voidedPredecessorId
    ? `manual:${input.saleId}:after-void:${voidedPredecessorId}:${kind}`
    : `manual:${input.saleId}:${input.recurringCycleId || 'sale'}:${kind}`)
  // Comments are printed on the customer's fiscal document. Keep the
  // idempotency key exclusively in the Senvia fiscal ledger.
  const comments = input.observations?.trim() || ''
  return {
    sale,
    payments: scopedPayments,
    kind,
    expectedTotal,
    paidTotal,
    fullyPaid,
    clientName,
    clientNif,
    fiscalDate: prepared.fiscalDate,
    fiscalSnapshot,
    session,
    providerClientId,
    lines,
    docSeries: configuredSeries || null,
    docTypeCode: expectedDocTypeCode,
    idempotencyKey,
    comments,
  }
}

async function findExisting(db: any, input: IssueSaleDocumentInput, kind?: string): Promise<any | null> {
  let query = db
    .from('invoices')
    .select('*')
    .eq('organization_id', input.organizationId)
    .eq('provider', 'keyinvoice')
  if (input.idempotencyKey) query = query.eq('fiscal_idempotency_key', input.idempotencyKey)
  else {
    query = query.eq('sale_id', input.saleId)
      .not('processing_status', 'in', '(void,cancelled)')
    if (input.recurringCycleId) query = query.eq('recurring_cycle_id', input.recurringCycleId)
    else query = query.is('recurring_cycle_id', null)
    if (kind) query = query.eq('document_type', kind)
  }
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new KeyInvoiceError('Não foi possível verificar documentos já emitidos', { code: 'invoice_lookup_failed', httpStatus: 500, retryable: true })
  return data || null
}

export async function issueKeyInvoiceSaleDocument(
  db: any,
  org: KeyInvoiceOrganization & {
    tax_config?: Record<string, any> | null
    keyinvoice_series_config?: Record<string, any> | null
  },
  input: IssueSaleDocumentInput,
): Promise<{
  invoice: any
  identity: ReturnType<typeof identityFromResult>
  alreadyIssued: boolean
}> {
  if (input.idempotencyKey) {
    const existing = await findExisting(db, input)
    if (existing?.processing_status === 'issued' || existing?.status === 'final') {
      return { invoice: existing, identity: identityFromResult(existing), alreadyIssued: true }
    }
  }

  const context = await prepareKeyInvoiceSaleDocumentContext(db, org, input)
  const {
    sale,
    kind,
    expectedTotal,
    clientName,
    clientNif,
    fiscalSnapshot,
    session,
    lines,
  } = context
  const duplicate = await findExisting(db, input, documentType(kind))
  if (duplicate?.processing_status === 'issued' || duplicate?.status === 'final') {
    return { invoice: duplicate, identity: identityFromResult(duplicate), alreadyIssued: true }
  }
  const rejectedAttempt = duplicate?.processing_status === 'failed'
    && /^provider_(?:rejected|[A-Za-z0-9_-]+)$/.test(String(duplicate.processing_last_error || ''))
    && !duplicate.provider_document_number
    && !duplicate.reference
  if (duplicate && !rejectedAttempt) {
    throw new KeyInvoiceError('Já existe uma emissão em curso ou por reconciliar para esta venda', {
      code: 'fiscal_operation_in_progress',
      httpStatus: 409,
      manualReview: duplicate.processing_status === 'manual_review' || duplicate.processing_status === 'reconciliation_required',
    })
  }

  if (rejectedAttempt && (
    duplicate.fiscal_idempotency_key !== context.idempotencyKey
    || duplicate.date !== context.fiscalDate
    || Number(duplicate.total) !== expectedTotal
    || duplicate.provider_document_type_code !== context.docTypeCode
    || String(duplicate.provider_series || '') !== String(context.docSeries || '')
    || canonicalSnapshot(duplicate.fiscal_snapshot) !== canonicalSnapshot(fiscalSnapshot)
  )) {
    throw new KeyInvoiceError('Os dados fiscais mudaram após a tentativa rejeitada. Reveja a emissão antes de repetir.', {
      code: 'rejected_attempt_snapshot_changed',
      httpStatus: 409,
      manualReview: true,
    })
  }

  const startedAt = new Date().toISOString()
  const claimToken = crypto.randomUUID()
  const pendingRow: Record<string, unknown> = {
    organization_id: input.organizationId,
    invoicexpress_id: null,
    provider: 'keyinvoice',
    provider_document_type_code: context.docTypeCode,
    provider_series: context.docSeries,
    provider_document_number: null,
    provider_atcud: null,
    reference: null,
    document_type: documentType(kind),
    status: 'pending',
    processing_status: 'processing',
    processing_attempts: 1,
    processing_claim_token: claimToken,
    processing_claimed_at: startedAt,
    client_name: clientName,
    total: expectedTotal,
    date: context.fiscalDate,
    due_date: kind === 'invoice' ? context.fiscalDate : null,
    sale_id: input.saleId,
    recurring_cycle_id: input.recurringCycleId || null,
    payment_id: null,
    pdf_path: null,
    fiscal_idempotency_key: context.idempotencyKey,
    fiscal_snapshot: fiscalSnapshot,
    raw_data: { source: 'keyinvoice', fiscalDate: context.fiscalDate },
    email_status: input.requestEmail ? 'pending' : 'not_requested',
    updated_at: startedAt,
  }
  const { data: pendingInvoice, error: pendingError } = rejectedAttempt
    ? await db.from('invoices').update({
      processing_status: 'processing',
      processing_attempts: Number(duplicate.processing_attempts || 0) + 1,
      processing_last_error: null,
      processing_next_retry_at: null,
      processing_claim_token: claimToken,
      processing_claimed_at: startedAt,
      updated_at: startedAt,
    }).eq('id', duplicate.id)
      .eq('organization_id', input.organizationId)
      .eq('processing_status', 'failed')
      .eq('processing_last_error', duplicate.processing_last_error)
      .select('*').maybeSingle()
    : await db.from('invoices').insert(pendingRow).select('*').single()
  if (pendingError || !pendingInvoice) {
    const concurrent = await findExisting(db, { ...input, idempotencyKey: context.idempotencyKey })
    if (concurrent?.processing_status === 'issued' || concurrent?.status === 'final') {
      return { invoice: concurrent, identity: identityFromResult(concurrent), alreadyIssued: true }
    }
    throw new KeyInvoiceError('Já existe uma operação fiscal para esta venda; confirme o estado antes de repetir', {
      code: 'fiscal_idempotency_conflict',
      httpStatus: 409,
      manualReview: Boolean(concurrent),
    })
  }

  let identity: ReturnType<typeof identityFromResult>
  try {
    identity = await issueKeyInvoiceDocument(session, {
      kind,
      lines,
      clientId: context.providerClientId,
      clientVATIN: clientNif,
      clientName,
      comments: context.comments,
      docSeries: context.docSeries,
    })
  } catch (error) {
    const safe = safeKeyInvoiceError(error)
    const processingStatus = safe.ambiguous
      ? 'reconciliation_required'
      : safe.manual_review
      ? 'manual_review'
      : safe.retryable
      ? 'retry'
      : 'failed'
    const { error: stateError } = await db.from('invoices').update({
      processing_status: processingStatus,
      processing_last_error: safe.code,
      raw_data: {
        ...(pendingInvoice.raw_data || {}),
        ...(processingStatus === 'failed' ? { lastProviderError: safe.message } : {}),
      },
      processing_next_retry_at: safe.retryable ? new Date(Date.now() + 60_000).toISOString() : null,
      processing_claim_token: null,
      processing_claimed_at: null,
      updated_at: new Date().toISOString(),
    }).eq('id', pendingInvoice.id).eq('organization_id', input.organizationId)
    if (stateError) {
      throw new KeyInvoiceError('Falha fiscal sem estado local seguro; é necessária reconciliação', {
        code: 'fiscal_state_persist_failed',
        httpStatus: 500,
        manualReview: true,
        ambiguous: safe.ambiguous,
      })
    }
    throw error
  }
  if (!identity.docSeries || (context.docSeries && identity.docSeries !== context.docSeries)
    || identity.docType !== context.docTypeCode) {
    const identityErrorCode = !identity.docSeries
      ? 'provider_document_series_missing'
      : 'provider_document_identity_mismatch'
    const { error: stateError } = await db.from('invoices').update({
      processing_status: 'manual_review',
      processing_last_error: identityErrorCode,
      processing_claim_token: null,
      processing_claimed_at: null,
      raw_data: identityRawData(identity, { fiscalDate: context.fiscalDate }),
    }).eq('id', pendingInvoice.id).eq('organization_id', input.organizationId)
    if (stateError) console.error('[keyinvoice-sale-document] identity_state_failed')
    throw new KeyInvoiceError('O documento foi emitido, mas a identidade fiscal devolvida está incompleta ou não coincide com a série escolhida. É necessária reconciliação.', {
      code: identityErrorCode,
      httpStatus: 500,
      manualReview: true,
    })
  }
  let pdfPath: string | null = null
  let pdfError: ReturnType<typeof safeKeyInvoiceError> | null = null
  try {
    const pdf = await getKeyInvoicePdf(session, identity)
    const path = `${input.organizationId}/${input.saleId}/${filePart(identity.docType)}-${filePart(identity.docSeries)}-${filePart(identity.docNum)}.pdf`
    const { error: uploadError } = await db.storage.from('invoices').upload(path, pdf, {
      contentType: 'application/pdf',
      upsert: true,
    })
    if (uploadError) throw new KeyInvoiceError('Documento emitido, mas não foi possível guardar o PDF', { code: 'pdf_storage_failed', httpStatus: 500, retryable: true })
    pdfPath = path
  } catch (error) {
    pdfError = safeKeyInvoiceError(error)
  }

  const now = new Date().toISOString()
  const rawData = identityRawData(identity, {
    fiscalDate: context.fiscalDate,
    snapshot: fiscalSnapshot,
    pdf: pdfError ? { status: 'failed', errorCode: pdfError.code, retryable: pdfError.retryable } : { status: 'stored' },
  })
  let legacyDocumentNumber: number
  try {
    legacyDocumentNumber = documentNumberAsInteger(identity)
  } catch (error) {
    const safe = safeKeyInvoiceError(error)
    const { error: stateError } = await db.from('invoices').update({
      processing_status: 'manual_review',
      processing_last_error: safe.code,
      processing_claim_token: null,
      processing_claimed_at: null,
      raw_data: rawData,
      updated_at: new Date().toISOString(),
    }).eq('id', pendingInvoice.id).eq('organization_id', input.organizationId).eq('processing_claim_token', claimToken)
    if (stateError) console.error('[keyinvoice-sale-document] document_number_state_failed')
    throw error
  }
  const issuedFields: Record<string, unknown> = {
    invoicexpress_id: legacyDocumentNumber,
    provider_document_type_code: identity.docType,
    provider_series: identity.docSeries,
    provider_document_number: identity.docNum,
    provider_atcud: identity.atcud,
    reference: identity.fullDocNumber,
    status: 'final',
    processing_status: 'issued',
    processing_last_error: null,
    processing_next_retry_at: null,
    processing_claim_token: null,
    processing_claimed_at: null,
    issued_at: now,
    pdf_path: pdfPath,
    raw_data: rawData,
    updated_at: now,
  }
  const { data: invoice, error: insertError } = await db
    .from('invoices')
    .update(issuedFields)
    .eq('id', pendingInvoice.id)
    .eq('organization_id', input.organizationId)
    .eq('processing_claim_token', claimToken)
    .select('*')
    .single()
  if (insertError || !invoice) {
    // The legal document already exists remotely. Surface a durable, explicit
    // reconciliation error rather than pretending the operation failed safely.
    throw new KeyInvoiceError('Documento emitido no KeyInvoice, mas o registo local falhou. É necessária reconciliação.', {
      code: 'issued_but_not_persisted',
      httpStatus: 500,
      manualReview: true,
    })
  }

  if (!input.recurringCycleId) {
    const { error: saleUpdateError } = await db
      .from('sales')
      .update({
        invoicexpress_id: legacyDocumentNumber,
        invoicexpress_type: kind === 'invoice_receipt' ? 'FR' : 'FT',
        invoice_reference: identity.fullDocNumber,
        ...(pdfPath ? { invoice_pdf_url: pdfPath } : {}),
      })
      .eq('id', input.saleId)
      .eq('organization_id', input.organizationId)
    if (saleUpdateError) {
      throw new KeyInvoiceError('Documento emitido e registado, mas não foi possível atualizar a venda', {
        code: 'sale_link_failed',
        httpStatus: 500,
        manualReview: true,
      })
    }
  }
  return { invoice, identity, alreadyIssued: false }
}

function identityFromResult(invoice: any): any {
  const raw = invoice?.raw_data || {}
  const identity = raw.identity || raw
  return {
    provider: 'keyinvoice',
    docType: String(invoice?.provider_document_type_code ?? identity.docType ?? ''),
    docSeries: invoice?.provider_series || identity.docSeries || null,
    docNum: String(invoice?.provider_document_number ?? identity.docNum ?? ''),
    fullDocNumber: invoice?.reference || identity.fullDocNumber || '',
    atcud: invoice?.provider_atcud || identity.atcud || null,
    identityKey: identity.identityKey || `keyinvoice:${invoice?.provider_document_type_code}:${invoice?.provider_series || '-'}:${invoice?.provider_document_number}`,
  }
}
