import { lisbonFiscalDate } from './keyinvoice.ts'
import { getVendusPdf, parseVendusIdentity, selectNormalVendusRegister, VendusError, vendusRequest } from './vendus.ts'

const cents = (value: unknown) => Math.round((Number(value) + Number.EPSILON) * 100) / 100

interface VendusCreditInput {
  organizationId: string
  invoiceId: string
  reason: string
}

async function findCreditByReference(apiKey: string, reference: string): Promise<Record<string, any> | null> {
  const matches: Record<string, any>[] = []
  for (let page = 1; page <= 10; page++) {
    const params = new URLSearchParams({ type: 'NC', mode: 'normal', external_reference: reference,
      per_page: '100', page: String(page) })
    const rows = await vendusRequest<any[]>(apiKey, `/documents/?${params}`)
    if (!Array.isArray(rows)) throw new VendusError('Resposta inesperada da Vendus.', 502, 'invalid_response')
    for (const row of rows) {
      const id = Number(row.id)
      if (!Number.isSafeInteger(id) || id <= 0) throw new VendusError('Documento Vendus inválido.', 502, 'invalid_response')
      if (row.external_reference === reference) {
        const detail = await vendusRequest<Record<string, any>>(apiKey, `/documents/${id}/?mode=normal`)
        if (detail.type === 'NC' && detail.external_reference === reference) matches.push(detail)
      }
    }
    if (matches.length > 1 || (page === 10 && rows.length === 100)) {
      throw new VendusError('Existem várias notas de crédito possíveis. É necessária reconciliação.', 409, 'ambiguous_credit_note')
    }
    if (rows.length < 100) break
  }
  return matches[0] || null
}

/** Build a full credit note from the original Vendus rows, including their fiscal references. */
export function fullCreditItems(document: Record<string, any>): Array<Record<string, unknown>> {
  const rows = document.items
  if (!Array.isArray(rows) || rows.length === 0 || typeof document.number !== 'string') {
    throw new VendusError('A fatura Vendus não tem linhas suficientes para criar uma nota de crédito.', 422, 'missing_original_items')
  }
  return rows.map((row: Record<string, any>, index: number) => {
    const id = Number(row.id)
    const qty = Number(row.qty)
    const grossTotal = Number(row.amounts?.gross_total)
    const remaining = row.qty_nc == null ? qty : Number(row.qty_nc)
    const tax = Array.isArray(row.tax) ? row.tax[0] : row.tax
    const taxId = String(tax?.id || '')
    const exemption = String(tax?.exemption || '')
    const documentRow = Number(row.document_row ?? index + 1)
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(qty) || qty <= 0
      || !Number.isFinite(grossTotal) || grossTotal <= 0
      || !Number.isFinite(remaining) || remaining + 0.000001 < qty
      || !Number.isSafeInteger(documentRow) || documentRow <= 0
      || !['NOR', 'INT', 'RED', 'ISE'].includes(taxId)
      || (taxId === 'ISE' && !/^M\d{2}$/.test(exemption))) {
      throw new VendusError('Uma linha da fatura já foi creditada ou tem valores inválidos.', 409, 'original_line_not_creditable')
    }
    return {
      id,
      qty,
      gross_price: Math.round(grossTotal / qty * 1_000_000) / 1_000_000,
      tax_id: taxId,
      ...(taxId === 'ISE' ? { tax_exemption: exemption } : {}),
      reference_document: { document_number: document.number, document_row: documentRow },
    }
  })
}

