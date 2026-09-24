import { requestMfaResponse } from "../_shared/user-authorization.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  documentIdentityFromRawData,
  getKeyInvoicePdf,
  getKeyInvoiceSession,
  safeKeyInvoiceError,
} from '../_shared/keyinvoice.ts'
import {
  getVendusPdf,
  parseVendusIdentity,
  vendusRequest,
  VendusError,
} from '../_shared/vendus.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function fetchKeyInvoicePdf(
  supabase: any,
  org: any,
  orgId: string,
  invoiceRecord: any
): Promise<{ storagePath: string | null; signedUrl: string | null }> {
  try {
    const identity = documentIdentityFromRawData(invoiceRecord.raw_data, {
      docType: invoiceRecord.provider_document_type_code,
      docNum: invoiceRecord.provider_document_number ?? invoiceRecord.invoicexpress_id,
    })
    const session = await getKeyInvoiceSession(supabase, org, orgId)
    const pdf = await getKeyInvoicePdf(session, identity)
    const safeType = identity.docType.replace(/[^A-Za-z0-9_-]/g, '_')
    const safeSeries = (identity.docSeries || 'default').replace(/[^A-Za-z0-9_-]/g, '_')
    const safeNumber = identity.docNum.replace(/[^A-Za-z0-9_-]/g, '_')
    const pdfFileName = `${orgId}/keyinvoice_${safeType}-${safeSeries}-${safeNumber}.pdf`

    const { error: uploadError } = await supabase.storage
      .from('invoices')
      .upload(pdfFileName, pdf, { contentType: 'application/pdf', upsert: true })

    if (uploadError) {
      console.error('[get-invoice-details] keyinvoice_pdf_upload_failed')
      return { storagePath: null, signedUrl: null }
    }

    // Update invoices table with pdf_path
    const { error: updateError } = await supabase
      .from('invoices')
      .update({ pdf_path: pdfFileName })
      .eq('id', invoiceRecord.id)
      .eq('organization_id', orgId)
    if (updateError) return { storagePath: null, signedUrl: null }

    // Generate signed URL
    const { data: signedData } = await supabase.storage
      .from('invoices')
      .createSignedUrl(pdfFileName, 3600)

    return { storagePath: pdfFileName, signedUrl: signedData?.signedUrl || null }
  } catch (e) {
    console.error('[get-invoice-details] keyinvoice_pdf_failed', safeKeyInvoiceError(e).code)
    return { storagePath: null, signedUrl: null }
  }
}

const TYPE_MAP: Record<string, { endpoint: string; responseKey: string }> = {
  invoice: { endpoint: 'invoices', responseKey: 'invoice' },
  invoice_receipt: { endpoint: 'invoice_receipts', responseKey: 'invoice_receipt' },
  receipt: { endpoint: 'receipts', responseKey: 'receipt' },
  credit_note: { endpoint: 'credit_notes', responseKey: 'credit_note' },
}

async function pollWithRetry(url: string, extractor: (data: any) => string | null, attempts = 3, delayMs = 2000): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } })
      if (res.status === 200) {
        const data = await res.json()
        const value = extractor(data)
        if (value) return value
      }
      if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs))
    } catch {
      console.warn('[get-invoice-details] pdf_poll_failed', i + 1)
      if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs))
    }
  }
  return null
}

