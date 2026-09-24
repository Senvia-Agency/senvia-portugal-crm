import { lisbonFiscalDate, prepareKeyInvoiceSaleLines } from './keyinvoice.ts'
import { getVendusPdf, parseVendusIdentity, VendusError, vendusRequest } from './vendus.ts'
import { allocateVendusPayments, getVendusPaymentMethods, type SalePaymentForVendus } from './vendus-payment-methods.ts'

type SaleDocumentKind = 'invoice' | 'invoice_receipt'

export interface IssueVendusSaleInput {
  organizationId: string
  saleId: string
  kind: SaleDocumentKind
  observations?: string | null
}

function amount(value: unknown): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

function taxId(rate: number, exemption: string | null): { tax_id: string; tax_exemption?: string } {
  if (rate === 23) return { tax_id: 'NOR' }
  if (rate === 13) return { tax_id: 'INT' }
  if (rate === 6) return { tax_id: 'RED' }
  if (rate === 0 && exemption && /^M\d{2}$/.test(exemption)) {
    return { tax_id: 'ISE', tax_exemption: exemption }
  }
  throw new VendusError(
    rate === 0
      ? 'Configure um motivo de isenção Vendus válido (Mxx) antes de emitir.'
      : `A taxa de IVA ${rate}% exige configuração fiscal manual na Vendus.`,
    422, 'unsupported_tax',
  )
}

function articleReference(line: Record<string, any>, saleId: string): string {
  const productCode = String(line.productCode || '').trim()
  if (productCode) return productCode
  const stableId = String(line.localProductId || line.localItemId || saleId)
  return `SENVIA-${stableId}`
}

function isoCountry(value: unknown): string {
  const code = String(value || 'PT').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) {
    throw new VendusError('O país do cliente deve ter o código ISO de duas letras', 422, 'invalid_country')
  }
  return code
}

async function findExistingVendusDocument(apiKey: string, reference: string, type: 'FT' | 'FR') {
  const matches: Record<string, any>[] = []
  for (let page = 1; page <= 10; page++) {
    const params = new URLSearchParams({ external_reference: reference, type, per_page: '100', page: String(page) })
    const rows = await vendusRequest<any[]>(apiKey, `/documents/?${params}`)
    if (!Array.isArray(rows)) throw new VendusError('Resposta inesperada da Vendus', 502, 'invalid_response')
    for (const row of rows) {
      // external_reference is a text search, not an exact-match filter.
      const candidateId = Number(row.id)
      if (!Number.isSafeInteger(candidateId) || candidateId <= 0) {
        throw new VendusError('Resposta inesperada da Vendus', 502, 'invalid_response')
      }
      const candidate = typeof row.external_reference === 'string'
        ? row : await vendusRequest<Record<string, any>>(apiKey, `/documents/${candidateId}/`)
      if (candidate.external_reference === reference && candidate.type === type) {
        const detail = await vendusRequest<Record<string, any>>(apiKey, `/documents/${candidateId}/`)
        if (detail.external_reference === reference && detail.type === type) matches.push(detail)
      }
    }
    if (matches.length > 1 || (page === 10 && rows.length === 100)) {
      throw new VendusError('Existem vários documentos Vendus possíveis. É necessária reconciliação manual.', 409, 'ambiguous_document')
    }
    if (rows.length < 100) break
  }
  return matches[0] || null
}