export async function issueVendusFullCreditNote(db: any, org: any, input: VendusCreditInput) {
  const { organizationId, invoiceId, reason } = input
  const apiKey = String(org.vendus_api_key || '').trim()
  if (!apiKey) throw new VendusError('Chave API Vendus não configurada.', 400, 'missing_api_key')
  if (!reason.trim()) throw new VendusError('Indique o motivo da nota de crédito.', 400, 'missing_reason')

  const { data: original, error: originalError } = await db.from('invoices').select('*')
    .eq('organization_id', organizationId).eq('id', invoiceId).maybeSingle()
  if (originalError || !original || original.provider !== 'vendus'
    || !['invoice', 'invoice_receipt'].includes(original.document_type)
    || original.processing_status !== 'issued' || original.status !== 'final') {
    throw new VendusError('A fatura Vendus não está emitida ou não pode ser creditada.', 409, 'invalid_original_document')
  }
  const remoteId = Number(original.invoicexpress_id)
  if (!Number.isSafeInteger(remoteId) || remoteId <= 0 || !original.reference) {
    throw new VendusError('A fatura original não tem identidade Vendus completa.', 409, 'missing_original_identity')
  }
  const idempotencyKey = `vendus:NC:${original.id}`
  const externalReference = `senvia-credit-${original.id}`
  const { data: existing, error: existingError } = await db.from('invoices').select('*')
    .eq('organization_id', organizationId).eq('fiscal_idempotency_key', idempotencyKey).maybeSingle()
  if (existingError) throw new VendusError('Não foi possível verificar notas de crédito anteriores.', 500, 'credit_lookup_failed')
  if (existing?.processing_status === 'issued') {
    return { alreadyIssued: true, id: existing.invoicexpress_id, reference: existing.reference,
      invoiceId: existing.id, pdfPath: existing.pdf_path }
  }
  if (existing) throw new VendusError('A nota de crédito anterior exige reconciliação antes de repetir.', 409, 'credit_reconciliation_required')

  const remote = await vendusRequest<Record<string, any>>(apiKey, `/documents/${remoteId}/?mode=normal`)
  const remoteIdentity = parseVendusIdentity(remote)
  const expectedType = original.document_type === 'invoice' ? 'FT' : 'FR'
  const remoteStatus = Array.isArray(remote.status) ? remote.status[0]?.id
    : typeof remote.status === 'object' ? remote.status?.id : remote.status
  if (remoteIdentity.type !== expectedType || remoteIdentity.reference !== original.reference || remoteStatus !== 'N'
    || cents(remote.amount_gross) !== cents(original.total)) {
    throw new VendusError('A fatura original difere do registo local. Confirme-a na Vendus.', 409, 'original_document_mismatch')
  }
  const items = fullCreditItems(remote)
  const client = Array.isArray(remote.client) ? remote.client[0] : remote.client
  const clientId = Number(client?.id)
  if (!Number.isSafeInteger(clientId) || clientId <= 0) {
    throw new VendusError('A fatura original não tem cliente Vendus identificado.', 409, 'missing_original_client')
  }
  const expectedTotal = cents(original.total)
  if (cents(items.reduce((sum, item) => sum + Number(item.gross_price) * Number(item.qty), 0)) !== expectedTotal) {
    throw new VendusError('As linhas da fatura não somam o valor original. Revise a nota na Vendus.', 409, 'original_items_total_mismatch')
  }
  const registerId = selectNormalVendusRegister(await vendusRequest<unknown>(apiKey, '/registers/'))
  const fiscalDate = lisbonFiscalDate()
  const claimToken = crypto.randomUUID()
  const snapshot = { schemaVersion: 1, fiscalDate, reason: reason.trim(), originalInvoiceId: original.id,
    originalReference: original.reference, originalTotal: expectedTotal, items }
  const { data: job, error: jobError } = await db.from('invoices').insert({
    organization_id: organizationId,
    sale_id: original.sale_id,
    payment_id: original.payment_id,
    recurring_cycle_id: original.recurring_cycle_id,
    related_invoice_id: original.id,
    provider: 'vendus',
    document_type: 'credit_note',
    total: expectedTotal,
    status: 'pending',
    processing_status: 'processing',
    processing_attempts: 1,
    processing_claim_token: claimToken,
    processing_claimed_at: new Date().toISOString(),
    date: fiscalDate,
    client_name: original.client_name,
    fiscal_snapshot: snapshot,
    fiscal_idempotency_key: idempotencyKey,
    raw_data: { source: 'vendus', snapshot },
    email_status: 'not_requested',
  }).select('id').single()
  if (jobError || !job) throw new VendusError('Não foi possível reservar a nota de crédito. Nenhum pedido foi enviado à Vendus.', 409, 'credit_reservation_failed')

  const payload = { type: 'NC', mode: 'normal', register_id: registerId, date: fiscalDate,
    notes: reason.trim(), related_document_id: remoteId, tx_id: externalReference,
    external_reference: externalReference,
    client: { id: clientId }, items }
  let credit: Record<string, any>
  try {
    credit = await vendusRequest<Record<string, any>>(apiKey, '/documents/', {
      method: 'POST', body: JSON.stringify(payload),
    })
  } catch {
    // A lost response can follow a successful fiscal mutation. Never repeat POST blindly.
    let recovered: Record<string, any> | null = null
    try { recovered = await findCreditByReference(apiKey, externalReference) } catch { /* manual review */ }
    if (!recovered) {
      await db.from('invoices').update({ processing_status: 'reconciliation_required',
        processing_last_error: 'vendus_credit_outcome_uncertain', processing_claim_token: null,
        processing_claimed_at: null }).eq('id', job.id).eq('organization_id', organizationId)
      throw new VendusError('Não foi possível confirmar a nota de crédito na Vendus. Consulte os documentos antes de repetir.', 409, 'credit_outcome_uncertain')
    }
    credit = recovered
  }
  const identity = parseVendusIdentity(credit)
  if (identity.type !== 'NC' || cents(credit.amount_gross) !== expectedTotal) {
    await db.from('invoices').update({ processing_status: 'manual_review', processing_last_error: 'credit_total_mismatch',
      processing_claim_token: null, processing_claimed_at: null, raw_data: { source: 'vendus', ...credit } })
      .eq('id', job.id).eq('organization_id', organizationId)
    throw new VendusError('A nota foi criada na Vendus, mas o valor ou tipo difere da fatura. É necessária reconciliação.', 409, 'credit_total_mismatch')
  }
  let pdfPath: string | null = null
  try {
    const pdf = await getVendusPdf(apiKey, identity.id)
    const path = `${organizationId}/credit_note_vendus_${identity.id}.pdf`
    const { error } = await db.storage.from('invoices').upload(path, pdf, { contentType: 'application/pdf', upsert: true })
    if (!error) pdfPath = path
  } catch { /* fiscal document remains valid */ }
  const { data: finalized, error: finalError } = await db.from('invoices').update({
    invoicexpress_id: identity.id,
    provider_document_type_code: 'NC',
    provider_series: identity.series,
    provider_document_number: identity.number,
    provider_atcud: identity.atcud,
    reference: identity.reference,
    status: 'final',
    processing_status: 'issued',
    processing_last_error: null,
    processing_claim_token: null,
    processing_claimed_at: null,
    issued_at: new Date().toISOString(),
    total: expectedTotal,
    pdf_path: pdfPath,
    raw_data: { source: 'vendus', ...credit },
  }).eq('id', job.id).eq('organization_id', organizationId).eq('processing_claim_token', claimToken)
    .select('id').maybeSingle()
  if (finalError || !finalized) throw new VendusError('Nota de crédito emitida na Vendus, mas não concluída no CRM. É necessária reconciliação.', 500, 'credit_local_persist_failed')

  const { error: legacyError } = await db.from('credit_notes').insert({
    organization_id: organizationId,
    invoicexpress_id: identity.id,
    reference: identity.reference,
    status: 'settled',
    client_name: original.client_name,
    total: expectedTotal,
    date: fiscalDate,
    related_invoice_id: remoteId,
    sale_id: original.sale_id,
    payment_id: original.payment_id,
    pdf_path: pdfPath,
    raw_data: { source: 'vendus', invoice_id: job.id },
  })
  if (legacyError) throw new VendusError('Nota emitida, mas não aparece nas finanças. É necessária reconciliação.', 500, 'credit_legacy_persist_failed')
  if (original.sale_id) {
    const { error } = await db.from('sales').update({ credit_note_id: identity.id,
      credit_note_reference: identity.reference }).eq('id', original.sale_id).eq('organization_id', organizationId)
    if (error) throw new VendusError('Nota emitida, mas a venda não foi atualizada. É necessária reconciliação.', 500, 'credit_sale_link_failed')
  }
  if (original.payment_id) {
    const { error } = await db.from('sale_payments').update({ credit_note_id: identity.id,
      credit_note_reference: identity.reference }).eq('id', original.payment_id).eq('organization_id', organizationId)
    if (error) throw new VendusError('Nota emitida, mas o pagamento não foi atualizado. É necessária reconciliação.', 500, 'credit_payment_link_failed')
  }
  return { alreadyIssued: false, id: identity.id, reference: identity.reference,
    invoiceId: job.id, pdfPath }
}
