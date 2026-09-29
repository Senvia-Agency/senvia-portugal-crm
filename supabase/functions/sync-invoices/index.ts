import { requestMfaResponse } from "../_shared/user-authorization.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getVendusPdf, parseVendusIdentity, vendusRequest, VendusError } from '../_shared/vendus.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function downloadAndUploadPdf(
  supabase: any,
  pdfUrl: string,
  storagePath: string
): Promise<string | null> {
  try {
    const pdfRes = await fetch(pdfUrl)
    if (!pdfRes.ok) return null
    const pdfBlob = await pdfRes.blob()
    const arrayBuffer = await pdfBlob.arrayBuffer()
    const uint8 = new Uint8Array(arrayBuffer)

    const { error } = await supabase.storage
      .from('invoices')
      .upload(storagePath, uint8, {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (error) {
      console.error('Upload error:', error)
      return null
    }
    return storagePath
  } catch (e) {
    console.error('Download/upload error:', e)
    return null
  }
}

async function pollPdfUrl(baseUrl: string, docId: number, apiKey: string): Promise<string | null> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/pdf/${docId}.json?api_key=${apiKey}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      })
      if (res.status === 200) {
        const data = await res.json()
        const url = data?.output?.pdfUrl
        if (url) return url
      }
      if (i < 2) await new Promise(r => setTimeout(r, 2000))
    } catch (e) {
      if (i < 2) await new Promise(r => setTimeout(r, 2000))
    }
  }
  return null
}

interface DocType {
  endpoint: string
  listKey: string
  detailKey: string
  type: string
}

interface InvoiceXpressFiscalIdentity {
  series: string
  number: string
}

function nonEmptyText(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).trim()
  return text || null
}

/**
 * InvoiceXpress returns the fiscal number twice: `sequence_number` is
 * `<number>/<series>` and `inverted_sequence_number` is `<series>/<number>`.
 * Use only those provider-returned values and cross-check them when both are
 * present; never manufacture a series from the date, sequence id or reference.
 */
function extractInvoiceXpressFiscalIdentity(doc: any): InvoiceXpressFiscalIdentity | null {
  const sequenceNumber = nonEmptyText(doc?.sequence_number)
  const invertedSequenceNumber = nonEmptyText(doc?.inverted_sequence_number)

  let normal: InvoiceXpressFiscalIdentity | null = null
  if (sequenceNumber) {
    const separator = sequenceNumber.indexOf('/')
    if (separator > 0 && separator < sequenceNumber.length - 1) {
      const number = sequenceNumber.slice(0, separator).trim()
      const series = sequenceNumber.slice(separator + 1).trim()
      if (number && series) normal = { number, series }
    }
  }

  let inverted: InvoiceXpressFiscalIdentity | null = null
  if (invertedSequenceNumber) {
    const separator = invertedSequenceNumber.lastIndexOf('/')
    if (separator > 0 && separator < invertedSequenceNumber.length - 1) {
      const series = invertedSequenceNumber.slice(0, separator).trim()
      const number = invertedSequenceNumber.slice(separator + 1).trim()
      if (number && series) inverted = { number, series }
    }
  }

  if (normal && inverted) {
    return normal.number === inverted.number && normal.series === inverted.series
      ? normal
      : null
  }

  return normal || inverted
}

const DOC_TYPES: DocType[] = [
  { endpoint: 'invoices', listKey: 'invoices', detailKey: 'invoice', type: 'invoice' },
  { endpoint: 'invoice_receipts', listKey: 'invoice_receipts', detailKey: 'invoice_receipt', type: 'invoice_receipt' },
  { endpoint: 'simplified_invoices', listKey: 'simplified_invoices', detailKey: 'simplified_invoice', type: 'simplified_invoice' },
]