async function downloadAndUploadPdf(
  supabase: any,
  pdfUrl: string,
  storagePath: string
): Promise<string | null> {
  try {
    const pdfRes = await fetch(pdfUrl)
    if (!pdfRes.ok) {
      console.warn('[get-invoice-details] pdf_download_failed', pdfRes.status)
      return null
    }
    const pdfBlob = await pdfRes.blob()
    const arrayBuffer = await pdfBlob.arrayBuffer()
    const uint8 = new Uint8Array(arrayBuffer)

    const { error: uploadError } = await supabase.storage
      .from('invoices')
      .upload(storagePath, uint8, {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (uploadError) {
      console.error('[get-invoice-details] pdf_upload_failed')
      return null
    }
    return storagePath
  } catch {
    console.error('[get-invoice-details] pdf_download_or_upload_failed')
    return null
  }
}

async function ensurePdfInStorage(
  supabase: any,
  baseUrl: string,
  apiKey: string,
  documentId: number,
  documentType: string,
  organizationId: string
): Promise<{ storagePath: string | null; signedUrl: string | null }> {
  const fileName = `${organizationId}/${documentType}_${documentId}.pdf`

  // Check if PDF already exists in storage
  const { data: existing } = await supabase.storage
    .from('invoices')
    .list(organizationId, { search: `${documentType}_${documentId}.pdf` })

  const fileExists = existing && existing.length > 0 && existing.some((f: any) => f.name === `${documentType}_${documentId}.pdf`)

  if (fileExists) {
    // Generate signed URL
    const { data: signedData } = await supabase.storage
      .from('invoices')
      .createSignedUrl(fileName, 3600) // 1 hour
    return { storagePath: fileName, signedUrl: signedData?.signedUrl || null }
  }

  // PDF doesn't exist - download from InvoiceXpress
  const pdfTempUrl = await pollWithRetry(
    `${baseUrl}/api/pdf/${documentId}.json?api_key=${apiKey}`,
    (data) => data?.output?.pdfUrl || null
  )

  if (!pdfTempUrl) {
    return { storagePath: null, signedUrl: null }
  }

  const storagePath = await downloadAndUploadPdf(supabase, pdfTempUrl, fileName)
  if (!storagePath) {
    return { storagePath: null, signedUrl: null }
  }

  // Generate signed URL
  const { data: signedData } = await supabase.storage
    .from('invoices')
    .createSignedUrl(storagePath, 3600)

  return { storagePath, signedUrl: signedData?.signedUrl || null }
}

function buildTaxSummary(items: any[]): Array<{ name: string; rate: number; incidence: number; value: number }> {
  const taxMap = new Map<string, { name: string; rate: number; incidence: number; value: number }>()
  for (const item of items) {
    if (!item.tax) continue
    const key = `${item.tax.name || 'IVA'}-${item.tax.value || 0}`
    const existing = taxMap.get(key)
    if (existing) {
      existing.incidence += Number(item.subtotal || 0)
      existing.value += Number(item.tax_amount || 0)
    } else {
      taxMap.set(key, {
        name: item.tax.name || 'IVA',
        rate: Number(item.tax.value || 0),
        incidence: Number(item.subtotal || 0),
        value: Number(item.tax_amount || 0),
      })
    }
  }
  return Array.from(taxMap.values())
}

const VENDUS_TYPES: Record<string, string> = {
  invoice: 'FT',
  invoice_receipt: 'FR',
  receipt: 'RG',
}

function vendusNumber(value: unknown): number {
  const result = Number(value)
  return Number.isFinite(result) ? result : 0
}

function vendusObject(value: any): any {
  return Array.isArray(value) ? value[0] || {} : value || {}
}

function vendusStatus(value: any): string {
  const status = vendusObject(value)
  return typeof status === 'string' ? status : String(status.id || '')
}

async function ensureVendusPdfInStorage(
  supabase: any,
  apiKey: string,
  organizationId: string,
  documentId: number,
  documentType: string,
  invoiceRecord: any,
): Promise<{ storagePath: string | null; signedUrl: string | null }> {
  let storagePath: string | null = typeof invoiceRecord?.pdf_path === 'string'
    && invoiceRecord.pdf_path.startsWith(`${organizationId}/`)
    ? invoiceRecord.pdf_path : null
  if (storagePath) {
    const { data } = await supabase.storage.from('invoices').createSignedUrl(storagePath, 3600)
    if (data?.signedUrl) return { storagePath, signedUrl: data.signedUrl }
  }

  const pdf = await getVendusPdf(apiKey, documentId)
  storagePath = `${organizationId}/vendus_${documentType}_${documentId}.pdf`
  const { error: uploadError } = await supabase.storage
    .from('invoices')
    .upload(storagePath, pdf, { contentType: 'application/pdf', upsert: true })
  if (uploadError) throw new Error('Não foi possível guardar o PDF da Vendus')

  if (invoiceRecord) {
    const { error: updateError } = await supabase.from('invoices')
      .update({ pdf_path: storagePath })
      .eq('id', invoiceRecord.id)
      .eq('organization_id', organizationId)
    if (updateError) throw updateError
  }

  const { data: signedData } = await supabase.storage.from('invoices').createSignedUrl(storagePath, 3600)
  return { storagePath, signedUrl: signedData?.signedUrl || null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const token = authHeader.replace('Bearer ', '')
    if (token === supabaseServiceKey) return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const mfaResponse = await requestMfaResponse(req, user.id, corsHeaders);
    if (mfaResponse) return mfaResponse;

    const { invoice_id, document_id, document_type, organization_id, sync, sale_id, payment_id } = await req.json()

    if ((!invoice_id && (document_id === null || document_id === undefined)) || !document_type || !organization_id) {
      return new Response(JSON.stringify({ error: 'invoice_id (ou document_id), document_type e organization_id são obrigatórios' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const typeConfig = TYPE_MAP[document_type]
    if (!typeConfig) {
      return new Response(JSON.stringify({ error: `Tipo de documento inválido: ${document_type}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Verify membership
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

    const { data: canView, error: permissionError } = await supabase.rpc('has_module_permission', {
      _user_id: user.id,
      _org_id: organization_id,
      _module: 'finance',
      _subarea: 'invoices',
      _action: 'view',
    })
    if (permissionError || canView !== true) {
      return new Response(JSON.stringify({ error: 'Sem permissão para consultar documentos fiscais' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get org credentials
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('invoicexpress_account_name, invoicexpress_api_key, billing_provider, vendus_api_key, keyinvoice_password, keyinvoice_api_url, keyinvoice_sid, keyinvoice_sid_expires_at')
      .eq('id', organization_id)
      .single()
    if (orgError || !org) {
      return new Response(JSON.stringify({ error: 'Não foi possível carregar a configuração de faturação' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Check if this is a KeyInvoice document - return data from DB instead of calling external API
    const isKeyInvoice = org?.billing_provider === 'keyinvoice'
    const isVendus = org?.billing_provider === 'vendus'

    // Also check if the invoice record itself has keyinvoice source
    let invoiceQuery = supabase.from('invoices').select('*').eq('organization_id', organization_id)
    invoiceQuery = invoice_id
      ? invoiceQuery.eq('id', invoice_id)
      : invoiceQuery.eq('invoicexpress_id', document_id).eq('document_type', document_type)
    const { data: invoiceRows, error: invoiceError } = await invoiceQuery.limit(2)
    if (invoiceError) {
      return new Response(JSON.stringify({ error: 'Não foi possível consultar o documento fiscal' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if ((invoiceRows?.length || 0) > 1) {
      return new Response(JSON.stringify({
        error: 'Existem vários documentos com esse número. Selecione o documento pela série.',
        code: 'ambiguous_document_identity',
      }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const invoiceRecord: any = invoiceRows?.[0] || null

    const isKeyInvoiceDoc = invoiceRecord?.provider === 'keyinvoice' || invoiceRecord?.raw_data?.source === 'keyinvoice'
    const isVendusDoc = invoiceRecord?.provider === 'vendus' || invoiceRecord?.raw_data?.source === 'vendus'
    if (isKeyInvoice && !invoiceRecord) {
      return new Response(JSON.stringify({ error: 'Documento KeyInvoice não encontrado na base de dados' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (isKeyInvoiceDoc) {
      // For KeyInvoice documents, return data from the invoices table
      if (!invoiceRecord) {
        return new Response(JSON.stringify({ error: 'Documento não encontrado na base de dados' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Get sale details for additional info
      let saleData: any = null
      if (invoiceRecord.sale_id) {
        const { data: sale } = await supabase
          .from('sales')
          .select('*, sale_items(*)')
          .eq('id', invoiceRecord.sale_id)
          .maybeSingle()
        saleData = sale
      }

      // Get client details
      let clientData: any = null
      if (saleData?.client_id) {
        const { data: client } = await supabase
          .from('crm_clients')
          .select('*')
          .eq('id', saleData.client_id)
          .maybeSingle()
        clientData = client
      }

      // Try to fetch PDF from KeyInvoice if not stored yet
      let pdfSignedUrl: string | null = null
      let currentPdfPath = invoiceRecord.pdf_path

      if (!currentPdfPath && org?.keyinvoice_password) {
        const pdfResult = await fetchKeyInvoicePdf(supabase, org, organization_id, invoiceRecord)
        if (pdfResult.storagePath) {
          currentPdfPath = pdfResult.storagePath
          pdfSignedUrl = pdfResult.signedUrl
        }
      }

      if (currentPdfPath && !pdfSignedUrl) {
        const { data: signedData } = await supabase.storage
          .from('invoices')
          .createSignedUrl(currentPdfPath, 3600)
        pdfSignedUrl = signedData?.signedUrl || null
      }

      const identity = documentIdentityFromRawData(invoiceRecord.raw_data, {
        docType: invoiceRecord.provider_document_type_code,
        docNum: invoiceRecord.provider_document_number ?? invoiceRecord.invoicexpress_id,
      })
      const fiscalSnapshot = invoiceRecord.fiscal_snapshot || invoiceRecord.raw_data?.snapshot || {}
      const snapshotLines = Array.isArray(fiscalSnapshot.lines) ? fiscalSnapshot.lines : []
      const isReceipt = invoiceRecord.document_type === 'receipt'
      let displayTotal = Number(invoiceRecord.total || fiscalSnapshot.amount || 0)
      if (isReceipt && payment_id) {
        const { data: paymentRecord, error: paymentError } = await supabase
          .from('sale_payments')
          .select('amount')
          .eq('id', payment_id)
          .eq('organization_id', organization_id)
          .maybeSingle()
        if (paymentError) throw paymentError
        if (paymentRecord?.amount) {
          displayTotal = Number(paymentRecord.amount)
        }
      }

      let items: any[]
      if (isReceipt) {
        // Receipt: show a single line with the payment amount
        items = [{
          name: 'Liquidação de pagamento',
          description: invoiceRecord.reference || '',
          unit_price: String(displayTotal),
          quantity: '1',
          tax: null,
          discount: 0,
          subtotal: displayTotal,
          tax_amount: 0,
          total: displayTotal,
        }]
      } else if (snapshotLines.length > 0) {
        items = snapshotLines.map((line: any) => {
          const quantity = Number(line.quantity || 0)
          const taxRate = Number(line.taxRate ?? line.taxValue ?? 0)
          const hasBilledUnitPrice = line.billedUnitPrice !== null && line.billedUnitPrice !== undefined
          let unitPrice = Number(hasBilledUnitPrice ? line.billedUnitPrice : line.unitPrice ?? line.originalUnitPrice ?? 0)
          if (!hasBilledUnitPrice && Boolean(line.priceIncludesVat ?? line.pricesIncludeTax) && taxRate > 0) {
            unitPrice /= 1 + taxRate / 100
          }
          const subtotal = Math.round(unitPrice * quantity * 100) / 100
          const taxAmount = Math.round(subtotal * taxRate) / 100
          return {
            name: line.description || line.name || 'Serviço',
            description: line.description || line.name || '',
            unit_price: String(unitPrice),
            quantity: String(quantity),
            tax: { name: taxRate === 0 ? 'IVA isento' : 'IVA', value: taxRate },
            discount: Number(line.discountPercent ?? line.discount_percent ?? 0),
            subtotal,
            tax_amount: taxAmount,
            total: Number(line.sourceLineTotal ?? line.source_line_total ?? subtotal + taxAmount),
            tax_exemption_reason: line.taxExemptionReason ?? line.tax_exemption_reason ?? null,
          }
        })
      } else {
        // Legacy documents created before immutable snapshots keep a read-only
        // fallback. Newly issued documents render their frozen fiscal data.
        items = (saleData?.sale_items || []).map((item: any) => ({
          name: item.name,
          description: item.name || '',
          unit_price: String(item.unit_price),
          quantity: String(item.quantity),
          tax: item.tax_value === null || item.tax_value === undefined ? null : { name: 'IVA', value: Number(item.tax_value) },
          discount: Number(item.discount_percent || 0),
          subtotal: Number(item.total || 0),
          tax_amount: 0,
          total: Number(item.total || 0),
        }))
      }

      const beforeTaxes = items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0)
      const taxes = items.reduce((sum, item) => sum + Number(item.tax_amount || 0), 0)
      const discount = items.reduce((sum, item) => {
        const quantity = Number(item.quantity || 0)
        const unit = Number(item.unit_price || 0)
        return sum + unit * quantity * Number(item.discount || 0) / 100
      }, 0)
      const snapshotClient = fiscalSnapshot.client || null
      const responseClient = snapshotClient || clientData

      const result = {
        id: invoiceRecord.invoicexpress_id,
        status: invoiceRecord.status || 'final',
        sequence_number: invoiceRecord.reference,
        provider_identity: identity,
        atcud: invoiceRecord.provider_atcud || identity.atcud,
        date: invoiceRecord.date,
        due_date: invoiceRecord.due_date,
        permalink: null,
        sum: displayTotal,
        discount,
        before_taxes: beforeTaxes || displayTotal,
        taxes,
        total: displayTotal,
        retention: Number(fiscalSnapshot.retentionRate ?? fiscalSnapshot.retention ?? 0),
        currency: fiscalSnapshot.currency || 'EUR',
        tax_exemption: fiscalSnapshot.taxExemptionReason || null,
        observations: fiscalSnapshot.observations || fiscalSnapshot.comments || null,
        mb_reference: null,
        cancel_reason: null,
        qr_code_url: null,
        pdf_url: currentPdfPath,
        pdf_signed_url: pdfSignedUrl,
        owner: null,
        client: responseClient ? {
          id: 0,
          name: responseClient.name || responseClient.company,
          fiscal_id: responseClient.vatin || responseClient.nif || '',
          country: responseClient.countryCode || responseClient.country || 'PT',
          address: responseClient.address || responseClient.address_line1 || null,
          postal_code: responseClient.postalCode || responseClient.postal_code || null,
          city: responseClient.locality || responseClient.city || null,
          email: responseClient.email || null,
          phone: responseClient.phone || null,
        } : invoiceRecord.client_name ? {
          id: 0,
          name: invoiceRecord.client_name,
          fiscal_id: '',
          country: 'PT',
          address: null,
          postal_code: null,
          city: null,
          email: null,
          phone: null,
        } : null,
        items,
        tax_summary: buildTaxSummary(items),
        source: 'keyinvoice',
      }

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (isVendusDoc || (isVendus && !invoiceRecord)) {
      if (!VENDUS_TYPES[document_type]) {
        return new Response(JSON.stringify({ error: 'Tipo de documento Vendus não suportado' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (!org.vendus_api_key) {
        return new Response(JSON.stringify({ error: 'Chave API Vendus não configurada' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const vendusId = Number(invoiceRecord?.invoicexpress_id ?? document_id)
      if (!Number.isSafeInteger(vendusId) || vendusId <= 0) {
        return new Response(JSON.stringify({ error: 'Identificador Vendus inválido' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const doc = await vendusRequest<Record<string, any>>(
        org.vendus_api_key, `/documents/${vendusId}/?mode=normal&return_qrcode=1`,
      )
      const identity = parseVendusIdentity(doc)
      const documentStatus = vendusStatus(doc.status)
      if (!['N', 'A', 'F'].includes(documentStatus)) {
        throw new VendusError('A Vendus devolveu um estado de documento inesperado', 502, 'invalid_document_status')
      }
      if (identity.type !== VENDUS_TYPES[document_type] ||
        (invoiceRecord?.document_type && invoiceRecord.document_type !== document_type) ||
        (invoiceRecord?.provider_document_type_code && invoiceRecord.provider_document_type_code !== identity.type) ||
        (invoiceRecord?.provider_series && invoiceRecord.provider_series !== identity.series) ||
        (invoiceRecord?.provider_document_number && invoiceRecord.provider_document_number !== identity.number)) {
        return new Response(JSON.stringify({ error: 'A identidade do documento Vendus não corresponde ao registo selecionado' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      let pdfPath: string | null = invoiceRecord?.pdf_path || null
      let pdfSignedUrl: string | null = null
      try {
        const pdf = await ensureVendusPdfInStorage(
          supabase, org.vendus_api_key, organization_id, vendusId, document_type, invoiceRecord,
        )
        pdfPath = pdf.storagePath
        pdfSignedUrl = pdf.signedUrl
      } catch (error) {
        console.error('[get-invoice-details] vendus_pdf_failed', error instanceof VendusError ? error.code : 'storage_error')
      }

      const rawItems = Array.isArray(doc.items) ? doc.items : []
      const items = rawItems.map((item: any) => {
        // Vendus describes item amounts/discounts as collections. Accounts may
        // return a single object or a one-element array for these values.
        const amounts = vendusObject(item.amounts)
        const discounts = vendusObject(item.discounts)
        const itemTax = vendusObject(item.tax)
        const subtotal = vendusNumber(amounts.net_total)
        const total = vendusNumber(amounts.gross_total)
        return {
          name: item.title || item.reference || 'Artigo',
          description: item.text || '',
          unit_price: String(vendusNumber(amounts.net_unit)),
          quantity: String(vendusNumber(item.qty)),
          tax: item.tax ? { name: 'IVA', value: vendusNumber(itemTax.rate) } : null,
          discount: vendusNumber(discounts.calculated_percentage ?? discounts.percentage),
          subtotal,
          tax_amount: total - subtotal,
          total,
        }
      })
      const total = vendusNumber(doc.amount_gross)
      const beforeTaxes = vendusNumber(doc.amount_net)
      if (document_type === 'receipt' && items.length === 0) {
        items.push({
          name: 'Liquidação de pagamento', description: identity.reference,
          unit_price: String(total), quantity: '1', tax: null,
          discount: 0, subtotal: total, tax_amount: 0, total,
        })
      }
      const taxSummary = Array.isArray(doc.taxes) && doc.taxes.length > 0
        ? doc.taxes.map((tax: any) => ({
          name: 'IVA', rate: vendusNumber(tax.rate),
          incidence: vendusNumber(tax.base), value: vendusNumber(tax.amount),
        }))
        : buildTaxSummary(items)
      const taxAmount = taxSummary.reduce((sum: number, tax: any) => sum + tax.value, 0)
      const discount = vendusNumber(doc.discounts?.total ?? doc.discounts?.amount)
      const client = doc.client || null
      const qrSvg = typeof doc.qrcode === 'string' && doc.qrcode.trim().startsWith('<svg')
        ? doc.qrcode.trim() : null
      const result = {
        id: identity.id,
        status: documentStatus === 'A' ? 'cancelled' : 'final',
        sequence_number: identity.reference,
        provider_identity: identity,
        atcud: identity.atcud || invoiceRecord?.provider_atcud || null,
        date: doc.date || invoiceRecord?.date || null,
        due_date: doc.date_due || invoiceRecord?.due_date || null,
        permalink: null,
        sum: beforeTaxes + discount,
        discount,
        before_taxes: beforeTaxes,
        taxes: taxAmount,
        total,
        retention: vendusNumber(vendusObject(doc.irs).amount),
        currency: 'EUR',
        tax_exemption: (() => {
          const tax = rawItems.map((item: any) => vendusObject(item.tax))
            .find((itemTax: any) => itemTax.exemption)
          return tax?.exemption_law || tax?.exemption || null
        })(),
        observations: doc.observations || null,
        mb_reference: vendusObject(doc.multibanco).reference || null,
        cancel_reason: null,
        qr_code_url: qrSvg ? `data:image/svg+xml,${encodeURIComponent(qrSvg)}` : null,
        pdf_url: pdfPath,
        pdf_signed_url: pdfSignedUrl,
        owner: null,
        client: client ? {
          id: vendusNumber(client.id),
          name: client.name || '',
          fiscal_id: client.fiscal_id || '',
          country: client.country || 'PT',
          address: client.address || null,
          postal_code: client.postalcode || null,
          city: client.city || null,
          email: client.email || null,
          phone: client.phone || null,
        } : null,
        items,
        tax_summary: taxSummary,
        source: 'vendus',
      }

      if (sync && sale_id && pdfPath) {
        if (payment_id) {
          const { error } = await supabase.from('sale_payments')
            .update({ invoice_file_url: pdfPath })
            .eq('id', payment_id).eq('sale_id', sale_id).eq('organization_id', organization_id)
          if (error) throw error
        } else {
          const { error } = await supabase.from('sales')
            .update({ invoice_pdf_url: pdfPath })
            .eq('id', sale_id).eq('organization_id', organization_id)
          if (error) throw error
        }
      }

      return new Response(JSON.stringify(result), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // InvoiceXpress flow
    if (!org?.invoicexpress_account_name || !org?.invoicexpress_api_key) {
      return new Response(JSON.stringify({ error: 'Credenciais InvoiceXpress não configuradas' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const baseUrl = `https://${org.invoicexpress_account_name}.app.invoicexpress.com`
    const apiKey = org.invoicexpress_api_key
    const externalDocumentId = Number(document_id ?? invoiceRecord?.invoicexpress_id)
    if (!Number.isSafeInteger(externalDocumentId) || externalDocumentId <= 0) {
      return new Response(JSON.stringify({ error: 'Identificador externo inválido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 1. Fetch document details
    const detailsUrl = `${baseUrl}/${typeConfig.endpoint}/${externalDocumentId}.json?api_key=${apiKey}`
    const detailsRes = await fetch(detailsUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    })

    if (!detailsRes.ok) {
      try { await detailsRes.text() } catch {}
      console.error('[get-invoice-details] invoicexpress_details_failed', detailsRes.status)
      return new Response(JSON.stringify({ error: `Erro ao obter documento: ${detailsRes.status}` }), {
        status: detailsRes.status === 404 ? 404 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const detailsData = await detailsRes.json()
    const doc = detailsData[typeConfig.responseKey]

    if (!doc) {
      return new Response(JSON.stringify({ error: 'Documento não encontrado na resposta' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch QR code URL
    let qrCodeUrl: string | null = null
    try {
      const qrRes = await fetch(`${baseUrl}/api/qr_codes/${externalDocumentId}.json?api_key=${apiKey}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      })
      if (qrRes.ok) {
        const qrData = await qrRes.json()
        qrCodeUrl = qrData?.qr_code?.url || null
      }
    } catch {
      console.warn('[get-invoice-details] qr_code_fetch_failed')
    }

    // 2. Always ensure PDF is in storage and get signed URL
    const { storagePath, signedUrl: pdfSignedUrl } = await ensurePdfInStorage(
      supabase, baseUrl, apiKey, externalDocumentId, document_type, organization_id
    )

    // Build response
    const result: any = {
      id: doc.id,
      status: doc.status,
      sequence_number: doc.sequence_number || doc.inverted_sequence_number,
      atcud: doc.atcud,
      date: doc.date,
      due_date: doc.due_date,
      permalink: doc.permalink,
      sum: doc.sum,
      discount: doc.discount,
      before_taxes: doc.before_taxes,
      taxes: doc.taxes,
      total: doc.total,
      retention: doc.retention || 0,
      currency: doc.currency,
      tax_exemption: doc.tax_exemption,
      observations: doc.observations || null,
      mb_reference: doc.mb_reference || null,
      cancel_reason: doc.cancel_reason || null,
      qr_code_url: qrCodeUrl,
      pdf_url: storagePath,
      pdf_signed_url: pdfSignedUrl,
      owner: doc.owner ? {
        name: doc.owner.name,
        fiscal_id: doc.owner.fiscal_id,
        address: doc.owner.address,
        postal_code: doc.owner.postal_code,
        city: doc.owner.city,
        country: doc.owner.country,
        email: doc.owner.email,
        phone: doc.owner.phone,
      } : null,
      client: doc.client ? {
        id: doc.client.id,
        name: doc.client.name,
        fiscal_id: doc.client.fiscal_id,
        country: doc.client.country,
        address: doc.client.address || null,
        postal_code: doc.client.postal_code || null,
        city: doc.client.city || null,
        email: doc.client.email || null,
        phone: doc.client.phone || null,
      } : null,
      items: (doc.items || []).map((item: any) => ({
        name: item.name,
        description: item.description,
        unit_price: item.unit_price,
        quantity: item.quantity,
        tax: item.tax,
        discount: item.discount,
        subtotal: item.subtotal,
        tax_amount: item.tax_amount,
        total: item.total,
      })),
      tax_summary: buildTaxSummary(doc.items || []),
    }

    if (doc.bank_info) {
      result.bank_info = doc.bank_info
    }

    // 3. If sync=true, update DB with storage path
    if (sync && sale_id) {
      if (payment_id) {
        const updateData: any = {}
        if (storagePath) updateData.invoice_file_url = storagePath
        if (qrCodeUrl) updateData.qr_code_url = qrCodeUrl

        if (Object.keys(updateData).length > 0) {
          const { error: paymentSyncError } = await supabase
            .from('sale_payments')
            .update(updateData)
            .eq('id', payment_id)
            .eq('sale_id', sale_id)
            .eq('organization_id', organization_id)
          if (paymentSyncError) throw paymentSyncError
        }
      } else {
        const updateData: any = {}
        if (storagePath) updateData.invoice_pdf_url = storagePath
        if (qrCodeUrl) updateData.qr_code_url = qrCodeUrl

        if (Object.keys(updateData).length > 0) {
          const { error: saleSyncError } = await supabase
            .from('sales')
            .update(updateData)
            .eq('id', sale_id)
            .eq('organization_id', organization_id)
          if (saleSyncError) throw saleSyncError
        }
      }
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    if (err instanceof VendusError) {
      console.error('[get-invoice-details] vendus_error', err.code)
      return new Response(JSON.stringify({ error: err.message, code: err.code }), {
        status: err.status === 404 ? 404 : err.status === 429 ? 429 : err.status === 401 || err.status === 403 ? 502 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const safe = safeKeyInvoiceError(err)
    console.error('[get-invoice-details]', safe.code)
    return new Response(JSON.stringify({ error: safe.message, code: safe.code }), {
      status: safe.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
