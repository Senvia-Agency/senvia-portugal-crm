import { requestMfaResponse } from "../_shared/user-authorization.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { issueKeyInvoiceSaleDocument } from '../_shared/keyinvoice-sale-document.ts'
import { issueVendusSaleDocument } from '../_shared/vendus-sale-document.ts'
import { VendusError } from '../_shared/vendus.ts'
import { lisbonFiscalDate, safeKeyInvoiceError } from '../_shared/keyinvoice.ts'
import { userRateLimit } from '../_shared/user-rate-limit.ts'
import { saleBillingRecipient } from '../_shared/sale-billing-recipient.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const COUNTRY_CODE_MAP: Record<string, string> = {
  PT: 'Portugal', ES: 'Espanha', FR: 'França', DE: 'Alemanha', IT: 'Itália',
  GB: 'Reino Unido', US: 'Estados Unidos', BR: 'Brasil', AO: 'Angola', MZ: 'Moçambique',
  CV: 'Cabo Verde', NL: 'Países Baixos', BE: 'Bélgica', CH: 'Suíça', AT: 'Áustria',
  IE: 'Irlanda', LU: 'Luxemburgo', PL: 'Polónia', SE: 'Suécia', DK: 'Dinamarca',
}

function mapCountryToInvoiceXpress(country?: string | null): string {
  if (!country) return 'Portugal'
  const upper = country.trim().toUpperCase()
  if (upper.length === 2 && COUNTRY_CODE_MAP[upper]) {
    return COUNTRY_CODE_MAP[upper]
  }
  return country
}

async function handleKeyInvoice(
  supabase: any,
  org: any,
  saleId: string,
  organizationId: string,
  observations: string | undefined,
  headers: Record<string, string>,
) {
  try {
    const result = await issueKeyInvoiceSaleDocument(supabase, org, {
      organizationId,
      saleId,
      observations,
    })
    return new Response(JSON.stringify({
      success: true,
      already_issued: result.alreadyIssued,
      invoicexpress_id: Number(result.identity.docNum),
      invoice_reference: result.identity.fullDocNumber,
      identity: result.identity,
      invoice_id: result.invoice.id,
    }), { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } })
  } catch (error) {
    const safe = safeKeyInvoiceError(error)
    console.error('[issue-invoice:keyinvoice]', safe.code)
    return new Response(JSON.stringify({
      error: safe.message,
      code: safe.code,
      retryable: safe.retryable,
      manual_review: safe.manual_review,
    }), { status: safe.status, headers: { ...headers, 'Content-Type': 'application/json' } })
  }
}