async function syncOrganization(supabase: any, organization_id: string, org: any) {
  const baseUrl = `https://${org.invoicexpress_account_name}.app.invoicexpress.com`
  const apiKey = org.invoicexpress_api_key

  let totalSynced = 0
  let totalMatched = 0
  let totalNotMatched = 0

  for (const docType of DOC_TYPES) {
    let allDocs: any[] = []
    let page = 1
    let hasMore = true

    while (hasMore) {
      const url = `${baseUrl}/${docType.endpoint}.json?api_key=${apiKey}&page=${page}&per_page=50`
      console.log(`[${organization_id}] Fetching ${docType.endpoint} page ${page}...`)

      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      })

      if (!res.ok) {
        const errorText = await res.text()
        console.error(`InvoiceXpress error for ${docType.endpoint}:`, res.status, errorText)
        break
      }

      const data = await res.json()
      const docs = data?.[docType.listKey] || []

      if (docs.length === 0) {
        hasMore = false
      } else {
        allDocs = allDocs.concat(docs)
        page++
        if (page > 20) hasMore = false
      }
    }

    console.log(`[${organization_id}] Found ${allDocs.length} ${docType.endpoint}`)

    for (const doc of allDocs) {
      const docId = doc.id
      const docRef = doc.sequence_number || doc.inverted_sequence_number || `${docType.type}-${docId}`
      const docTotal = parseFloat(doc.total || '0')
      const docDate = doc.date || null
      const docDueDate = doc.due_date || null
      const docClientName = doc.client?.name || null
      const docStatus = doc.status || null
      const fiscalIdentity = extractInvoiceXpressFiscalIdentity(doc)
      const providerAtcud = nonEmptyText(doc.atcud)
      if ((doc.sequence_number || doc.inverted_sequence_number) && !fiscalIdentity) {
        console.warn(`Inconsistent InvoiceXpress sequence for ${docType.type} ${docId}; fiscal identity deferred`)
      }

      // Try to match to local sales/payments
      let matchedSaleId: string | null = null
      let matchedPaymentId: string | null = null
      const typePrefix = docType.type === 'invoice' ? 'FT'
        : docType.type === 'invoice_receipt' ? 'FR' : 'FS'
      const exactReferences = [...new Set([
        doc.sequence_number ? `${typePrefix} ${doc.sequence_number}` : null,
        doc.inverted_sequence_number ? `${typePrefix} ${doc.inverted_sequence_number}` : null,
        `${typePrefix} #${docId}`,
      ].filter(Boolean))] as string[]

      // Match 0: by proprietary_uid in raw_data
      const proprietaryUid = doc.proprietary_uid || null
      if (proprietaryUid && typeof proprietaryUid === 'string' && proprietaryUid.startsWith('senvia-sale-')) {
        const extractedSaleId = proprietaryUid.replace('senvia-sale-', '')
        const { data: saleByUid, error: uidError } = await supabase
          .from('sales')
          .select('id,invoice_reference,invoicexpress_id,invoicexpress_type')
          .eq('id', extractedSaleId)
          .eq('organization_id', organization_id)
          .maybeSingle()
        if (uidError) {
          console.error(`InvoiceXpress sale UID lookup failed for ${docId}`, uidError)
          continue
        }
        if (saleByUid) {
          const { data: otherProviderRows, error: otherProviderError } = await supabase
            .from('invoices').select('id')
            .eq('organization_id', organization_id).eq('sale_id', saleByUid.id)
            .in('provider', ['vendus', 'keyinvoice'])
            .in('document_type', ['invoice', 'invoice_receipt'])
            .not('processing_status', 'in', '(cancelled,void)').limit(1)
          if (otherProviderError) {
            console.error(`InvoiceXpress provider conflict lookup failed for ${docId}`, otherProviderError)
            continue
          }
          if (!otherProviderRows?.length
            && (!saleByUid.invoicexpress_id || Number(saleByUid.invoicexpress_id) === Number(docId))
            && (!saleByUid.invoicexpress_type || saleByUid.invoicexpress_type === docType.endpoint)
            && (!saleByUid.invoice_reference || exactReferences.includes(saleByUid.invoice_reference))) {
            matchedSaleId = saleByUid.id
          }
        }
      }

      // Match 1: an internal provider ID is only meaningful inside its provider.
      // Legacy sales and payments also store Vendus IDs in these columns, so
      // resolve numeric IDs through a provider-scoped invoice row.
      if (!matchedSaleId) {
        const { data: localInvoices, error: localInvoiceError } = await supabase
          .from('invoices')
          .select('sale_id,payment_id')
          .eq('organization_id', organization_id)
          .eq('provider', 'invoicexpress')
          .eq('invoicexpress_id', docId)
          .eq('document_type', docType.type)
          .limit(2)
        if (localInvoiceError) {
          console.error(`InvoiceXpress local identity lookup failed for ${docId}`, localInvoiceError)
          continue
        }
        if (localInvoices?.length === 1) {
          matchedSaleId = localInvoices[0].sale_id || null
          matchedPaymentId = localInvoices[0].payment_id || null
        }
      }

      // Match 2: exact provider document reference, never a numeric suffix or
      // client name. Those heuristics can attach a document to another sale.
      if (!matchedSaleId && exactReferences.length) {
        const { data: sales, error: referenceError } = await supabase.from('sales')
          .select('id')
          .eq('organization_id', organization_id)
          .eq('invoicexpress_type', docType.endpoint)
          .in('invoice_reference', exactReferences)
          .limit(2)
        if (referenceError) {
          console.error(`InvoiceXpress reference lookup failed for ${docId}`, referenceError)
          continue
        }
        if (sales?.length === 1) matchedSaleId = sales[0].id
      }
      if (!matchedPaymentId && exactReferences.length) {
        const { data: payments, error: paymentError } = await supabase.from('sale_payments')
          .select('id,sale_id')
          .eq('organization_id', organization_id)
          .in('invoice_reference', exactReferences)
          .limit(2)
        if (paymentError) {
          console.error(`InvoiceXpress payment reference lookup failed for ${docId}`, paymentError)
          continue
        }
        if (payments?.length === 1) {
          const { data: sourceSale, error: sourceError } = await supabase.from('sales')
            .select('id,invoicexpress_type')
            .eq('id', payments[0].sale_id).eq('organization_id', organization_id).maybeSingle()
          if (sourceError) {
            console.error(`InvoiceXpress payment sale lookup failed for ${docId}`, sourceError)
            continue
          }
          if (sourceSale?.invoicexpress_type === docType.endpoint) {
            matchedPaymentId = payments[0].id
            matchedSaleId = payments[0].sale_id
          }
        }
      }

      // Skip if this document already exists as a credit note
      const { data: existingCN } = await supabase
        .from('credit_notes')
        .select('id')
        .eq('organization_id', organization_id)
        .eq('invoicexpress_id', docId)
        .maybeSingle()

      if (existingCN) {
        console.log(`Skipping ${docId} - already exists as credit note`)
        continue
      }

      // Download PDF
      let pdfPath: string | null = null
      try {
        const pdfTempUrl = await pollPdfUrl(baseUrl, docId, apiKey)
        if (pdfTempUrl) {
          const fileName = `${organization_id}/${docType.type}_${docId}.pdf`
          pdfPath = await downloadAndUploadPdf(supabase, pdfTempUrl, fileName)
        }
      } catch (e) {
        console.warn(`Failed to download PDF for ${docType.type} ${docId}:`, e)
      }

      // `invoicexpress_id` is an internal provider id and is not the fiscal
      // identity. It can no longer be used as the conflict target because a
      // fiscal number is only unique inside provider + type + series.
      const { data: rowsByProviderId, error: lookupError } = await supabase
        .from('invoices')
        .select('id,provider_document_number,provider_atcud')
        .eq('organization_id', organization_id)
        .eq('provider', 'invoicexpress')
        .eq('invoicexpress_id', docId)
        .eq('document_type', docType.type)
        .limit(2)

      if (lookupError) {
        console.error(`Lookup error for ${docType.type} ${docId}:`, lookupError)
        continue
      }

      if ((rowsByProviderId?.length || 0) > 1) {
        console.error(`Ambiguous InvoiceXpress document ${docType.type} ${docId}; sync skipped`)
        continue
      }

      let existingInvoice = rowsByProviderId?.[0] || null

      // A previous import can already be known by its fiscal identity even when
      // its internal provider id is absent or differs. Resolve it before insert.
      if (!existingInvoice && fiscalIdentity) {
        const { data: rowsByFiscalIdentity, error: identityLookupError } = await supabase
          .from('invoices')
          .select('id,provider_document_number,provider_atcud')
          .eq('organization_id', organization_id)
          .eq('provider', 'invoicexpress')
          .eq('provider_document_type_code', docType.type)
          .eq('provider_series', fiscalIdentity.series)
          .eq('provider_document_number', fiscalIdentity.number)
          .limit(2)

        if (identityLookupError) {
          console.error(`Identity lookup error for ${docType.type} ${docId}:`, identityLookupError)
          continue
        }

        if ((rowsByFiscalIdentity?.length || 0) > 1) {
          console.error(`Ambiguous fiscal identity for ${docType.type} ${docRef}; sync skipped`)
          continue
        }

        existingInvoice = rowsByFiscalIdentity?.[0] || null
      }

      const invoiceData: Record<string, unknown> = {
        organization_id,
        invoicexpress_id: docId,
        reference: docRef,
        document_type: docType.type,
        status: docStatus,
        client_name: docClientName,
        total: docTotal,
        date: docDate,
        due_date: docDueDate,
        raw_data: doc,
        updated_at: new Date().toISOString(),
      }

      // Do not erase a previously matched relation or PDF when the current
      // InvoiceXpress response/download does not provide one.
      if (matchedSaleId) invoiceData.sale_id = matchedSaleId
      if (matchedPaymentId) invoiceData.payment_id = matchedPaymentId
      if (pdfPath) invoiceData.pdf_path = pdfPath

      let persistenceError: any = null
      if (existingInvoice) {
        // Legacy rows were backfilled with an immutable `__legacy__` identity.
        // Preserve it. A row created without a sequence may receive the exact
        // provider identity once InvoiceXpress starts returning it.
        if (!existingInvoice.provider_document_number && fiscalIdentity) {
          invoiceData.provider_document_type_code = docType.type
          invoiceData.provider_series = fiscalIdentity.series
          invoiceData.provider_document_number = fiscalIdentity.number
        }
        // ATCUD may become available on a later provider read. It can be
        // filled once but the database trigger prevents replacing a value
        // that was already recorded.
        if (!existingInvoice.provider_atcud && providerAtcud) {
          invoiceData.provider_atcud = providerAtcud
        }

        const { error } = await supabase
          .from('invoices')
          .update(invoiceData)
          .eq('id', existingInvoice.id)
        persistenceError = error
      } else {
        invoiceData.provider = 'invoicexpress'
        invoiceData.fiscal_idempotency_key = `sync:invoicexpress:${docType.type}:${docId}`
        invoiceData.provider_document_type_code = docType.type
        if (fiscalIdentity) {
          invoiceData.provider_series = fiscalIdentity.series
          invoiceData.provider_document_number = fiscalIdentity.number
          if (providerAtcud) invoiceData.provider_atcud = providerAtcud
        }

        // The deterministic idempotency key also closes the race between two
        // concurrent sync runs when InvoiceXpress has not returned a series yet.
        const { error } = await supabase
          .from('invoices')
          .upsert(invoiceData, {
            onConflict: 'organization_id,fiscal_idempotency_key',
          })
        persistenceError = error
      }

      if (persistenceError) {
        console.error(`Persistence error for ${docType.type} ${docId}:`, persistenceError)
      }

      totalSynced++
      if (matchedSaleId || matchedPaymentId) {
        totalMatched++
      } else {
        totalNotMatched++
      }
    }
  }

  return { total: totalSynced, matched: totalMatched, not_matched: totalNotMatched }
}

