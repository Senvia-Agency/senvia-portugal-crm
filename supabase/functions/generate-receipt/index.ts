import { requestMfaResponse } from "../_shared/user-authorization.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { userRateLimit } from '../_shared/user-rate-limit.ts'
import {
  type KeyInvoiceSession,
  documentIdentityFromRawData,
  documentNumberAsInteger,
  getKeyInvoicePdf,
  getKeyInvoiceSession,
  identityRawData,
  issueKeyInvoiceReceipt,
  lisbonFiscalDate,
  resolveKeyInvoiceClient,
  safeKeyInvoiceError,
} from '../_shared/keyinvoice.ts'
import {
  type VendusIdentity,
  VendusError,
  getVendusPdf,
  parseVendusIdentity,
  vendusRequest,
} from '../_shared/vendus.ts'
import { getVendusPaymentMethods, resolveVendusPaymentMethod } from '../_shared/vendus-payment-methods.ts'
import { saleBillingRecipient } from '../_shared/sale-billing-recipient.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PAYMENT_METHOD_MAP: Record<string, string> = {
  mbway: 'MB',
  transfer: 'TB',
  transferencia: 'TB',
  cash: 'NU',
  card: 'CC',
  credit_card: 'CC',
  debit_card: 'CD',
  check: 'CH',
  cheque: 'CH',
  other: 'OU',
}

function receiptResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function verifiedVendusReceipt(
  apiKey: string, documentId: number, expectedReference: string,
  externalReference: string, amount: number, sourceReference: string,
): Promise<{ document: Record<string, unknown>; identity: VendusIdentity }> {
  const document = await vendusRequest<Record<string, unknown>>(
    apiKey, `/documents/${documentId}/?mode=normal`,
  )
  const identity = parseVendusIdentity(document)
  const remoteStatus = Array.isArray(document.status) ? (document.status[0] as any)?.id
    : typeof document.status === 'object' ? (document.status as any)?.id : document.status
  const related = Array.isArray(document.related_docs) ? document.related_docs : []
  const providerAmount = Number(document.amount_gross)
  if (identity.id !== documentId || identity.reference !== expectedReference
    || identity.type !== 'RG' || document.external_reference !== externalReference
    || remoteStatus !== 'N' || !Number.isFinite(providerAmount)
    || Math.round(providerAmount * 100) !== Math.round(amount * 100)
    || !related.some((entry: any) => entry?.type === 'FT' && entry?.number === sourceReference)) {
    throw new VendusError('O recibo Vendus não corresponde ao pagamento e à Fatura de origem.', 502, 'receipt_document_mismatch')
  }
  return { document, identity }
}