async function handleVendus(
  supabase: any, org: any, saleId: string, organizationId: string,
  observations: string | undefined, headers: Record<string, string>,
) {
  try {
    const result = await issueVendusSaleDocument(supabase, org, {
      organizationId, saleId, kind: 'invoice', observations,
    })
    return new Response(JSON.stringify({
      success: true,
      already_issued: result.alreadyIssued,
      invoicexpress_id: result.id,
      invoice_reference: result.reference,
      invoice_id: result.invoiceId,
    }), { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } })
  } catch (error) {
    const safe = error instanceof VendusError
      ? { message: error.message, code: error.code, status: error.status }
      : safeKeyInvoiceError(error)
    console.error('[issue-invoice:vendus]', safe.code)
    const manualReview = error instanceof VendusError
      ? ['local_record_failed', 'sale_link_failed', 'sale_link_conflict', 'provider_total_mismatch',
        'remote_outcome_uncertain', 'missing_fiscal_identity', 'document_type_conflict',
        'incomplete_local_document', 'ambiguous_document'].includes(error.code)
      : safeKeyInvoiceError(error).manual_review
    return new Response(JSON.stringify({ error: safe.message, code: safe.code,
      manual_review: manualReview }),
    { status: safe.status, headers: { ...headers, 'Content-Type': 'application/json' } })
  }
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Auth check
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseServiceKey)
    const token = authHeader.replace('Bearer ', '')
    if (token === supabaseServiceKey) return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const mfaResponse = await requestMfaResponse(req, user.id, corsHeaders);
    if (mfaResponse) return mfaResponse;
    const rateLimitResponse = await userRateLimit(supabaseAuth, user.id, 'issue-invoice', corsHeaders)
    if (rateLimitResponse) return rateLimitResponse

    const { sale_id, organization_id, observations } = await req.json()
    if (!sale_id || !organization_id) {
      return new Response(JSON.stringify({ error: 'sale_id e organization_id são obrigatórios' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Verify user is member of org
    const { data: membership } = await supabase
      .from('organization_members')
      .select('id')
      .eq('user_id', user.id)
      .eq('organization_id', organization_id)
      .eq('is_active', true)
      .maybeSingle()

    if (!membership) {
      return new Response(JSON.stringify({ error: 'Sem acesso a esta organização' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: canIssue, error: permissionError } = await supabase.rpc('has_module_permission', {
      _user_id: user.id,
      _org_id: organization_id,
      _module: 'finance',
      _subarea: 'invoices',
      _action: 'issue',
    })
    if (permissionError || canIssue !== true) {
      return new Response(JSON.stringify({ error: 'Sem permissão para emitir documentos fiscais' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch organization credentials
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('invoicexpress_account_name, invoicexpress_api_key, integrations_enabled, tax_config, billing_provider, keyinvoice_password, keyinvoice_api_url, keyinvoice_sid, keyinvoice_sid_expires_at, keyinvoice_series_config, vendus_api_key')
      .eq('id', organization_id)
      .single()

    if (orgError || !org) {
      return new Response(JSON.stringify({ error: 'Não foi possível carregar a configuração de faturação' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const billingProvider = (org as any)?.billing_provider || 'invoicexpress'
    const integrationsEnabled = (org?.integrations_enabled as Record<string, boolean> | null) || {}
    
    // Check if the ACTIVE billing provider is enabled
    const activeBillingToggle = billingProvider === 'keyinvoice' ? 'keyinvoice' : billingProvider === 'vendus' ? 'vendus' : 'invoicexpress'
    if (integrationsEnabled[activeBillingToggle] === false) {
      return new Response(JSON.stringify({ error: 'Integração de faturação desativada' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Route to KeyInvoice if selected
    if (billingProvider === 'keyinvoice') {
      return await handleKeyInvoice(supabase, org, sale_id, organization_id, observations, corsHeaders)
    }

    if (billingProvider === 'vendus') {
      return await handleVendus(supabase, org, sale_id, organization_id, observations, corsHeaders)
    }

    if (!org?.invoicexpress_account_name || !org?.invoicexpress_api_key) {
      return new Response(JSON.stringify({ error: 'Credenciais InvoiceXpress não configuradas' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch sale with client
    const { data: sale } = await supabase
      .from('sales')
      .select(`
        *,
        client:crm_clients(name, code, email, nif, company_nif, billing_target, phone, address_line1, address_line2, city, postal_code, country, company, company_address_same_as_client, company_address_line1, company_address_line2, company_city, company_postal_code, company_country),
        lead:leads(name, email, phone)
      `)
      .eq('id', sale_id)
      .eq('organization_id', organization_id)
      .single()

    if (!sale) {
      return new Response(JSON.stringify({ error: 'Venda não encontrada' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Check if invoice already exists for this sale
    if (sale.invoicexpress_id) {
      return new Response(JSON.stringify({ 
        error: 'Fatura já emitida para esta venda', 
        invoice_reference: sale.invoice_reference,
        invoicexpress_id: sale.invoicexpress_id,
      }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const recipient = saleBillingRecipient(sale)
    const { target: billingTarget, name: clientName, nif: clientNif } = recipient
    if (!clientName || !clientNif) {
      return new Response(JSON.stringify({ error: 'O destinatário de faturação selecionado na venda precisa de nome e NIF.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (billingTarget === 'company' && (!recipient.address || !recipient.city || !recipient.postalCode || !recipient.country)) {
      return new Response(JSON.stringify({ error: 'Preencha a morada escolhida para a empresa na ficha do cliente antes de emitir.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Tax configuration (org-level fallback)
    const taxConfig = (org as any)?.tax_config || { tax_name: 'IVA23', tax_value: 23, tax_exemption_reason: null }
    const orgTaxValue = taxConfig.tax_value ?? 23
    const orgTaxExemptionReason = taxConfig.tax_exemption_reason || null

    // Build item with per-item tax support
    const buildItem = (name: string, description: string, unitPrice: number, quantity: number, itemTaxValue?: number | null, itemTaxExemptionReason?: string | null) => {
      const effectiveTaxValue = (itemTaxValue !== null && itemTaxValue !== undefined) ? itemTaxValue : orgTaxValue
      const effectiveTaxName = effectiveTaxValue === 0 ? 'Isento' : `IVA${effectiveTaxValue}`
      const effectiveExemptionReason = effectiveTaxValue === 0 
        ? (itemTaxExemptionReason || orgTaxExemptionReason) 
        : null

      const item: any = {
        name,
        description,
        unit_price: unitPrice,
        quantity,
        tax: { name: effectiveTaxName, value: effectiveTaxValue },
      }
      if (effectiveTaxValue === 0 && effectiveExemptionReason) {
        item.exemption_reason = effectiveExemptionReason
      }
      return item
    }

    // Always emit invoice for the full sale total using sale_items
    let items: any[] = []
    let hasExemptItem = false
    let firstExemptionReason: string | null = null

    const { data: saleItems } = await supabase
      .from('sale_items')
      .select('*, product:products(tax_value, tax_exemption_reason)')
      .eq('sale_id', sale_id)

    items = (saleItems || []).map((item: any) => {
      const productTaxValue = item.product?.tax_value ?? null
      const productTaxExemptionReason = item.product?.tax_exemption_reason ?? null
      const effectiveTax = (productTaxValue !== null && productTaxValue !== undefined) ? productTaxValue : orgTaxValue
      if (effectiveTax === 0) {
        hasExemptItem = true
        if (!firstExemptionReason) {
          firstExemptionReason = productTaxExemptionReason || orgTaxExemptionReason
        }
      }
      return buildItem(item.name, item.name, Number(item.unit_price), Number(item.quantity), productTaxValue, productTaxExemptionReason)
    })

    if (items.length === 0) {
      items.push(buildItem('Serviço', `Venda ${sale.code || sale_id}`, Number(sale.total_value), 1))
      if (orgTaxValue === 0) {
        hasExemptItem = true
        firstExemptionReason = orgTaxExemptionReason
      }
    }

    // Validate exemption reason
    if (hasExemptItem && !firstExemptionReason) {
      return new Response(JSON.stringify({ 
        error: 'Configure o motivo de isenção de IVA no produto ou nas Definições → Integrações → InvoiceXpress antes de emitir faturas.' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Date
    const todayStr = lisbonFiscalDate()
    let dateSource = todayStr

    const accountName = org.invoicexpress_account_name
    const apiKey = org.invoicexpress_api_key
    const baseUrl = `https://${accountName}.app.invoicexpress.com`

    // Check last invoice date for chronological order
    try {
      const listRes = await fetch(`${baseUrl}/invoices.json?api_key=${apiKey}&page=1&per_page=1`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
      if (listRes.ok) {
        const listData = await listRes.json()
        const docs = listData.invoices || []
        if (Array.isArray(docs) && docs.length > 0) {
          const lastDateStr = docs[0]?.date
          if (lastDateStr) {
            const [ld, lm, ly] = lastDateStr.split('/')
            const lastDateISO = `${ly}-${lm}-${ld}`
            if (dateSource < lastDateISO) {
              console.warn(`Date ${dateSource} is before last invoice date ${lastDateISO}. Adjusting.`)
              dateSource = lastDateISO
            }
          }
        }
      }
    } catch (e) {
      console.warn('Could not check last invoice date, proceeding with current date:', e)
    }

    const [y, m, d] = dateSource.split('-')
    const formattedDate = `${d}/${m}/${y}`

    const clientCode = billingTarget === 'company' ? clientNif : (sale.client?.code || clientNif)
    const proprietary_uid = `senvia-sale-${sale_id}`

    // Build observations from payments if not provided by frontend
    let finalObservations = observations || ''
    if (!finalObservations) {
      const { data: salePayments } = await supabase
        .from('sale_payments')
        .select('amount, payment_date, status')
        .eq('sale_id', sale_id)
        .order('payment_date', { ascending: true })
      
      if (salePayments && salePayments.length > 1) {
        finalObservations = `Pagamento em ${salePayments.length} parcelas:\n\n` +
          salePayments.map((p: any, i: number) => {
            const d = new Date(p.payment_date)
            const dateStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
            return `- ${i + 1}.ª parcela: ${Number(p.amount).toFixed(2)} EUR - ${dateStr}`
          }).join('\n\n')
      } else if (salePayments && salePayments.length === 1) {
        const p = salePayments[0]
        const d = new Date(p.payment_date)
        const dateStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
        finalObservations = `Data de pagamento: ${dateStr}`
      }
    }

    // Build InvoiceXpress payload - always invoice type
    const invoicePayload = {
      invoice: {
        date: formattedDate,
        due_date: formattedDate,
        ...(finalObservations ? { observations: finalObservations } : {}),
        ...(hasExemptItem && firstExemptionReason
          ? { tax_exemption: firstExemptionReason }
          : {}),
        client: {
          name: clientName,
          code: clientCode,
          fiscal_id: clientNif,
          email: sale.client?.email || sale.lead?.email || '',
          address: recipient.address,
          city: recipient.city,
          postal_code: recipient.postalCode,
          country: mapCountryToInvoiceXpress(recipient.country),
        },
        items: items,
      },
      proprietary_uid,
    }

    // 1. Create draft
    const createRes = await fetch(`${baseUrl}/invoices.json?api_key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invoicePayload),
    })

    // Handle 409 = duplicate
    if (createRes.status === 409) {
      return new Response(JSON.stringify({ error: 'Fatura já foi criada anteriormente para esta venda.' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!createRes.ok) {
      const errorText = await createRes.text()
      console.error('InvoiceXpress create error:', errorText)
      return new Response(JSON.stringify({ error: `Erro ao criar fatura no InvoiceXpress: ${createRes.status}`, details: errorText }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const createData = await createRes.json()
    const invoiceId = createData.invoice?.id
    const sequentialNumber = createData.invoice?.sequential_number
    const permalink = createData.invoice?.permalink || null

    if (!invoiceId) {
      return new Response(JSON.stringify({ error: 'InvoiceXpress não retornou ID do documento', details: createData }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Finalize
    const finalizeRes = await fetch(`${baseUrl}/invoices/${invoiceId}/change-state.json?api_key=${apiKey}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoice: { state: 'finalized' },
      }),
    })

    if (!finalizeRes.ok) {
      const errorText = await finalizeRes.text()
      console.error('InvoiceXpress finalize error:', errorText)
      return new Response(JSON.stringify({ 
        error: 'Fatura criada mas não finalizada. Finalize manualmente no InvoiceXpress.',
        invoicexpress_id: invoiceId,
        details: errorText,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let invoiceReference = sequentialNumber ? `FT ${sequentialNumber}` : `FT #${invoiceId}`
    try {
      const finalizeData = await finalizeRes.json()
      if (finalizeData.invoice?.sequential_number) {
        invoiceReference = `FT ${finalizeData.invoice.sequential_number}`
      }
    } catch {
      // Use default reference
    }

    // 3. Generate PDF
    let pdfUrl: string | null = null
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const pdfRes = await fetch(`${baseUrl}/api/pdf/${invoiceId}.json?api_key=${apiKey}`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        })
        if (pdfRes.status === 200) {
          const pdfData = await pdfRes.json()
          pdfUrl = pdfData?.output?.pdfUrl || null
          if (pdfUrl) break
        }
        if (pdfRes.status === 202 || !pdfUrl) {
          await new Promise(r => setTimeout(r, 2000))
        }
      }
    } catch (e) {
      console.warn('PDF generation polling failed (non-blocking):', e)
    }

    // Download and store PDF locally
    let storedPdfPath: string | null = null
    if (pdfUrl) {
      try {
        const pdfBinaryRes = await fetch(pdfUrl)
        if (pdfBinaryRes.ok) {
          const pdfBuffer = await pdfBinaryRes.arrayBuffer()
          const pdfFileName = `${organization_id}/${sale_id}/FT-${invoiceId}.pdf`
          const { error: uploadError } = await supabase.storage
            .from('invoices')
            .upload(pdfFileName, pdfBuffer, { contentType: 'application/pdf', upsert: true })
          if (!uploadError) {
            storedPdfPath = pdfFileName
          } else {
            console.warn('PDF upload to storage failed:', uploadError)
          }
        }
      } catch (e) {
        console.warn('PDF download/upload failed (non-blocking):', e)
      }
    }

    // 4. QR Code polling
    let qrCodeUrl: string | null = null
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const qrRes = await fetch(`${baseUrl}/api/qr_codes/${invoiceId}.json?api_key=${apiKey}`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        })
        if (qrRes.status === 200) {
          const qrData = await qrRes.json()
          qrCodeUrl = qrData?.qr_code?.url || null
          if (qrCodeUrl) break
        }
        await new Promise(r => setTimeout(r, 2000))
      }
    } catch (e) {
      console.warn('QR Code polling failed (non-blocking):', e)
    }

    // 5. Save reference in sales table - use local path if available
    const fileUrl = storedPdfPath || pdfUrl || null
    const { error: saleUpdateError } = await supabase
      .from('sales')
      .update({
        invoicexpress_id: invoiceId,
        invoicexpress_type: 'invoices',
        invoice_reference: invoiceReference,
        status: 'delivered',
        ...(fileUrl ? { invoice_pdf_url: fileUrl } : {}),
        ...(qrCodeUrl ? { qr_code_url: qrCodeUrl } : {}),
      })
      .eq('id', sale_id)
      .eq('organization_id', organization_id)
    if (saleUpdateError) {
      return new Response(JSON.stringify({
        error: 'Fatura emitida, mas não foi possível atualizar a venda. É necessária reconciliação.',
        code: 'sale_link_failed',
        manual_review: true,
      }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({
      success: true,
      invoicexpress_id: invoiceId,
      invoice_reference: invoiceReference,
      ...(pdfUrl ? { pdf_url: pdfUrl } : {}),
      ...(qrCodeUrl ? { qr_code_url: qrCodeUrl } : {}),
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Unexpected error:', err)
    return new Response(JSON.stringify({ error: 'Erro interno do servidor' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