function adjustedDiscount(sale: Record<string, any>, items: Array<Record<string, any>>, taxConfig: Record<string, any>): number {
  const saleDiscount = Number(sale.discount || 0)
  if (saleDiscount === 0) return 0
  let enteredAfterLineDiscounts = 0
  let netAfterLineDiscounts = 0
  for (const item of items) {
    const product = item.product || {}
    const rate = Number(item.tax_value ?? item.taxRate ?? product.tax_value ?? product.taxRate ?? taxConfig.tax_value ?? 23)
    const lineDiscount = Number(item.discount_percent ?? item.discountPercentage ?? 0)
    const entered = Number(item.quantity) * Number(item.unit_price) * (1 - lineDiscount / 100)
    const includesVat = Boolean(item.price_includes_vat ?? item.price_includes_tax
      ?? product.price_includes_vat ?? product.price_includes_tax
      ?? taxConfig.prices_include_vat ?? taxConfig.prices_include_tax ?? false)
    if (!Number.isFinite(rate) || rate < 0 || !Number.isFinite(entered) || entered < 0
      || !Number.isFinite(lineDiscount) || lineDiscount < 0 || lineDiscount > 100) {
      throw new VendusError('Os artigos da venda têm preços ou impostos inválidos.', 422, 'invalid_item')
    }
    enteredAfterLineDiscounts += entered
    netAfterLineDiscounts += includesVat ? entered / (1 + rate / 100) : entered
  }
  if (!Number.isFinite(saleDiscount) || saleDiscount < 0 || saleDiscount > netAfterLineDiscounts + 0.005
    || netAfterLineDiscounts <= 0) {
    throw new VendusError('O desconto excede o subtotal sem IVA da venda.', 422, 'invalid_discount')
  }
  // The CRM discounts the net subtotal. The shared fiscal-line helper applies
  // a ratio to entered prices, which can be gross for VAT-inclusive products.
  return saleDiscount / netAfterLineDiscounts * enteredAfterLineDiscounts
}

async function linkVendusSale(
  db: any, organizationId: string, saleId: string,
  identity: { id: number; reference: string }, pdfPath: string | null,
  kind: SaleDocumentKind, totalMatches: boolean,
) {
  const { data: sale, error: lookupError } = await db.from('sales')
    .select('id,invoice_reference,invoicexpress_id,invoicexpress_type')
    .eq('id', saleId).eq('organization_id', organizationId).maybeSingle()
  if (lookupError || !sale) throw new VendusError('Não foi possível encontrar a venda para associar o documento.', 500, 'sale_link_failed')
  const documentType = kind === 'invoice' ? 'FT' : 'FR'
  if ((sale.invoice_reference && sale.invoice_reference !== identity.reference)
    || (sale.invoicexpress_id && Number(sale.invoicexpress_id) !== identity.id)
    || (sale.invoicexpress_type && sale.invoicexpress_type !== documentType)) {
    throw new VendusError('A venda já está associada a outro documento fiscal.', 409, 'sale_link_conflict')
  }
  let query = db.from('sales').update({
    invoicexpress_id: identity.id,
    invoicexpress_type: documentType,
    invoice_reference: identity.reference,
    ...(pdfPath ? { invoice_pdf_url: pdfPath } : {}),
    ...(kind === 'invoice' && totalMatches && !sale.invoice_reference && !sale.invoicexpress_id
      ? { status: 'delivered' } : {}),
  }).eq('id', saleId).eq('organization_id', organizationId)
  query = sale.invoice_reference ? query.eq('invoice_reference', sale.invoice_reference)
    : query.is('invoice_reference', null)
  query = sale.invoicexpress_id ? query.eq('invoicexpress_id', sale.invoicexpress_id)
    : query.is('invoicexpress_id', null)
  const { data: linked, error: linkError } = await query.select('id').maybeSingle()
  if (linkError || !linked) {
    throw new VendusError('Documento emitido na Vendus, mas não associado à venda. É necessária reconciliação.', 500, 'sale_link_failed')
  }
}