const VENDUS_DOCUMENT_TYPES: Record<string, 'invoice' | 'invoice_receipt' | 'receipt'> = {
  FT: 'invoice', FR: 'invoice_receipt', RG: 'receipt',
}

function vendusDocumentStatus(value: any): string {
  const status = Array.isArray(value) ? value[0] : value
  return typeof status === 'string' ? status : String(status?.id || '')
}

function sameGrossInCents(local: unknown, remote: unknown): boolean {
  const localAmount = Number(local)
  const remoteAmount = Number(remote)
  return Number.isFinite(localAmount) && Number.isFinite(remoteAmount)
    && localAmount > 0 && remoteAmount > 0
    && Math.round(localAmount * 100) === Math.round(remoteAmount * 100)
}

async function linkVendusSale(
  supabase: any, organizationId: string, saleId: string,
  identity: ReturnType<typeof parseVendusIdentity>, pdfPath: string | null,
  remoteGross: unknown,
) {
  const { data: sale, error } = await supabase.from('sales')
    .select('id,invoice_reference,invoicexpress_id,invoicexpress_type,invoice_pdf_url,gross_value')
    .eq('id', saleId).eq('organization_id', organizationId).maybeSingle()
  if (error || !sale) throw new Error('Vendus sale link lookup failed')
  if (!sameGrossInCents(sale.gross_value, remoteGross)) {
    throw new Error('Vendus sale gross total differs from remote document')
  }
  if ((sale.invoice_reference && sale.invoice_reference !== identity.reference)
    || (sale.invoicexpress_id && Number(sale.invoicexpress_id) !== identity.id)
    || (sale.invoicexpress_type && ![identity.type, 'vendus'].includes(sale.invoicexpress_type))) {
    throw new Error('Vendus sale link conflicts with another fiscal document')
  }
  if (sale.invoice_reference === identity.reference
    && Number(sale.invoicexpress_id) === identity.id
    && sale.invoicexpress_type === identity.type
    && (!pdfPath || sale.invoice_pdf_url === pdfPath)) return

  let update = supabase.from('sales').update({
    invoice_reference: identity.reference,
    invoicexpress_id: identity.id,
    invoicexpress_type: identity.type,
    ...(pdfPath ? { invoice_pdf_url: pdfPath } : {}),
  }).eq('id', saleId).eq('organization_id', organizationId)
  update = sale.invoice_reference ? update.eq('invoice_reference', sale.invoice_reference)
    : update.is('invoice_reference', null)
  update = sale.invoicexpress_id ? update.eq('invoicexpress_id', sale.invoicexpress_id)
    : update.is('invoicexpress_id', null)
  const { data: linked, error: linkError } = await update.select('id').maybeSingle()
  if (linkError || !linked) throw new Error('Vendus sale link failed')
}