async function handleVendusReceipt(
  supabase: any,
  org: any,
  sale: any,
  payment: any,
  organizationId: string,
  saleId: string,
  paymentId: string,
): Promise<Response> {
  const integrationsEnabled = (org.integrations_enabled as Record<string, boolean> | null) || {}
  if (integrationsEnabled.vendus === false || !org.vendus_api_key?.trim()) {
    return receiptResponse({ error: 'Configure a chave API Vendus antes de emitir recibos.' }, 400)
  }

  const amount = Number(payment.amount)
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
    return receiptResponse({ error: 'O pagamento não tem um valor válido para recibo.' }, 400)
  }

  // A receipt settles a specific issued FT. An FR is already paid and cannot
  // receive an RG. The cycle filter prevents settling an unrelated renewal.
  let invoiceQuery = supabase.from('invoices')
    .select('id,reference,client_name,provider_document_type_code,provider_series,provider_document_number,total,recurring_cycle_id,status,processing_status')
    .eq('organization_id', organizationId)
    .eq('sale_id', saleId)
    .eq('provider', 'vendus')
    .eq('document_type', 'invoice')
    .eq('status', 'final')
    .eq('processing_status', 'issued')
  invoiceQuery = payment.recurring_cycle_id
    ? invoiceQuery.eq('recurring_cycle_id', payment.recurring_cycle_id)
    : invoiceQuery.is('recurring_cycle_id', null)
  const { data: sourceInvoices, error: invoiceError } = await invoiceQuery.limit(2)
  if (invoiceError) return receiptResponse({ error: 'Não foi possível verificar a Fatura Vendus.' }, 500)
  if (!sourceInvoices?.length) {
    return receiptResponse({ error: 'Não existe uma Fatura Vendus emitida para liquidar. Uma Fatura-Recibo não recebe recibos.' }, 409)
  }
  if (sourceInvoices.length !== 1) {
    return receiptResponse({ error: 'Existem várias Faturas Vendus para este pagamento. Confirme a Fatura de origem antes de emitir o recibo.' }, 409)
  }
  const source = sourceInvoices[0]
  const expectedReference = `FT ${source.provider_series}/${source.provider_document_number}`
  if (source.provider_document_type_code !== 'FT' || !source.provider_series
      || !source.provider_document_number || source.reference !== expectedReference) {
    return receiptResponse({ error: 'A Fatura Vendus não tem uma referência fiscal completa.' }, 409)
  }

  // A retry must be able to reconcile an already issued receipt even when
  // payment methods changed in Vendus after the original fiscal POST.
  const { data: priorReceipt, error: priorError } = await supabase.from('invoices')
    .select('id').eq('organization_id', organizationId)
    .eq('fiscal_idempotency_key', `vendus:RG:${paymentId}`).maybeSingle()
  if (priorError) return receiptResponse({ error: 'Não foi possível verificar recibos anteriores.' }, 500)
  let paymentMethodId: number | null = null
  if (!priorReceipt) {
    try {
      const methods = await getVendusPaymentMethods(org.vendus_api_key)
      paymentMethodId = resolveVendusPaymentMethod(payment.payment_method, methods)
    } catch (error) {
      const safe = error instanceof VendusError
        ? error : new VendusError('Não foi possível obter o método de pagamento na Vendus.', 502, 'payment_method_lookup_failed')
      return receiptResponse({ error: safe.message, code: safe.code }, safe.status)
    }
  }

  const txId = `senvia-rg-${paymentId}`
  const externalReference = `senvia-payment-${paymentId}`
  const fiscalDate = lisbonFiscalDate(new Date())
  const clientName = String(source.client_name || saleBillingRecipient(sale).name).trim()
  const snapshot = {
    schemaVersion: 1,
    provider: 'vendus',
    kind: 'receipt',
    fiscalDate,
    currency: 'EUR',
    amount,
    saleId,
    paymentId,
    recurringCycleId: payment.recurring_cycle_id || null,
    originalDocument: {
      id: source.id,
      type: 'FT',
      series: source.provider_series,
      number: source.provider_document_number,
      reference: source.reference,
    },
    payment: {
      status: payment.status,
      amount,
      reversalStatus: String(payment.reversal_status || 'none'),
      reversedAmount: Number(payment.reversed_amount || 0),
    },
    txId,
    externalReference,
    paymentMethodId,
    paymentMethod: payment.payment_method,
  }
  const claimToken = crypto.randomUUID()
  const { data: reservation, error: reservationError } = await supabase.rpc(
    'reserve_manual_vendus_receipt', {
      p_organization_id: organizationId,
      p_sale_id: saleId,
      p_payment_id: paymentId,
      p_related_invoice_id: source.id,
      p_amount: amount,
      p_fiscal_date: fiscalDate,
      p_snapshot: snapshot,
      p_client_name: clientName,
      p_claim_token: claimToken,
    },
  )
  if (reservationError || !reservation?.job_id) {
    const message = reservationError?.message || ''
    if (message.includes('vendus_receipt_amount_exceeds_invoice')) {
      return receiptResponse({ error: 'O recibo excede o valor ainda disponível na Fatura.', code: 'receipt_amount_exceeds_invoice' }, 409)
    }
    if (message.includes('vendus_receipt_payment_not_eligible')) {
      return receiptResponse({ error: 'O pagamento deixou de estar elegível para recibo.', code: 'payment_not_eligible' }, 409)
    }
    if (message.includes('vendus_receipt_source_invoice_invalid')) {
      return receiptResponse({ error: 'A Fatura de origem deixou de estar elegível para recibo.', code: 'source_invoice_invalid' }, 409)
    }
    if (message.includes('vendus_receipt_already_reserved')
        || message.includes('vendus_receipt_idempotency_conflict')) {
      return receiptResponse({ error: 'Já existe um recibo para este pagamento.', code: 'receipt_already_reserved' }, 409)
    }
    console.error('[generate-receipt:vendus] reservation_failed', reservationError?.code)
    return receiptResponse({ error: 'Não foi possível reservar a emissão do recibo. Nenhum pedido foi enviado à Vendus.', code: 'receipt_reservation_failed' }, 500)
  }
  if (reservation.created !== true) {
    if (reservation.processing_status === 'issued') {
      const { data: existing, error: existingError } = await supabase.from('invoices')
        .select('id,reference,invoicexpress_id,related_invoice_id,total,status,pdf_path')
        .eq('id', reservation.job_id).eq('organization_id', organizationId)
        .eq('provider', 'vendus').eq('payment_id', paymentId).maybeSingle()
      const existingId = Number(existing?.invoicexpress_id)
      if (existingError || !existing || existing.status !== 'final'
        || existing.related_invoice_id !== source.id
        || Math.round(Number(existing.total) * 100) !== Math.round(amount * 100)
        || !Number.isSafeInteger(existingId) || existingId <= 0 || !existing.reference) {
        return receiptResponse({ error: 'O recibo anterior exige reconciliação manual.', manual_review: true }, 409)
      }
      try {
        const verified = await verifiedVendusReceipt(
          org.vendus_api_key, existingId, existing.reference,
          externalReference, amount, source.reference,
        )
        const { data: linked, error: linkError } = await supabase.from('sale_payments')
          .update({ invoice_reference: verified.identity.reference,
            invoicexpress_id: existingId,
            ...(existing.pdf_path ? { invoice_file_url: existing.pdf_path } : {}) })
          .eq('id', paymentId).eq('sale_id', saleId)
          .eq('organization_id', organizationId).is('invoice_reference', null)
          .select('id').maybeSingle()
        if (linkError || !linked) throw new VendusError('Falha na associação do recibo ao pagamento.', 500, 'payment_link_failed')
        return receiptResponse({ success: true, already_issued: true,
          receipt_id: existingId, invoice_id: existing.id,
          invoice_reference: verified.identity.reference, identity: verified.identity,
          ...(existing.pdf_path ? { pdf_path: existing.pdf_path } : {}) }, 200)
      } catch (error) {
        console.error('[generate-receipt:vendus] existing_link_failed', error instanceof VendusError ? error.code : 'lookup_error')
        return receiptResponse({ error: 'O recibo existe na Vendus, mas a associação ao pagamento exige reconciliação.',
          manual_review: true }, 409)
      }
    }
    return receiptResponse({
      error: 'A emissão do recibo já foi iniciada e exige reconciliação antes de nova tentativa.',
      invoice_reference: reservation.reference || null,
      manual_review: true,
    }, 409)
  }

  if (paymentMethodId === null) {
    return receiptResponse({ error: 'A reserva do recibo exige reconciliação antes da emissão.', manual_review: true }, 409)
  }

  const jobId = String(reservation.job_id)
  let document: Record<string, unknown> | null = null
  let identity: VendusIdentity
  try {
    document = await vendusRequest<Record<string, unknown>>(org.vendus_api_key, '/documents/', {
      method: 'POST',
      body: JSON.stringify({
        type: 'RG',
        mode: 'normal',
        date: fiscalDate,
        tx_id: txId,
        external_reference: externalReference,
        payments: [{ id: paymentMethodId, amount }],
        invoices: [{ document_number: source.reference }],
      }),
    })
    const postedIdentity = parseVendusIdentity(document)
    if (postedIdentity.type !== 'RG') {
      throw new VendusError('A Vendus devolveu um tipo de documento inesperado', 502, 'unexpected_document_type')
    }
    const verified = await verifiedVendusReceipt(
      org.vendus_api_key, postedIdentity.id, postedIdentity.reference,
      externalReference, amount, source.reference,
    )
    document = verified.document
    identity = verified.identity
  } catch (error) {
    const code = error instanceof VendusError ? error.code : 'unexpected_provider_error'
    const { error: stateError } = await supabase.from('invoices').update({
      processing_status: 'reconciliation_required',
      processing_last_error: code,
      processing_claim_token: null,
      processing_claimed_at: null,
      raw_data: {
        source: 'vendus', provider: 'vendus', tx_id: txId,
        external_reference: externalReference, snapshot,
        ...(document ? { response_identity: {
          id: document.id ?? null, type: document.type ?? null,
          number: document.number ?? null,
        } } : {}),
      },
    }).eq('id', jobId).eq('organization_id', organizationId).eq('processing_claim_token', claimToken)
    if (stateError) console.error('[generate-receipt:vendus] reconciliation_state_failed', stateError.code)
    console.error('[generate-receipt:vendus] provider_result_uncertain', code)
    return receiptResponse({
      error: 'Não foi possível confirmar o recibo na Vendus. Verifique-o antes de repetir a emissão.',
      code,
      manual_review: true,
    }, 502)
  }

  let pdfPath: string | null = null
  let pdfState: Record<string, unknown> = { status: 'pending' }
  try {
    const pdf = await getVendusPdf(org.vendus_api_key, identity.id)
    const path = `${organizationId}/${saleId}/RG-vendus-${identity.id}.pdf`
    const { error: uploadError } = await supabase.storage.from('invoices')
      .upload(path, pdf, { contentType: 'application/pdf', upsert: true })
    if (uploadError) throw new Error('pdf_storage_failed')
    pdfPath = path
    pdfState = { status: 'stored' }
  } catch (error) {
    pdfState = {
      status: 'failed',
      errorCode: error instanceof VendusError ? error.code : 'pdf_storage_failed',
    }
  }

  const rawData = {
    source: 'vendus',
    provider: 'vendus',
    tx_id: txId,
    external_reference: externalReference,
    id: identity.id,
    type: identity.type,
    number: identity.reference,
    atcud: identity.atcud,
    snapshot,
    pdf: pdfState,
  }
  const { data: receiptRecord, error: completionError } = await supabase.from('invoices').update({
    invoicexpress_id: identity.id,
    provider_document_type_code: identity.type,
    provider_series: identity.series,
    provider_document_number: identity.number,
    provider_atcud: identity.atcud,
    reference: identity.reference,
    status: 'final',
    processing_status: 'issued',
    processing_last_error: pdfPath ? null : 'pdf_unavailable',
    processing_claim_token: null,
    processing_claimed_at: null,
    issued_at: new Date().toISOString(),
    raw_data: rawData,
    pdf_path: pdfPath,
  }).eq('id', jobId).eq('organization_id', organizationId)
    .eq('processing_claim_token', claimToken).select('id').single()
  if (completionError || !receiptRecord) {
    console.error('[generate-receipt:vendus] completion_failed', completionError?.code)
    return receiptResponse({
      error: 'Recibo emitido na Vendus, mas o registo local falhou. É necessária reconciliação.',
      code: 'issued_but_not_persisted', manual_review: true,
    }, 500)
  }

  const { data: linkedPayment, error: paymentUpdateError } = await supabase
    .from('sale_payments')
    .update({
      invoice_reference: identity.reference,
      invoicexpress_id: identity.id,
      ...(pdfPath ? { invoice_file_url: pdfPath } : {}),
    })
    .eq('id', paymentId)
    .eq('sale_id', saleId)
    .eq('organization_id', organizationId)
    .is('invoice_reference', null)
    .select('id')
    .maybeSingle()
  if (paymentUpdateError || !linkedPayment) {
    console.error('[generate-receipt:vendus] payment_link_failed', paymentUpdateError?.code)
    return receiptResponse({
      error: 'Recibo emitido e guardado, mas não foi possível ligá-lo ao pagamento.',
      code: 'payment_link_failed', manual_review: true,
    }, 500)
  }

  return receiptResponse({
    success: true,
    receipt_id: identity.id,
    invoice_id: receiptRecord.id,
    invoice_reference: identity.reference,
    identity,
    ...(pdfPath ? { pdf_path: pdfPath } : {}),
  }, 200)
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
    const rateLimitResponse = await userRateLimit(supabaseAuth, user.id, 'generate-receipt', corsHeaders)
    if (rateLimitResponse) return rateLimitResponse

    const { sale_id, payment_id, organization_id } = await req.json()
    if (!sale_id || !payment_id || !organization_id) {
      return new Response(JSON.stringify({ error: 'sale_id, payment_id e organization_id são obrigatórios' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

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
      return new Response(JSON.stringify({ error: 'Sem permissão para emitir recibos' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch org credentials (including the active fiscal provider)
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('invoicexpress_account_name, invoicexpress_api_key, integrations_enabled, billing_provider, keyinvoice_password, keyinvoice_api_url, keyinvoice_sid, keyinvoice_sid_expires_at, tax_config, keyinvoice_series_config, vendus_api_key')
      .eq('id', organization_id)
      .single()

    if (orgError || !org) {
      return new Response(JSON.stringify({ error: 'Não foi possível carregar a configuração de faturação' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const billingProvider = org?.billing_provider || 'invoicexpress'
    const integrationsEnabled = (org?.integrations_enabled as Record<string, boolean> | null) || {}

    // Fetch sale to get invoicexpress_id
    const { data: sale } = await supabase
      .from('sales')
      .select('id, billing_target, invoicexpress_id, invoicexpress_type, invoice_reference, total_value, client:crm_clients(name, nif, company_nif, billing_target, email, phone, address_line1, city, postal_code, country, company, code, company_address_same_as_client, company_address_line1, company_city, company_postal_code, company_country)')
      .eq('id', sale_id)
      .eq('organization_id', organization_id)
      .single()

    if (!sale) {
      return new Response(JSON.stringify({ error: 'Venda não encontrada' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (billingProvider === 'invoicexpress' && !sale.invoicexpress_id) {
      return new Response(JSON.stringify({ error: 'A venda ainda não tem fatura emitida. Emita a fatura primeiro.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch payment
    const { data: payment } = await supabase
      .from('sale_payments')
      .select('*')
      .eq('id', payment_id)
      .eq('sale_id', sale_id)
      .eq('organization_id', organization_id)
      .single()

    if (!payment) {
      return new Response(JSON.stringify({ error: 'Pagamento não encontrado' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (payment.status !== 'paid') {
      return new Response(JSON.stringify({ error: 'Só é possível emitir recibo para um pagamento confirmado como pago.' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (String(payment.reversal_status || 'none') !== 'none' || Number(payment.reversed_amount || 0) > 0) {
      return new Response(JSON.stringify({ error: 'Este pagamento tem reembolso, reversão ou chargeback e não pode gerar recibo automático.' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (payment.invoice_reference) {
      return new Response(JSON.stringify({ 
        error: 'Recibo já gerado para este pagamento',
        invoice_reference: payment.invoice_reference,
      }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (billingProvider === 'vendus') {
      return await handleVendusReceipt(supabase, org, sale, payment, organization_id, sale_id, payment_id)
    }

    // ========== KeyInvoice Flow ==========
    if (billingProvider === 'keyinvoice') {
      if (integrationsEnabled.keyinvoice === false || !org?.keyinvoice_password) {
        return new Response(JSON.stringify({ error: 'Integração KeyInvoice não configurada' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      try {
        // The receipt must settle a real FT. An FR is already settled and must
        // never receive a second receipt.
        let invoiceQuery = supabase
          .from('invoices')
          .select('*')
          .eq('sale_id', sale_id)
          .eq('organization_id', organization_id)
          .eq('document_type', 'invoice')
          .eq('status', 'final')
        if (payment.recurring_cycle_id) invoiceQuery = invoiceQuery.eq('recurring_cycle_id', payment.recurring_cycle_id)
        const { data: invoiceRecords, error: invoiceError } = await invoiceQuery
          .order('issued_at', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(2)
        if (invoiceError) throw new Error('invoice_lookup_failed')
        const invoiceRecord = (invoiceRecords || []).find((row: any) =>
          row.provider === 'keyinvoice' || row.raw_data?.source === 'keyinvoice'
        )
        if (!invoiceRecord) {
          return new Response(JSON.stringify({ error: 'Não existe uma Fatura KeyInvoice para liquidar. Uma Fatura-Recibo não recebe recibos.' }), {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }

        const receiptIdempotencyKey = `receipt:${payment_id}`
        const { data: previousReceipt, error: previousReceiptError } = await supabase
          .from('invoices')
          .select('id,reference,provider_document_number,processing_status,status')
          .eq('organization_id', organization_id)
          .eq('fiscal_idempotency_key', receiptIdempotencyKey)
          .maybeSingle()
        if (previousReceiptError) throw new Error('receipt_lookup_failed')
        if (previousReceipt) {
          return new Response(JSON.stringify({
            error: previousReceipt.processing_status === 'issued' || previousReceipt.status === 'final'
              ? 'Recibo já gerado para este pagamento'
              : 'A emissão do recibo já foi iniciada e exige reconciliação antes de nova tentativa.',
            invoice_reference: previousReceipt.reference,
            manual_review: previousReceipt.processing_status !== 'issued' && previousReceipt.status !== 'final',
          }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        const originalIdentity = documentIdentityFromRawData(invoiceRecord.raw_data, {
          docType: invoiceRecord.provider_document_type_code,
          docNum: invoiceRecord.provider_document_number ?? invoiceRecord.invoicexpress_id,
        })
        const receiptAmount = Number(payment.amount)
        if (!Number.isFinite(receiptAmount) || receiptAmount <= 0) {
          return new Response(JSON.stringify({ error: 'O pagamento não tem um valor válido para recibo.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }

        const clientData = sale.client as any
        const selectedRecipient = saleBillingRecipient(sale)
        const sourceClient = (invoiceRecord.raw_data as any)?.snapshot?.client
        const receiptAddress = {
          address: sourceClient?.address ?? selectedRecipient.address,
          city: sourceClient?.locality ?? selectedRecipient.city,
          postalCode: sourceClient?.postalCode ?? selectedRecipient.postalCode,
          country: sourceClient?.countryCode ?? selectedRecipient.country,
        }
        const clientName = String(sourceClient?.name || invoiceRecord.client_name || selectedRecipient.name).trim()
        const clientNif = String(sourceClient?.vatin || sourceClient?.nif || selectedRecipient.nif).trim()
        if (!clientName || !clientNif) {
          return receiptResponse({ error: 'A Fatura de origem não tem destinatário fiscal completo para o recibo.' }, 409)
        }
        const fiscalDate = lisbonFiscalDate(payment.payment_date || new Date())
        const snapshot = {
          schemaVersion: 1,
          fiscalDate,
          currency: 'EUR',
          kind: 'receipt',
          amount: receiptAmount,
          paymentId: payment_id,
          saleId: sale_id,
          recurringCycleId: payment.recurring_cycle_id || null,
          originalDocument: originalIdentity,
          payment: {
            id: payment_id,
            status: payment.status,
            amount: receiptAmount,
            reversalStatus: String(payment.reversal_status || 'none'),
            reversedAmount: Number(payment.reversed_amount || 0),
          },
          client: { name: clientName, vatin: clientNif },
        }
        const claimToken = crypto.randomUUID()
        const claimedAt = new Date().toISOString()
        const { data: reservation, error: reservationError } = await supabase.rpc(
          'reserve_manual_keyinvoice_receipt',
          {
            p_organization_id: organization_id,
            p_sale_id: sale_id,
            p_payment_id: payment_id,
            p_related_invoice_id: invoiceRecord.id,
            p_amount: receiptAmount,
            p_fiscal_date: fiscalDate,
            p_snapshot: snapshot,
            p_idempotency_key: receiptIdempotencyKey,
            p_client_name: clientName,
            p_claim_token: claimToken,
            p_claimed_at: claimedAt,
          },
        )
        if (reservationError || !reservation?.job_id) {
          const capExceeded = reservationError?.message?.includes('manual_receipt_amount_exceeds_invoice')
          const paymentIneligible = reservationError?.message?.includes('manual_receipt_payment_not_eligible')
          const sourceInvalid = reservationError?.message?.includes('manual_receipt_source_invoice_invalid')
          return new Response(JSON.stringify({
            error: capExceeded
              ? 'O recibo excede o valor ainda disponível na Fatura.'
              : paymentIneligible
              ? 'O pagamento deixou de estar elegível para recibo.'
              : sourceInvalid
              ? 'A Fatura de origem deixou de estar elegível para recibo.'
              : 'Não foi possível reservar a emissão do recibo. Nenhum pedido foi enviado ao KeyInvoice.',
            code: capExceeded
              ? 'receipt_amount_exceeds_invoice'
              : paymentIneligible
              ? 'payment_not_eligible'
              : sourceInvalid
              ? 'source_invoice_invalid'
              : 'receipt_job_failed',
          }), { status: capExceeded || paymentIneligible || sourceInvalid ? 409 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
        if (reservation.created !== true) {
          return new Response(JSON.stringify({
            error: reservation.processing_status === 'issued'
              ? 'Recibo já gerado para este pagamento'
              : 'A emissão do recibo já foi iniciada e exige reconciliação antes de nova tentativa.',
            invoice_reference: reservation.reference || null,
            manual_review: reservation.processing_status !== 'issued',
          }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        const receiptJobId = String(reservation.job_id)
        let session: KeyInvoiceSession
        let identity
        try {
          session = await getKeyInvoiceSession(supabase, org, organization_id)
          const clientId = clientNif
            ? await resolveKeyInvoiceClient(session, {
              name: clientName,
              vatin: clientNif,
              email: clientData.email,
              phone: clientData.phone,
              address: receiptAddress.address,
              locality: receiptAddress.city,
              postalCode: receiptAddress.postalCode,
              country: receiptAddress.country,
            })
            : null
          identity = await issueKeyInvoiceReceipt(session, {
            original: originalIdentity,
            amount: receiptAmount,
            clientId,
            client: {
              name: clientName,
              address: receiptAddress.address,
              postalCode: receiptAddress.postalCode,
              locality: receiptAddress.city,
              countryCode: receiptAddress.country,
            },
          })
        } catch (error) {
          const safe = safeKeyInvoiceError(error)
          const { error: stateError } = await supabase.from('invoices').update({
            processing_status: safe.ambiguous ? 'reconciliation_required' : safe.manual_review ? 'manual_review' : safe.retryable ? 'retry' : 'failed',
            processing_last_error: safe.code,
            processing_next_retry_at: safe.retryable ? new Date(Date.now() + 60_000).toISOString() : null,
            processing_claim_token: null,
            processing_claimed_at: null,
          }).eq('id', receiptJobId).eq('organization_id', organization_id).eq('processing_claim_token', claimToken)
          if (stateError) console.error('[generate-receipt] receipt_job_state_failed')
          throw error
        }
        if (!identity.docSeries) {
          const { error: stateError } = await supabase.from('invoices').update({
            processing_status: 'manual_review',
            processing_last_error: 'provider_document_series_missing',
            processing_claim_token: null,
            processing_claimed_at: null,
            raw_data: identityRawData(identity, { fiscalDate, snapshot }),
          }).eq('id', receiptJobId).eq('organization_id', organization_id).eq('processing_claim_token', claimToken)
          if (stateError) console.error('[generate-receipt] receipt_series_state_failed')
          return new Response(JSON.stringify({
            error: 'O recibo foi emitido, mas o KeyInvoice não devolveu a série fiscal. É necessária reconciliação.',
            code: 'provider_document_series_missing',
            manual_review: true,
          }), { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        let pdfPath: string | null = null
        let pdfState: Record<string, unknown> = { status: 'pending' }
        try {
          const pdf = await getKeyInvoicePdf(session, identity)
          const safeSeries = (identity.docSeries || 'default').replace(/[^A-Za-z0-9_-]/g, '_')
          const safeNumber = identity.docNum.replace(/[^A-Za-z0-9_-]/g, '_')
          const path = `${organization_id}/${sale_id}/RC-${safeSeries}-${safeNumber}.pdf`
          const { error: uploadError } = await supabase.storage
            .from('invoices')
            .upload(path, pdf, { contentType: 'application/pdf', upsert: true })
          if (uploadError) throw new Error('pdf_storage_failed')
          pdfPath = path
          pdfState = { status: 'stored' }
        } catch (pdfError) {
          const safePdfError = safeKeyInvoiceError(pdfError)
          pdfState = { status: 'failed', errorCode: safePdfError.code, retryable: safePdfError.retryable }
        }

        const rawData = identityRawData(identity, { fiscalDate, snapshot, pdf: pdfState })
        let receiptNumber: number
        try {
          receiptNumber = documentNumberAsInteger(identity)
        } catch (error) {
          const safe = safeKeyInvoiceError(error)
          const { error: stateError } = await supabase.from('invoices').update({
            processing_status: 'manual_review',
            processing_last_error: safe.code,
            processing_claim_token: null,
            processing_claimed_at: null,
            raw_data: rawData,
          }).eq('id', receiptJobId).eq('organization_id', organization_id).eq('processing_claim_token', claimToken)
          if (stateError) console.error('[generate-receipt] receipt_number_state_failed')
          throw error
        }
        const { data: receiptRecord, error: insertError } = await supabase
          .from('invoices')
          .update({
            invoicexpress_id: receiptNumber,
            provider_document_type_code: identity.docType,
            provider_series: identity.docSeries,
            provider_document_number: identity.docNum,
            provider_atcud: identity.atcud,
            reference: identity.fullDocNumber,
            status: 'final',
            processing_status: 'issued',
            processing_last_error: null,
            processing_claim_token: null,
            processing_claimed_at: null,
            issued_at: new Date().toISOString(),
            raw_data: rawData,
            pdf_path: pdfPath,
          })
          .eq('id', receiptJobId)
          .eq('organization_id', organization_id)
          .eq('processing_claim_token', claimToken)
          .select('id')
          .single()
        if (insertError || !receiptRecord) {
          return new Response(JSON.stringify({
            error: 'Recibo emitido no KeyInvoice, mas o registo local falhou. É necessária reconciliação.',
            code: 'issued_but_not_persisted',
            manual_review: true,
          }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        const { error: paymentUpdateError } = await supabase
          .from('sale_payments')
          .update({
            invoice_reference: identity.fullDocNumber,
            invoicexpress_id: receiptNumber,
            ...(pdfPath ? { invoice_file_url: pdfPath } : {}),
          })
          .eq('id', payment_id)
          .eq('sale_id', sale_id)
          .eq('organization_id', organization_id)
        if (paymentUpdateError) {
          return new Response(JSON.stringify({
            error: 'Recibo emitido e guardado, mas não foi possível ligá-lo ao pagamento.',
            code: 'payment_link_failed',
            manual_review: true,
          }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        return new Response(JSON.stringify({
          success: true,
          receipt_id: receiptNumber,
          invoice_id: receiptRecord.id,
          invoice_reference: identity.fullDocNumber,
          identity,
          ...(pdfPath ? { pdf_path: pdfPath } : {}),
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      } catch (error) {
        const safe = safeKeyInvoiceError(error)
        console.error('[generate-receipt:keyinvoice]', safe.code)
        return new Response(JSON.stringify({
          error: safe.message,
          code: safe.code,
          retryable: safe.retryable,
          manual_review: safe.manual_review,
        }), { status: safe.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
    }
    // ========== InvoiceXpress Flow (existing) ==========
    if (integrationsEnabled.invoicexpress === false || !org?.invoicexpress_account_name || !org?.invoicexpress_api_key) {
      return new Response(JSON.stringify({ error: 'Integração InvoiceXpress não configurada' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Format payment_date as dd/mm/yyyy
    const paymentDate = new Date(payment.payment_date)
    const formattedDate = `${String(paymentDate.getDate()).padStart(2, '0')}/${String(paymentDate.getMonth() + 1).padStart(2, '0')}/${paymentDate.getFullYear()}`

    const paymentMechanism = PAYMENT_METHOD_MAP[payment.payment_method || 'other'] || 'OU'

    const accountName = org.invoicexpress_account_name
    const apiKey = org.invoicexpress_api_key
    const baseUrl = `https://${accountName}.app.invoicexpress.com`
    const invoiceId = sale.invoicexpress_id

    // The legacy numeric column is shared by every fiscal provider. Never use
    // a Vendus or KeyInvoice ID as an InvoiceXpress partial-payment target.
    if (!['FT', 'invoices'].includes(String(sale.invoicexpress_type || ''))) {
      return receiptResponse({ error: 'A Fatura da venda pertence a outro fornecedor fiscal.' }, 409)
    }
    const { data: sourceRows, error: sourceError } = await supabase.from('invoices')
      .select('id,provider,document_type')
      .eq('organization_id', organization_id).eq('sale_id', sale_id)
      .eq('invoicexpress_id', invoiceId).eq('document_type', 'invoice').limit(2)
    if (sourceError || (sourceRows || []).some((row: any) => row.provider !== 'invoicexpress')) {
      return receiptResponse({ error: 'Não foi possível confirmar o fornecedor da Fatura de origem.' }, 409)
    }
    const sourceResponse = await fetch(`${baseUrl}/invoices/${invoiceId}.json?api_key=${apiKey}`, {
      headers: { Accept: 'application/json' },
    })
    if (!sourceResponse.ok) {
      return receiptResponse({ error: 'Não foi possível confirmar a Fatura na InvoiceXpress.' }, 502)
    }
    const sourceData = await sourceResponse.json()
    const sequentialNumber = String(sourceData?.invoice?.sequential_number || '').trim()
    if (!sequentialNumber || sale.invoice_reference !== `FT ${sequentialNumber}`) {
      return receiptResponse({ error: 'A referência da venda não corresponde à Fatura na InvoiceXpress.' }, 409)
    }

    // Call partial_payments endpoint
    const partialPaymentPayload = {
      partial_payment: {
        payment_mechanism: paymentMechanism,
        amount: Number(payment.amount),
        payment_date: formattedDate,
        note: payment.notes || `Pagamento - ${payment.payment_method ? payment.payment_method.toUpperCase() : ''}`,
      },
    }

    console.log('Calling partial_payments:', JSON.stringify(partialPaymentPayload))

    const receiptRes = await fetch(
      `${baseUrl}/documents/${invoiceId}/partial_payments.json?api_key=${apiKey}`,
      {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(partialPaymentPayload),
      }
    )

    if (!receiptRes.ok) {
      const errorText = await receiptRes.text()
      console.error('InvoiceXpress partial_payment error:', receiptRes.status, errorText)
      return new Response(JSON.stringify({ 
        error: `Erro ao gerar recibo no InvoiceXpress: ${receiptRes.status}`, 
        details: errorText,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const receiptData = await receiptRes.json()
    const receipt = receiptData.receipt || {}
    const receiptId = receipt.id
    const receiptSeqNumber = receipt.inverted_sequence_number || receipt.sequence_number
    const receiptPermalink = receipt.permalink || null

    const receiptReference = receiptSeqNumber ? `RC ${receiptSeqNumber}` : `RC #${receiptId}`

    // Try to get PDF
    let pdfUrl: string | null = null
    if (receiptId) {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const pdfRes = await fetch(`${baseUrl}/api/pdf/${receiptId}.json?api_key=${apiKey}`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
          })
          if (pdfRes.status === 200) {
            const pdfData = await pdfRes.json()
            pdfUrl = pdfData?.output?.pdfUrl || null
            if (pdfUrl) break
          }
          await new Promise(r => setTimeout(r, 2000))
        }
      } catch (e) {
        console.warn('PDF polling failed (non-blocking):', e)
      }
    }

    // QR Code polling for receipt
    let qrCodeUrl: string | null = null
    if (receiptId) {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const qrRes = await fetch(`${baseUrl}/api/qr_codes/${receiptId}.json?api_key=${apiKey}`, {
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
    }

    // Save receipt reference in sale_payment
    const fileUrl = pdfUrl || receiptPermalink || null
    const { error: paymentUpdateError } = await supabase
      .from('sale_payments')
      .update({
        invoice_reference: receiptReference,
        invoicexpress_id: receiptId || null,
        ...(fileUrl ? { invoice_file_url: fileUrl } : {}),
        ...(qrCodeUrl ? { qr_code_url: qrCodeUrl } : {}),
      })
      .eq('id', payment_id)
      .eq('sale_id', sale_id)
      .eq('organization_id', organization_id)

    if (paymentUpdateError) {
      return new Response(JSON.stringify({
        error: 'Recibo emitido, mas não foi possível ligá-lo ao pagamento. É necessária reconciliação.',
        code: 'payment_link_failed',
        manual_review: true,
      }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({
      success: true,
      receipt_id: receiptId,
      invoice_reference: receiptReference,
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