/** Issue FT or FR for a sale. Vendus tx_id is shared by both kinds per sale. */
export async function issueVendusSaleDocument(db: any, org: any, input: IssueVendusSaleInput) {
  const { organizationId, saleId, kind } = input
  const apiKey = String(org.vendus_api_key || '').trim()
  if (!apiKey) {
    throw new VendusError('Configure a chave API Vendus antes de emitir.', 400, 'missing_configuration')
  }
  const type = kind === 'invoice' ? 'FT' : 'FR'
  const idempotencyKey = `vendus:sale:${saleId}`
  const externalReference = `senvia-sale-${saleId}`
  const { data: previous, error: previousError } = await db.from('invoices')
    .select('id,reference,invoicexpress_id,document_type,processing_status,status,provider,sale_id,pdf_path,fiscal_snapshot')
    .eq('organization_id', organizationId)
    .eq('fiscal_idempotency_key', idempotencyKey)
    .maybeSingle()
  if (previousError) throw new VendusError('Não foi possível verificar documentos anteriores', 500, 'invoice_lookup_failed')
  if (previous?.provider === 'vendus' && previous.document_type === kind && previous.sale_id === saleId) {
    const id = Number(previous.invoicexpress_id)
    const reference = String(previous.reference || '')
    const expected = amount(previous.fiscal_snapshot?.expectedTotal)
    if (!Number.isSafeInteger(id) || id <= 0 || !reference
      || !Number.isFinite(expected) || expected <= 0
      || ['cancelled', 'void'].includes(previous.processing_status)
      || previous.status === 'cancelled') {
      throw new VendusError('A emissão anterior exige reconciliação manual na Vendus.', 409, 'incomplete_local_document')
    }
    const remote = await vendusRequest<Record<string, any>>(apiKey, `/documents/${id}/?mode=normal`)
    const remoteIdentity = parseVendusIdentity(remote)
    const remoteStatus = Array.isArray(remote.status) ? remote.status[0]?.id
      : typeof remote.status === 'object' ? remote.status?.id : remote.status
    if (remoteIdentity.id !== id || remoteIdentity.reference !== reference
      || remoteIdentity.type !== type || remote.external_reference !== externalReference
      || remoteStatus !== 'N') {
      throw new VendusError('O documento anterior na Vendus exige reconciliação manual.', 409, 'incomplete_local_document')
    }
    const providerTotal = amount(remote.amount_gross)
    const totalMatches = Number.isFinite(providerTotal) && providerTotal === expected
    await linkVendusSale(db, organizationId, saleId, { id, reference }, previous.pdf_path || null, kind, totalMatches)
    if (!totalMatches) {
      throw new VendusError('O valor emitido na Vendus difere do total da venda. Confirme o documento antes de continuar.', 409, 'provider_total_mismatch')
    }
    if (previous.processing_status !== 'issued' || previous.fiscal_snapshot?.totalMatches !== true) {
      const { data: finalized, error: finalizeError } = await db.from('invoices')
        .update({ processing_status: 'issued', status: 'final', total: providerTotal,
          fiscal_snapshot: { ...previous.fiscal_snapshot, providerTotal, totalMatches: true } })
        .eq('id', previous.id).eq('organization_id', organizationId).select('id').maybeSingle()
      if (finalizeError || !finalized) {
        throw new VendusError('Documento associado à venda, mas o estado local exige reconciliação.', 500, 'local_record_failed')
      }
    }
    return { alreadyIssued: true, id, reference, invoiceId: previous.id }
  }
  if (previous) throw new VendusError('Esta venda já tem um documento fiscal em processamento ou emitido.', 409, 'existing_document')

  // A document imported from Vendus can be linked to the sale even if an
  // earlier crash prevented the legacy sales fields from being updated.
  const { data: linkedDocuments, error: linkedError } = await db.from('invoices')
    .select('id').eq('organization_id', organizationId).eq('sale_id', saleId)
    .in('document_type', ['invoice', 'invoice_receipt'])
    .not('processing_status', 'in', '(cancelled,void)')
    .limit(1)
  if (linkedError) throw new VendusError('Não foi possível verificar os documentos da venda', 500, 'invoice_lookup_failed')
  if (linkedDocuments?.length) throw new VendusError('Esta venda já tem um documento fiscal associado.', 409, 'existing_document')

  const { data: sale, error: saleError } = await db.from('sales')
    .select('*, client:crm_clients(name, company, nif, company_nif, billing_target, email, phone, address_line1, city, postal_code, country), lead:leads(name,email)')
    .eq('id', saleId).eq('organization_id', organizationId).maybeSingle()
  if (saleError || !sale) throw new VendusError('Venda não encontrada', 404, 'sale_not_found')
  if (sale.invoicexpress_id || sale.invoice_reference) {
    throw new VendusError('Esta venda já tem um documento fiscal associado.', 409, 'existing_document')
  }
  const billCompany = sale.client?.billing_target === 'company'
  const clientName = String((billCompany ? sale.client?.company : sale.client?.name) || '').trim()
  const clientNif = String((billCompany ? sale.client?.company_nif : sale.client?.nif) || '').trim()
  if (!clientName || !clientNif) {
    throw new VendusError('Preencha o nome e NIF do destinatário de faturação selecionado no cliente.', 400, 'missing_client_identity')
  }
  if (sale.gross_value === null || sale.gross_value === undefined) {
    throw new VendusError('A venda não tem um total com IVA confirmado para faturação.', 422, 'missing_gross_total')
  }
  const expectedTotal = amount(sale.gross_value)
  if (!Number.isFinite(expectedTotal) || expectedTotal <= 0) {
    throw new VendusError('O total da venda não é válido.', 422, 'invalid_total')
  }

  let paidPayments: SalePaymentForVendus[] = []
  if (kind === 'invoice_receipt') {
    const { data: payments, error: paymentError } = await db.from('sale_payments')
      .select('id,status,amount,payment_method,payment_date,reversal_status,reversed_amount')
      .eq('sale_id', saleId).eq('organization_id', organizationId)
      .is('recurring_cycle_id', null)
      .order('payment_date', { ascending: true }).order('id', { ascending: true })
    if (paymentError) throw new VendusError('Não foi possível validar os pagamentos', 500, 'payment_lookup_failed')
    const paidNet = (payments || []).reduce((sum: number, payment: any) => {
      if (payment.status !== 'paid') return sum
      const reversal = String(payment.reversal_status || 'none')
      const reversed = Number(payment.reversed_amount || 0)
      if (reversal !== 'none' || reversed > 0) {
        throw new VendusError('A venda tem pagamentos revertidos e exige revisão fiscal.', 409, 'reversed_payment')
      }
      return sum + Number(payment.amount || 0)
    }, 0)
    if (sale.payment_status !== 'paid' || amount(paidNet) + 0.005 < expectedTotal) {
      throw new VendusError('A Fatura-Recibo exige pagamento integral confirmado.', 409, 'not_fully_paid')
    }
    paidPayments = (payments || []).filter((payment: any) => payment.status === 'paid')
  }

  const { data: saleItems, error: itemsError } = await db.from('sale_items')
    .select('*, product:products(*)').eq('sale_id', saleId)
  if (itemsError) throw new VendusError('Não foi possível carregar os artigos da venda', 500, 'items_lookup_failed')
  if (!saleItems?.length) {
    throw new VendusError('Adicione artigos com IVA definido à venda antes de emitir na Vendus.', 422, 'missing_fiscal_items')
  }
  const vendusDiscount = adjustedDiscount(sale, saleItems, org.tax_config || {})
  const prepared = prepareKeyInvoiceSaleLines(
    { ...sale, discount: vendusDiscount }, saleItems, org.tax_config || {},
  )
  const lines = (prepared.fiscalSnapshot.lines || []) as Array<Record<string, any>>
  const items = prepared.products.map((product, index) => {
    const quantity = Number(prepared.quantities[index])
    const grossPrice = Math.round((product.unitPrice * (1 + product.taxValue / 100) + Number.EPSILON) * 1_000_000) / 1_000_000
    if (!Number.isFinite(grossPrice) || grossPrice < 0 || !Number.isFinite(quantity) || quantity <= 0) {
      throw new VendusError('Um artigo da venda tem quantidade ou preço inválido.', 422, 'invalid_item')
    }
    return {
      reference: articleReference(lines[index] || {}, saleId),
      title: product.name,
      qty: quantity,
      gross_price: grossPrice,
      stock_control: 0,
      type_id: 'S',
      ...taxId(product.taxValue, product.taxExemptionReason || null),
    }
  })
  const calculatedTotal = amount(items.reduce((sum, item) => sum + item.gross_price * item.qty, 0))
  if (calculatedTotal !== expectedTotal) {
    throw new VendusError('A soma fiscal dos artigos não coincide com o total cobrado na venda.', 422, 'total_mismatch')
  }
  const vendusPayments = kind === 'invoice_receipt'
    ? allocateVendusPayments(paidPayments, await getVendusPaymentMethods(apiKey), expectedTotal)
    : []
  const payload: Record<string, unknown> = {
    type,
    mode: 'normal',
    date: lisbonFiscalDate(),
    tx_id: externalReference,
    external_reference: externalReference,
    client: {
      name: clientName,
      fiscal_id: clientNif,
      ...(sale.client?.email || sale.lead?.email ? { email: sale.client?.email || sale.lead?.email } : {}),
      ...(sale.client?.phone ? { phone: sale.client.phone } : {}),
      ...(sale.client?.address_line1 ? { address: sale.client.address_line1 } : {}),
      ...(sale.client?.city ? { city: sale.client.city } : {}),
      ...(sale.client?.postal_code ? { postalcode: sale.client.postal_code } : {}),
      country: isoCountry(sale.client?.country),
      send_email: 'no',
    },
    items,
    ...(input.observations?.trim() ? { notes: input.observations.trim() } : {}),
    ...(kind === 'invoice_receipt' ? { payments: vendusPayments } : {}),
  }

  let document: Record<string, any>
  try {
    document = await vendusRequest<Record<string, any>>(apiKey, '/documents/', {
      method: 'POST', body: JSON.stringify(payload),
    })
  } catch (error) {
    // A request can succeed remotely while the response is lost. tx_id makes
    // retry safe, and external_reference lets us recover the fiscal identity.
    if (error instanceof VendusError && error.code === 'invalid_credentials') throw error
    let recovered: Record<string, any> | null = null
    try {
      recovered = await findExistingVendusDocument(apiKey, externalReference, type)
    } catch (lookupError) {
      console.warn('[vendus] issuance_recovery_failed', lookupError instanceof VendusError ? lookupError.code : 'lookup_error')
    }
    if (!recovered) {
      throw new VendusError('Não foi possível confirmar o resultado na Vendus. Consulte os documentos antes de repetir.', 409, 'remote_outcome_uncertain')
    }
    document = recovered
  }
  const identity = parseVendusIdentity(document)
  if (identity.type !== type) {
    throw new VendusError('A referência da venda pertence a outro tipo de documento Vendus.', 409, 'document_type_conflict')
  }
  const providerTotal = amount(document.amount_gross)
  const totalMatches = Number.isFinite(providerTotal) && providerTotal === expectedTotal

  let pdfPath: string | null = null
  try {
    const pdf = await getVendusPdf(apiKey, identity.id)
    const path = `${organizationId}/${saleId}/vendus-${type}-${identity.id}.pdf`
    const { error: uploadError } = await db.storage.from('invoices').upload(path, pdf, {
      contentType: 'application/pdf', upsert: true,
    })
    if (!uploadError) pdfPath = path
  } catch (error) {
    console.warn('[vendus] PDF unavailable', error instanceof VendusError ? error.code : 'storage_error')
  }
  const { data: row, error: insertError } = await db.from('invoices').upsert({
    organization_id: organizationId,
    sale_id: saleId,
    invoicexpress_id: identity.id,
    reference: identity.reference,
    document_type: kind,
    provider: 'vendus',
    provider_document_type_code: type,
    provider_series: identity.series,
    provider_document_number: identity.number,
    provider_atcud: identity.atcud,
    fiscal_idempotency_key: idempotencyKey,
    fiscal_snapshot: { ...prepared.fiscalSnapshot, discount: Number(sale.discount || 0),
      vendusAllocatedDiscount: vendusDiscount,
      ...(kind === 'invoice_receipt' ? { payments: vendusPayments } : {}),
      client: { name: clientName, nif: clientNif },
      expectedTotal, providerTotal, totalMatches, observations: input.observations || null },
    processing_status: 'manual_review',
    status: 'final',
    client_name: clientName,
    total: Number.isFinite(providerTotal) ? providerTotal : expectedTotal,
    date: document.date || lisbonFiscalDate(),
    due_date: document.date_due || null,
    issued_at: new Date().toISOString(),
    ...(pdfPath ? { pdf_path: pdfPath } : {}),
    raw_data: { source: 'vendus', provider: 'vendus', ...document },
  }, { onConflict: 'organization_id,fiscal_idempotency_key' }).select('id').single()
  if (insertError || !row) {
    throw new VendusError('Documento emitido na Vendus, mas não gravado no CRM. É necessária reconciliação.', 500, 'local_record_failed')
  }
  await linkVendusSale(db, organizationId, saleId, identity, pdfPath, kind, totalMatches)
  if (!totalMatches) {
    throw new VendusError('O valor emitido na Vendus difere do total da venda. Confirme o documento antes de continuar.', 409, 'provider_total_mismatch')
  }
  const { data: finalized, error: finalizeError } = await db.from('invoices')
    .update({ processing_status: 'issued', status: 'final' })
    .eq('id', row.id).eq('organization_id', organizationId).select('id').maybeSingle()
  if (finalizeError || !finalized) {
    throw new VendusError('Documento associado à venda, mas o estado local exige reconciliação.', 500, 'local_record_failed')
  }
  return { alreadyIssued: false, id: identity.id, reference: identity.reference, invoiceId: row.id, pdfPath }
}