async function verifyVendusReceiptSource(
  supabase: any, organizationId: string, payment: any, doc: Record<string, any>,
): Promise<{ id: string; reference: string } | null> {
  if (!payment || payment.status !== 'paid'
    || String(payment.reversal_status || 'none') !== 'none'
    || Number(payment.reversed_amount || 0) > 0
    || (payment.invoice_reference && payment.invoice_reference !== doc.number)
    || (payment.invoicexpress_id && Number(payment.invoicexpress_id) !== Number(doc.id))) return null
  const amount = Number(payment.amount)
  const remoteAmount = Number(doc.amount_gross)
  if (!Number.isFinite(amount) || !Number.isFinite(remoteAmount)
    || amount <= 0 || Math.abs(amount - remoteAmount) > 0.005) return null
  const related = Array.isArray(doc.related_docs) ? doc.related_docs : []
  if (related.length !== 1 || related[0]?.type !== 'FT'
    || typeof related[0]?.number !== 'string') return null
  const { data: sources, error } = await supabase.from('invoices')
    .select('id,reference')
    .eq('organization_id', organizationId).eq('provider', 'vendus')
    .eq('sale_id', payment.sale_id).eq('document_type', 'invoice')
    .eq('provider_document_type_code', 'FT')
    .eq('reference', related[0].number).eq('status', 'final')
    .in('processing_status', ['issued', 'legacy']).limit(2)
  if (error) throw error
  return sources?.length === 1 ? sources[0] : null
}

async function syncVendusOrganization(supabase: any, organizationId: string, apiKey: string) {
  const perPage = 100
  let page = 1
  let total = 0
  let matched = 0
  let notMatched = 0
  let failed = 0

  while (true) {
    const summaries = await vendusRequest<any[]>(
      apiKey,
      `/documents/?type=FT%2CFR%2CRG&mode=normal&per_page=${perPage}&page=${page}`,
    )
    if (!Array.isArray(summaries)) throw new VendusError('Resposta inesperada da Vendus', 502, 'invalid_response')
    if (summaries.length === 0) break

    for (const summary of summaries) {
      const documentId = Number(summary?.id)
      if (!Number.isSafeInteger(documentId) || documentId <= 0 || !VENDUS_DOCUMENT_TYPES[summary?.type]) {
        console.warn('[sync-invoices] vendus_invalid_summary', organizationId)
        failed++
        continue
      }

      try {
        // The list already contains the complete fiscal identity and status.
        // Skip extra provider calls for documents whose detail and PDF were
        // imported on an earlier run, so later pages can progress within the
        // Vendus rate limit.
        let listedIdentity: ReturnType<typeof parseVendusIdentity> | null = null
        try { listedIdentity = parseVendusIdentity(summary) } catch { /* Detail may still contain the number. */ }
        if (listedIdentity) {
          const { data: cachedRows, error: cachedError } = await supabase.from('invoices')
            .select('id,document_type,processing_status,provider_document_type_code,provider_series,provider_document_number,pdf_path,status,sale_id,payment_id,related_invoice_id')
            .eq('organization_id', organizationId).eq('provider', 'vendus')
            .eq('invoicexpress_id', documentId).limit(2)
          if (cachedError) throw cachedError
          if ((cachedRows?.length || 0) > 1) throw new Error('Ambiguous Vendus provider ID')
          const cached = cachedRows?.[0]
          const listedStatus = vendusDocumentStatus(summary.status)
          let paymentLinked = !(
            cached?.document_type === 'receipt' &&
            ((cached.payment_id && !cached.related_invoice_id) ||
              (!cached.payment_id && /^senvia-payment-[0-9a-f-]+$/i.test(String(summary.external_reference || ''))))
          )
          if (cached?.document_type === 'receipt' && cached.payment_id) {
            const { data: payment, error: paymentError } = await supabase.from('sale_payments')
              .select('invoice_reference,invoicexpress_id')
              .eq('id', cached.payment_id).eq('organization_id', organizationId).maybeSingle()
            if (paymentError) throw paymentError
            paymentLinked = !!cached.related_invoice_id
              && payment?.invoice_reference === listedIdentity.reference
              && payment?.invoicexpress_id === documentId
          }
          const unresolvedSale = cached?.document_type !== 'receipt' && !cached?.sale_id
            && /^senvia-sale-[0-9a-f-]+$/i.test(String(summary.external_reference || ''))
          if (cached?.pdf_path && paymentLinked && ['N', 'F'].includes(listedStatus)
            && !unresolvedSale
            && (cached.document_type === 'receipt' || !cached.sale_id || summary.amount_gross != null)
            && ['issued', 'legacy'].includes(cached.processing_status)
            && cached.document_type === VENDUS_DOCUMENT_TYPES[listedIdentity.type]
            && cached.provider_document_type_code === listedIdentity.type
            && cached.provider_series === listedIdentity.series
            && cached.provider_document_number === listedIdentity.number) {
            if (cached.sale_id && cached.document_type !== 'receipt' && listedStatus === 'N') {
              await linkVendusSale(supabase, organizationId, cached.sale_id,
                listedIdentity, cached.pdf_path || null, summary.amount_gross)
            }
            const status = listedStatus === 'A' ? 'cancelled' : 'final'
            if (cached.status !== status) {
              const { error: statusError } = await supabase.from('invoices')
                .update({ status, updated_at: new Date().toISOString() })
                .eq('id', cached.id).eq('organization_id', organizationId)
              if (statusError) throw statusError
            }
            total++
            if (cached.sale_id || cached.payment_id) matched++
            else notMatched++
            continue
          }
        }

        const doc = await vendusRequest<Record<string, any>>(apiKey, `/documents/${documentId}/?mode=normal`)
        const identity = parseVendusIdentity(doc)
        const documentType = VENDUS_DOCUMENT_TYPES[identity.type]
        const documentStatus = vendusDocumentStatus(doc.status)
        if (!documentType || identity.type !== summary.type || !['N', 'A', 'F'].includes(documentStatus)) {
          console.warn('[sync-invoices] vendus_document_type_mismatch', organizationId, documentId)
          failed++
          continue
        }

        let saleId: string | null = null
        let paymentId: string | null = null
        let paymentRecord: any = null
        let relatedInvoiceId: string | null = null
        const externalReference = typeof doc.external_reference === 'string' ? doc.external_reference.trim() : ''
        const saleMatch = /^senvia-sale-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(externalReference)
        const paymentMatch = /^senvia-payment-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(externalReference)
        if (saleMatch && documentType !== 'receipt' && documentStatus === 'N') {
          const { data, error } = await supabase.from('sales')
            .select('id,invoice_reference,invoicexpress_id,invoicexpress_type,gross_value')
            .eq('id', saleMatch[1]).eq('organization_id', organizationId).maybeSingle()
          if (error) throw error
          if (data && (!data.invoice_reference || data.invoice_reference === identity.reference)
            && (!data.invoicexpress_id || Number(data.invoicexpress_id) === identity.id)
            && (!data.invoicexpress_type || [identity.type, 'vendus'].includes(data.invoicexpress_type))
            && sameGrossInCents(data.gross_value, doc.amount_gross)) {
            saleId = data.id
          } else if (data) {
            console.warn('[sync-invoices] vendus_sale_link_conflict', organizationId, documentId)
          }
        } else if (paymentMatch && documentType === 'receipt' && documentStatus === 'N') {
          const { data, error } = await supabase.from('sale_payments')
            .select('id,sale_id,amount,status,reversal_status,reversed_amount,invoice_reference,invoicexpress_id,invoice_file_url')
            .eq('id', paymentMatch[1]).eq('organization_id', organizationId).maybeSingle()
          if (error) throw error
          if (data) {
            const source = await verifyVendusReceiptSource(supabase, organizationId, data, doc)
            if (source) {
              paymentRecord = data
              paymentId = data.id
              saleId = data.sale_id
              relatedInvoiceId = source.id
            } else {
              console.warn('[sync-invoices] vendus_receipt_source_unverified', organizationId, documentId)
            }
          }
        }

        const { data: byProviderId, error: providerLookupError } = await supabase.from('invoices')
          .select('id,document_type,processing_status,processing_claimed_at,provider_document_type_code,provider_series,provider_document_number,provider_atcud,pdf_path,fiscal_idempotency_key,sale_id,payment_id,related_invoice_id,invoicexpress_id,total,date,fiscal_snapshot')
          .eq('organization_id', organizationId).eq('provider', 'vendus')
          .eq('invoicexpress_id', identity.id).eq('document_type', documentType).limit(2)
        if (providerLookupError) throw providerLookupError
        if ((byProviderId?.length || 0) > 1) throw new Error('Ambiguous Vendus provider ID')

        const { data: byIdentity, error: identityLookupError } = await supabase.from('invoices')
          .select('id,document_type,processing_status,processing_claimed_at,provider_document_type_code,provider_series,provider_document_number,provider_atcud,pdf_path,fiscal_idempotency_key,sale_id,payment_id,related_invoice_id,invoicexpress_id,total,date,fiscal_snapshot')
          .eq('organization_id', organizationId).eq('provider', 'vendus')
          .eq('provider_document_type_code', identity.type)
          .eq('provider_series', identity.series)
          .eq('provider_document_number', identity.number).limit(2)
        if (identityLookupError) throw identityLookupError
        if ((byIdentity?.length || 0) > 1 ||
          (byProviderId?.[0] && byIdentity?.[0] && byProviderId[0].id !== byIdentity[0].id)) {
          throw new Error('Ambiguous Vendus fiscal identity')
        }

        let existingInvoice = byProviderId?.[0] || byIdentity?.[0] || null
        if (existingInvoice?.processing_status === 'void' && documentStatus !== 'A') {
          throw new Error('Previously cancelled Vendus document is active remotely')
        }
        if (!existingInvoice && (saleId || paymentId)) {
          const localKey = paymentId ? `vendus:RG:${paymentId}` : `vendus:sale:${saleId}`
          const { data: byLocalKey, error: localLookupError } = await supabase.from('invoices')
            .select('id,document_type,processing_status,processing_claimed_at,provider_series,provider_document_number,provider_atcud,pdf_path,fiscal_idempotency_key,sale_id,payment_id,related_invoice_id,provider_document_type_code,invoicexpress_id,total,date,fiscal_snapshot')
            .eq('organization_id', organizationId).eq('provider', 'vendus')
            .eq('fiscal_idempotency_key', localKey).maybeSingle()
          if (localLookupError) throw localLookupError
          if (byLocalKey && (
            byLocalKey.document_type !== documentType ||
            (byLocalKey.provider_document_type_code && byLocalKey.provider_document_type_code !== identity.type) ||
            (byLocalKey.provider_series && byLocalKey.provider_series !== identity.series) ||
            (byLocalKey.provider_document_number && byLocalKey.provider_document_number !== identity.number) ||
            (byLocalKey.invoicexpress_id && byLocalKey.invoicexpress_id !== identity.id)
          )) throw new Error('Vendus document conflicts with local issuance')
          existingInvoice = byLocalKey || null
        }

        if (existingInvoice && (
          existingInvoice.document_type !== documentType ||
          (existingInvoice.provider_document_type_code && existingInvoice.provider_document_type_code !== identity.type) ||
          (existingInvoice.provider_series && existingInvoice.provider_series !== identity.series) ||
          (existingInvoice.provider_document_number && existingInvoice.provider_document_number !== identity.number) ||
          (existingInvoice.invoicexpress_id && existingInvoice.invoicexpress_id !== identity.id) ||
          (saleId && existingInvoice.sale_id && existingInvoice.sale_id !== saleId) ||
          (paymentId && existingInvoice.payment_id && existingInvoice.payment_id !== paymentId) ||
          (relatedInvoiceId && existingInvoice.related_invoice_id
            && existingInvoice.related_invoice_id !== relatedInvoiceId)
        )) throw new Error('Vendus document conflicts with existing invoice')

        const localKey = paymentId ? `vendus:RG:${paymentId}` : saleId ? `vendus:sale:${saleId}` : null
        const claimedAt = existingInvoice?.processing_claimed_at
          ? Date.parse(existingInvoice.processing_claimed_at) : NaN
        const staleProcessing = existingInvoice?.processing_status === 'processing'
          && Number.isFinite(claimedAt) && claimedAt < Date.now() - 5 * 60 * 1000
        const needsReconciliation = existingInvoice?.processing_status === 'reconciliation_required'
          || staleProcessing

        if (needsReconciliation) {
          const snapshotReference = existingInvoice?.fiscal_snapshot?.originalDocument?.reference
          const relatedDocuments = Array.isArray(doc.related_docs) ? doc.related_docs : []
          const relatedInvoiceMismatch = documentType === 'receipt'
            && (!snapshotReference || !relatedInvoiceId
              || existingInvoice.related_invoice_id !== relatedInvoiceId
              || relatedDocuments.length !== 1
              || relatedDocuments[0]?.number !== snapshotReference)
          const storedTotal = Number(existingInvoice.total)
          const remoteTotal = Number(doc.amount_gross)
          if (!localKey || existingInvoice.fiscal_idempotency_key !== localKey
            || (documentType === 'receipt' && (!paymentId || !saleId
              || existingInvoice.payment_id !== paymentId || existingInvoice.sale_id !== saleId))
            || (documentType !== 'receipt' && (!saleId || existingInvoice.sale_id !== saleId))
            || documentStatus !== 'N'
            || !Number.isFinite(storedTotal) || !Number.isFinite(remoteTotal)
            || Math.abs(storedTotal - remoteTotal) > 0.005
            || !doc.date || existingInvoice.date !== doc.date
            || relatedInvoiceMismatch
            || (paymentRecord?.invoice_reference && paymentRecord.invoice_reference !== identity.reference)
            || (paymentRecord?.invoicexpress_id && paymentRecord.invoicexpress_id !== identity.id)) {
            throw new Error('Vendus reconciliation requires manual review')
          }
        }

        // A queued local issue may still be in flight. Never import it as a
        // second row; only a confirmed and stale/ambiguous issue is reconciled.
        if (existingInvoice && !needsReconciliation
          && !['issued', 'legacy', 'void'].includes(existingInvoice.processing_status)) {
          console.warn('[sync-invoices] vendus_local_issue_in_progress', organizationId, documentId)
          continue
        }

        let pdfPath: string | null = existingInvoice?.pdf_path || null
        if (!pdfPath) {
          try {
            const pdf = await getVendusPdf(apiKey, identity.id)
            const path = `${organizationId}/vendus_${documentType}_${identity.id}.pdf`
            const { error: uploadError } = await supabase.storage.from('invoices')
              .upload(path, pdf, { contentType: 'application/pdf', upsert: true })
            if (uploadError) throw uploadError
            pdfPath = path
          } catch (error) {
            if (error instanceof VendusError && error.status === 429) throw error
            console.warn('[sync-invoices] vendus_pdf_unavailable', organizationId, documentId)
          }
        }

        const now = new Date().toISOString()
        const status = documentStatus === 'A' ? 'cancelled' : 'final'
        const commonData: Record<string, unknown> = {
          reference: identity.reference,
          status,
          client_name: doc.client?.name || null,
          raw_data: { ...doc, source: 'vendus' },
          updated_at: now,
        }
        if (pdfPath) commonData.pdf_path = pdfPath
        if (!existingInvoice?.provider_atcud && identity.atcud) commonData.provider_atcud = identity.atcud
        if (documentStatus === 'A' && existingInvoice?.processing_status === 'issued') {
          commonData.processing_status = 'void'
        }

        if (existingInvoice) {
          if (!existingInvoice.invoicexpress_id) commonData.invoicexpress_id = identity.id
          if (needsReconciliation) {
            commonData.provider_document_type_code = identity.type
            commonData.provider_series = identity.series
            commonData.provider_document_number = identity.number
            commonData.processing_status = 'issued'
            commonData.processing_last_error = pdfPath ? null : 'pdf_unavailable'
            commonData.processing_claim_token = null
            commonData.processing_claimed_at = null
            commonData.issued_at = now
            commonData.reconciled_at = now
          } else if (existingInvoice.processing_status === 'legacy') {
            commonData.provider_document_type_code = identity.type
            if (!existingInvoice.provider_series) commonData.provider_series = identity.series
            if (!existingInvoice.provider_document_number) commonData.provider_document_number = identity.number
            commonData.total = Number(doc.amount_gross || 0)
            commonData.date = doc.date || null
            commonData.due_date = doc.date_due || null
            if (saleId && !existingInvoice.sale_id) commonData.sale_id = saleId
            if (paymentId && !existingInvoice.payment_id) commonData.payment_id = paymentId
            if (relatedInvoiceId && !existingInvoice.related_invoice_id) {
              commonData.related_invoice_id = relatedInvoiceId
            }
          }
          const { error } = await supabase.from('invoices').update(commonData)
            .eq('id', existingInvoice.id).eq('organization_id', organizationId)
          if (error) throw error

        } else {
          const invoiceData: Record<string, unknown> = {
            ...commonData,
            organization_id: organizationId,
            provider: 'vendus',
            invoicexpress_id: identity.id,
            fiscal_idempotency_key: `sync:vendus:${identity.type}:${identity.id}`,
            provider_document_type_code: identity.type,
            provider_series: identity.series,
            provider_document_number: identity.number,
            document_type: documentType,
            total: Number(doc.amount_gross || 0),
            date: doc.date || null,
            due_date: doc.date_due || null,
          }
          if (saleId) invoiceData.sale_id = saleId
          if (paymentId) invoiceData.payment_id = paymentId
          if (relatedInvoiceId) invoiceData.related_invoice_id = relatedInvoiceId
          const { error } = await supabase.from('invoices').upsert(invoiceData, {
            onConflict: 'organization_id,fiscal_idempotency_key',
          })
          if (error) throw error
        }

        if (documentType !== 'receipt' && saleId && documentStatus === 'N') {
          await linkVendusSale(supabase, organizationId, saleId, identity, pdfPath, doc.amount_gross)
        }

        if (documentType === 'receipt' && documentStatus === 'A') {
          // Keep the cancelled RG in the fiscal ledger, but remove only the
          // denormalized payment pointer that still identifies that exact RG.
          const linkedPaymentId = existingInvoice?.payment_id || paymentMatch?.[1]
          if (linkedPaymentId) {
            const { error: unlinkError } = await supabase.from('sale_payments')
              .update({ invoice_reference: null, invoicexpress_id: null, invoice_file_url: null })
              .eq('id', linkedPaymentId).eq('organization_id', organizationId)
              .eq('invoice_reference', identity.reference)
              .eq('invoicexpress_id', identity.id)
            if (unlinkError) throw unlinkError
          }
        }

        // Complete or repair the local payment link after the invoice row is
        // present. A failed link remains retryable on the next sync run.
        if (documentType === 'receipt' && paymentId && saleId && documentStatus === 'N') {
          if ((paymentRecord?.invoice_reference && paymentRecord.invoice_reference !== identity.reference)
            || (paymentRecord?.invoicexpress_id && paymentRecord.invoicexpress_id !== identity.id)) {
            throw new Error('Vendus receipt conflicts with payment link')
          }
          const paymentUpdate: Record<string, unknown> = {
            invoice_reference: identity.reference,
            invoicexpress_id: identity.id,
          }
          if (pdfPath) paymentUpdate.invoice_file_url = pdfPath
          let paymentUpdateQuery = supabase.from('sale_payments')
            .update(paymentUpdate)
            .eq('id', paymentId).eq('sale_id', saleId).eq('organization_id', organizationId)
          paymentUpdateQuery = paymentRecord?.invoice_reference
            ? paymentUpdateQuery.eq('invoice_reference', identity.reference)
            : paymentUpdateQuery.is('invoice_reference', null)
          const { data: updatedPayment, error: paymentError } = await paymentUpdateQuery
            .select('id').maybeSingle()
          if (paymentError || !updatedPayment) throw new Error('Vendus receipt payment link failed')
        }

        total++
        if (saleId || paymentId || existingInvoice?.sale_id || existingInvoice?.payment_id) matched++
        else notMatched++
      } catch (error) {
        if (error instanceof VendusError &&
          (error.status === 401 || error.status === 403 || error.status === 429 || error.status >= 500)) throw error
        failed++
        console.error('[sync-invoices] vendus_document_failed', organizationId, documentId,
          error instanceof VendusError ? error.code : 'persistence_error')
      }
    }

    if (summaries.length < perPage) break
    page++
  }

  return { total, matched, not_matched: notMatched, failed }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const body = await req.json()
    const { sync_all, organization_id } = body

    // Mode 1: sync_all - internal cron call
    if (sync_all) {
      // The function accepts public requests for the user-triggered path. The
      // cross-tenant path must always authenticate, even without CRON_SECRET.
      const cronSecret = Deno.env.get('CRON_SECRET')
      const provided = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('key')
      const authorization = req.headers.get('Authorization') || ''
      const bearer = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim()
      if (!((cronSecret && provided === cronSecret)
        || (supabaseServiceKey && bearer === supabaseServiceKey))) {
        return new Response(JSON.stringify({ error: 'Não autorizado' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      console.log('Running sync_all mode for active billing providers...')
      const { data: orgs, error: orgsError } = await supabase
        .from('organizations')
        .select('id, billing_provider, invoicexpress_account_name, invoicexpress_api_key, vendus_api_key')
        .in('billing_provider', ['invoicexpress', 'vendus'])

      const configuredOrgs = orgs?.filter((org: any) => org.billing_provider === 'vendus'
        ? !!org.vendus_api_key
        : !!org.invoicexpress_account_name && !!org.invoicexpress_api_key) || []
      if (orgsError || !configuredOrgs.length) {
        console.log('No organizations with active provider credentials found')
        return new Response(JSON.stringify({ message: 'No organizations to sync' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      let totalResults = { total: 0, matched: 0, not_matched: 0, failed: 0, orgs_processed: 0, orgs_failed: 0 }
      for (const org of configuredOrgs) {
        try {
          const result = org.billing_provider === 'vendus'
            ? await syncVendusOrganization(supabase, org.id, org.vendus_api_key)
            : await syncOrganization(supabase, org.id, org)
          totalResults.total += result.total
          totalResults.matched += result.matched
          totalResults.not_matched += result.not_matched
          totalResults.failed += 'failed' in result ? Number(result.failed) : 0
          totalResults.orgs_processed++
        } catch (e) {
          totalResults.orgs_failed++
          console.error('[sync-invoices] organization_failed', org.id,
            e instanceof VendusError ? e.code : 'unexpected_error')
        }
      }

      console.log('sync_all complete:', totalResults)
      return new Response(JSON.stringify(totalResults), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Mode 2: single org sync (user-triggered)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const mfaResponse = await requestMfaResponse(req, user.id, corsHeaders);
    if (mfaResponse) return mfaResponse;

    if (!organization_id) {
      return new Response(JSON.stringify({ error: 'organization_id é obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: membership } = await supabase
      .from('organization_members')
      .select('id')
      .eq('user_id', user.id)
      .eq('organization_id', organization_id)
      .eq('is_active', true)
      .maybeSingle()

    if (!membership) {
      return new Response(JSON.stringify({ error: 'Sem acesso a esta organização' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: org } = await supabase
      .from('organizations')
      .select('billing_provider, invoicexpress_account_name, invoicexpress_api_key, vendus_api_key')
      .eq('id', organization_id)
      .single()

    if (org?.billing_provider === 'vendus') {
      if (!org.vendus_api_key) {
        return new Response(JSON.stringify({ error: 'Chave API Vendus não configurada' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const result = await syncVendusOrganization(supabase, organization_id, org.vendus_api_key)
      return new Response(JSON.stringify(result), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (org?.billing_provider !== 'invoicexpress') {
      return new Response(JSON.stringify({ error: 'Sincronização de faturas não disponível para este fornecedor' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!org?.invoicexpress_account_name || !org?.invoicexpress_api_key) {
      return new Response(JSON.stringify({ error: 'Credenciais InvoiceXpress não configuradas' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const result = await syncOrganization(supabase, organization_id, org)

    return new Response(JSON.stringify(result), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    if (err instanceof VendusError) {
      console.error('[sync-invoices] vendus_error', err.code)
      return new Response(JSON.stringify({ error: err.message, code: err.code }), {
        status: err.status === 429 ? 429 : err.status === 401 || err.status === 403 ? 502 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    console.error('[sync-invoices] unexpected_error', err)
    return new Response(JSON.stringify({ error: 'Erro interno do servidor' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
