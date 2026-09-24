import { requestMfaResponse } from "../_shared/user-authorization.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { userRateLimit } from '../_shared/user-rate-limit.ts'
import {
  documentIdentityFromRawData,
  documentNumberAsInteger,
  getKeyInvoicePdf,
  getKeyInvoiceSession,
  identityRawData,
  lisbonFiscalDate,
  safeKeyInvoiceError,
  voidKeyInvoiceDocument,
} from '../_shared/keyinvoice.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const token = authHeader.replace('Bearer ', '')
    if (token === supabaseServiceKey) return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const mfaResponse = await requestMfaResponse(req, user.id, corsHeaders);
    if (mfaResponse) return mfaResponse;
    const rateLimitResponse = await userRateLimit(supabase, user.id, 'create-credit-note', corsHeaders)
    if (rateLimitResponse) return rateLimitResponse

    const { 
      organization_id, 
      sale_id, 
      payment_id,
      original_document_id,
      original_document_type,
      invoice_id,
      reason,
      items,
    } = await req.json()

    if (!organization_id || !reason || (!invoice_id && (!original_document_id || !original_document_type))) {
      return new Response(JSON.stringify({ error: 'Campos obrigatórios: organization_id, reason e invoice_id (ou documento/tipo)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Verify membership
    const { data: isMember } = await supabase.rpc('is_org_member', {
      _user_id: user.id,
      _org_id: organization_id,
    })

    if (!isMember) {
      return new Response(JSON.stringify({ error: 'Sem acesso a esta organização' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: canCancel, error: permissionError } = await supabase.rpc('has_module_permission', {
      _user_id: user.id,
      _org_id: organization_id,
      _module: 'finance',
      _subarea: 'invoices',
      _action: 'cancel',
    })
    if (permissionError || canCancel !== true) {
      return new Response(JSON.stringify({ error: 'Sem permissão para criar notas de crédito' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch org credentials
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('invoicexpress_account_name, invoicexpress_api_key, integrations_enabled, tax_config, billing_provider, keyinvoice_password, keyinvoice_api_url, keyinvoice_sid, keyinvoice_sid_expires_at')
      .eq('id', organization_id)
      .single()

    if (orgError || !org) {
      return new Response(JSON.stringify({ error: 'Não foi possível carregar a configuração de faturação' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const billingProvider = org?.billing_provider || 'invoicexpress'
    if (invoice_id) {
      const { data: selectedInvoice, error: selectedInvoiceError } = await supabase
        .from('invoices')
        .select('provider')
        .eq('id', invoice_id)
        .eq('organization_id', organization_id)
        .maybeSingle()
      if (selectedInvoiceError) throw selectedInvoiceError
      if (!selectedInvoice) {
        return new Response(JSON.stringify({ error: 'Documento fiscal original não encontrado.', code: 'document_not_found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (selectedInvoice.provider === 'vendus') {
        return new Response(JSON.stringify({ error: 'A nota de crédito para documentos Vendus ainda não é suportada.', code: 'vendus_operation_unsupported' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    } else if (Number.isSafeInteger(Number(original_document_id)) && Number(original_document_id) > 0) {
      const { data: vendusDocument, error: vendusLookupError } = await supabase
        .from('invoices')
        .select('id')
        .eq('organization_id', organization_id)
        .eq('provider', 'vendus')
        .eq('invoicexpress_id', Number(original_document_id))
        .eq('document_type', original_document_type)
        .limit(1)
        .maybeSingle()
      if (vendusLookupError) throw vendusLookupError
      if (vendusDocument) {
        return new Response(JSON.stringify({ error: 'Este número também pertence a um documento Vendus. Seleciona o documento pelo identificador interno.', code: 'ambiguous_document_identity' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }
    if (billingProvider === 'vendus') {
      return new Response(JSON.stringify({ error: 'A nota de crédito via Vendus ainda não é suportada.', code: 'vendus_operation_unsupported' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const integrationsEnabled = (org?.integrations_enabled as Record<string, boolean> | null) || {}

    // ========== KeyInvoice Flow ==========
    if (billingProvider === 'keyinvoice') {
      if (integrationsEnabled.keyinvoice === false || !org.keyinvoice_password) {
        return new Response(JSON.stringify({ error: 'Integração KeyInvoice não configurada' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (Array.isArray(items) && items.length > 0) {
        return new Response(JSON.stringify({
          error: 'A API KeyInvoice validada só permite anulação integral. Notas de crédito parciais exigem revisão manual.',
          code: 'partial_credit_note_manual_review',
          manual_review: true,
        }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      let originalQuery = supabase
        .from('invoices')
        .select('*')
        .eq('organization_id', organization_id)
      originalQuery = invoice_id
        ? originalQuery.eq('id', invoice_id)
        : originalQuery.eq('invoicexpress_id', original_document_id).eq('document_type', original_document_type)
      const { data: invoiceRows, error: invoiceError } = await originalQuery.limit(2)
      if (invoiceError || !invoiceRows || invoiceRows.length !== 1) {
        const ambiguous = (invoiceRows?.length ?? 0) > 1
        return new Response(JSON.stringify({
          error: ambiguous
            ? 'Existem vários documentos com esse número. Selecione o documento pela série.'
            : 'Documento fiscal original não encontrado.',
          code: ambiguous ? 'ambiguous_document_identity' : 'document_not_found',
        }), { status: ambiguous ? 409 : 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const invoiceRecord = invoiceRows[0]
      if (!['invoice', 'invoice_receipt'].includes(invoiceRecord.document_type)) {
        return new Response(JSON.stringify({
          error: 'Este tipo de documento não suporta nota de crédito automática.',
          code: 'unsupported_credit_note_origin',
          manual_review: true,
        }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const idempotencyKey = `manual:credit-note:${invoiceRecord.id}`
      const { data: priorCredit, error: priorError } = await supabase
        .from('invoices')
        .select('*')
        .eq('organization_id', organization_id)
        .eq('fiscal_idempotency_key', idempotencyKey)
        .maybeSingle()
      if (priorError) throw priorError
      if (priorCredit?.processing_status === 'issued') {
        return new Response(JSON.stringify({
          success: true,
          already_issued: true,
          credit_note_id: priorCredit.invoicexpress_id,
          credit_note_reference: priorCredit.reference,
          invoice_id: priorCredit.id,
          pdf_path: priorCredit.pdf_path,
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      if (priorCredit) {
        return new Response(JSON.stringify({
          error: 'A anulação já foi iniciada e exige reconciliação antes de nova tentativa.',
          code: 'credit_note_reconciliation_required',
          manual_review: true,
        }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      if (invoiceRecord.status === 'canceled' || invoiceRecord.processing_status === 'void') {
        return new Response(JSON.stringify({
          error: 'O documento já está anulado, mas não existe uma nota de crédito reconciliada.',
          code: 'void_credit_note_missing',
          manual_review: true,
        }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const fiscalDate = lisbonFiscalDate()
      const snapshot = {
        schemaVersion: 1,
        fiscalDate,
        reason,
        originalDocumentId: invoiceRecord.id,
        originalIdentity: invoiceRecord.raw_data?.identity || null,
        originalFiscalSnapshot: invoiceRecord.fiscal_snapshot || invoiceRecord.raw_data?.snapshot || null,
      }
      const identity = documentIdentityFromRawData(invoiceRecord.raw_data, {
        docType: invoiceRecord.provider_document_type_code,
        docNum: invoiceRecord.provider_document_number ?? invoiceRecord.invoicexpress_id,
      })
      // Authenticate before reserving the durable write so a transient auth
      // outage cannot strand a job that never reached a fiscal mutation.
      const session = await getKeyInvoiceSession(supabase, org, organization_id)
      const claimToken = crypto.randomUUID()
      const claimedAt = new Date().toISOString()
      const { data: creditJob, error: jobError } = await supabase.from('invoices').insert({
        organization_id,
        sale_id: invoiceRecord.sale_id || sale_id || null,
        payment_id: invoiceRecord.payment_id || payment_id || null,
        recurring_cycle_id: invoiceRecord.recurring_cycle_id,
        related_invoice_id: invoiceRecord.id,
        invoicexpress_id: null,
        provider: 'keyinvoice',
        document_type: 'credit_note',
        reference: null,
        total: invoiceRecord.total,
        status: 'pending',
        processing_status: 'processing',
        processing_attempts: 1,
        processing_claim_token: claimToken,
        processing_claimed_at: claimedAt,
        date: fiscalDate,
        client_name: invoiceRecord.client_name,
        fiscal_snapshot: snapshot,
        fiscal_idempotency_key: idempotencyKey,
        raw_data: { source: 'keyinvoice', snapshot },
        email_status: 'not_requested',
      }).select('*').single()
      if (jobError || !creditJob) {
        return new Response(JSON.stringify({
          error: 'Não foi possível reservar a operação fiscal. Nenhum pedido foi enviado ao KeyInvoice.',
          code: 'credit_note_job_failed',
        }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      let voidResult
      try {
        voidResult = await voidKeyInvoiceDocument(session, { identity, reason })
      } catch (error) {
        const safe = safeKeyInvoiceError(error)
        const { error: stateError } = await supabase.from('invoices').update({
          processing_status: safe.ambiguous ? 'reconciliation_required' : safe.manual_review ? 'manual_review' : safe.retryable ? 'retry' : 'failed',
          processing_last_error: safe.code,
          processing_next_retry_at: safe.retryable ? new Date(Date.now() + 60_000).toISOString() : null,
          processing_claim_token: null,
          processing_claimed_at: null,
        }).eq('id', creditJob.id).eq('organization_id', organization_id).eq('processing_claim_token', claimToken)
        if (stateError) console.error('[create-credit-note] job_state_failed')
        throw error
      }

      const { error: originalStateError } = await supabase.from('invoices').update({
        status: 'canceled',
        processing_status: 'void',
        updated_at: new Date().toISOString(),
      }).eq('id', invoiceRecord.id).eq('organization_id', organization_id)
      if (originalStateError) {
        return new Response(JSON.stringify({
          error: 'Documento anulado no KeyInvoice, mas o estado local não foi atualizado.',
          code: 'void_persist_failed',
          manual_review: true,
        }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      if (!voidResult.generatedDocument) {
        const { error: stateError } = await supabase.from('invoices').update({
          processing_status: 'manual_review',
          processing_last_error: 'provider_credit_note_identity_missing',
          processing_claim_token: null,
          processing_claimed_at: null,
        }).eq('id', creditJob.id).eq('organization_id', organization_id).eq('processing_claim_token', claimToken)
        if (stateError) console.error('[create-credit-note] identity_state_failed')
        return new Response(JSON.stringify({
          error: 'O documento foi anulado, mas o KeyInvoice não devolveu a identidade da nota de crédito. É necessária reconciliação.',
          code: 'provider_credit_note_identity_missing',
          manual_review: true,
        }), { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const creditIdentity = voidResult.generatedDocument
      if (!creditIdentity.docSeries) {
        const { error: stateError } = await supabase.from('invoices').update({
          processing_status: 'manual_review',
          processing_last_error: 'provider_credit_note_series_missing',
          processing_claim_token: null,
          processing_claimed_at: null,
          raw_data: identityRawData(creditIdentity, { snapshot }),
        }).eq('id', creditJob.id).eq('organization_id', organization_id).eq('processing_claim_token', claimToken)
        if (stateError) console.error('[create-credit-note] series_state_failed')
        return new Response(JSON.stringify({
          error: 'O KeyInvoice não devolveu a série fiscal da nota de crédito. É necessária reconciliação.',
          code: 'provider_credit_note_series_missing',
          manual_review: true,
        }), { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      let creditNoteId: number
      try {
        creditNoteId = documentNumberAsInteger(creditIdentity)
      } catch (error) {
        const safe = safeKeyInvoiceError(error)
        const { error: stateError } = await supabase.from('invoices').update({
          processing_status: 'manual_review',
          processing_last_error: safe.code,
          processing_claim_token: null,
          processing_claimed_at: null,
          raw_data: identityRawData(creditIdentity, { fiscalDate, snapshot }),
        }).eq('id', creditJob.id).eq('organization_id', organization_id).eq('processing_claim_token', claimToken)
        if (stateError) console.error('[create-credit-note] credit_number_state_failed')
        throw error
      }
      let pdfPath: string | null = null
      try {
        const pdf = await getKeyInvoicePdf(session, creditIdentity)
        const pdfFileName = `${organization_id}/credit_note_ki_${creditIdentity.docType}_${creditIdentity.docSeries}_${creditIdentity.docNum}.pdf`
        const { error: uploadError } = await supabase.storage.from('invoices').upload(pdfFileName, pdf, {
          contentType: 'application/pdf',
          upsert: true,
        })
        if (!uploadError) pdfPath = pdfFileName
      } catch {
        // The fiscal document remains valid; PDF can be reconciled independently.
      }

      const { error: completeError } = await supabase.from('invoices').update({
        invoicexpress_id: creditNoteId,
        provider_document_type_code: creditIdentity.docType,
        provider_series: creditIdentity.docSeries,
        provider_document_number: creditIdentity.docNum,
        provider_atcud: creditIdentity.atcud,
        reference: creditIdentity.fullDocNumber,
        status: 'final',
        processing_status: 'issued',
        processing_last_error: null,
        processing_claim_token: null,
        processing_claimed_at: null,
        issued_at: new Date().toISOString(),
        pdf_path: pdfPath,
        raw_data: identityRawData(creditIdentity, { fiscalDate, snapshot }),
      }).eq('id', creditJob.id).eq('organization_id', organization_id).eq('processing_claim_token', claimToken)
      if (completeError) {
        return new Response(JSON.stringify({
          error: 'A nota de crédito foi criada no KeyInvoice, mas não foi possível concluir o registo local.',
          code: 'credit_note_persist_failed',
          manual_review: true,
        }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const { error: legacyError } = await supabase.from('credit_notes').insert({
        organization_id,
        invoicexpress_id: creditNoteId,
        reference: creditIdentity.fullDocNumber,
        status: 'settled',
        client_name: invoiceRecord.client_name,
        total: invoiceRecord.total,
        date: fiscalDate,
        related_invoice_id: invoiceRecord.invoicexpress_id,
        sale_id: invoiceRecord.sale_id || sale_id || null,
        payment_id: invoiceRecord.payment_id || payment_id || null,
        pdf_path: pdfPath,
        raw_data: identityRawData(creditIdentity, { relatedInvoiceId: invoiceRecord.id }),
      })
      if (legacyError) {
        return new Response(JSON.stringify({
          error: 'A nota de crédito foi emitida e guardada, mas não ficou visível no histórico legado.',
          code: 'legacy_credit_note_persist_failed',
          manual_review: true,
        }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      if (payment_id || invoiceRecord.payment_id) {
        const { error: paymentError } = await supabase.from('sale_payments').update({
          credit_note_id: creditNoteId,
          credit_note_reference: creditIdentity.fullDocNumber,
        }).eq('id', payment_id || invoiceRecord.payment_id).eq('organization_id', organization_id)
        if (paymentError) return new Response(JSON.stringify({ error: 'Nota de crédito emitida, mas o pagamento não foi atualizado.', code: 'payment_link_failed', manual_review: true }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (sale_id || invoiceRecord.sale_id) {
        const { error: saleError } = await supabase.from('sales').update({
          credit_note_id: creditNoteId,
          credit_note_reference: creditIdentity.fullDocNumber,
        }).eq('id', sale_id || invoiceRecord.sale_id).eq('organization_id', organization_id)
        if (saleError) return new Response(JSON.stringify({ error: 'Nota de crédito emitida, mas a venda não foi atualizada.', code: 'sale_link_failed', manual_review: true }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({
        success: true,
        credit_note_id: creditNoteId,
        credit_note_reference: creditIdentity.fullDocNumber,
        invoice_id: creditJob.id,
        identity: creditIdentity,
        pdf_path: pdfPath,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ========== InvoiceXpress Flow ==========
    if (integrationsEnabled.invoicexpress === false || !org?.invoicexpress_account_name || !org?.invoicexpress_api_key) {
      return new Response(JSON.stringify({ error: 'Integração de faturação não configurada' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const accountName = org.invoicexpress_account_name
    const apiKey = org.invoicexpress_api_key
    const baseUrl = `https://${accountName}.app.invoicexpress.com`

    // First, get the original document details to build the credit note
    const docEndpointMap: Record<string, string> = { 
      invoice: 'invoices', 
      invoice_receipt: 'invoice_receipts', 
      receipt: 'receipts' 
    }
    const originalEndpoint = docEndpointMap[original_document_type] || 'invoices'

    const originalRes = await fetch(
      `${baseUrl}/${originalEndpoint}/${original_document_id}.json?api_key=${apiKey}`,
      { method: 'GET', headers: { 'Accept': 'application/json' } }
    )

    if (!originalRes.ok) {
      return new Response(JSON.stringify({ error: 'Erro ao obter documento original do InvoiceXpress' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const originalData = await originalRes.json()
    const originalDoc = originalData[Object.keys(originalData)[0]] || {}

    // Build credit note items from original document or custom items
    let creditNoteItems: any[] = []
    
    if (items && items.length > 0) {
      creditNoteItems = items.map((item: any) => ({
        name: item.name,
        description: item.description || item.name,
        unit_price: item.unit_price,
        quantity: item.quantity,
        ...(item.tax ? { tax: item.tax } : {}),
      }))
    } else if (originalDoc.items) {
      const rawItems = Array.isArray(originalDoc.items) ? originalDoc.items : (originalDoc.items?.item ? [originalDoc.items.item] : [])
      creditNoteItems = rawItems.map((item: any) => ({
        name: item.name,
        description: item.description || item.name,
        unit_price: Number(item.unit_price || 0),
        quantity: Number(item.quantity || 1),
        ...(item.tax ? { tax: { name: item.tax.name, value: Number(item.tax.value || 0) } } : {}),
      }))
    }

    if (creditNoteItems.length === 0) {
      return new Response(JSON.stringify({ error: 'Não foi possível determinar os itens para a nota de crédito' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const [todayYear, todayMonth, todayDay] = lisbonFiscalDate().split('-')
    const todayStr = `${todayDay}/${todayMonth}/${todayYear}`

    const taxExemption = originalDoc.tax_exemption || null

    const creditNotePayload = {
      credit_note: {
        date: todayStr,
        due_date: todayStr,
        reference: originalDoc.sequential_number || `Doc #${original_document_id}`,
        observations: reason,
        ...(taxExemption ? { tax_exemption: taxExemption } : {}),
        client: originalDoc.client ? {
          name: originalDoc.client.name,
          code: originalDoc.client.code,
          fiscal_id: originalDoc.client.fiscal_id,
          email: originalDoc.client.email || '',
          address: originalDoc.client.address || '',
          city: originalDoc.client.city || '',
          postal_code: originalDoc.client.postal_code || '',
          country: originalDoc.client.country || 'Portugal',
        } : undefined,
        items: creditNoteItems,
      },
    }

    // 1. Create credit note
    const createRes = await fetch(`${baseUrl}/credit_notes.json?api_key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creditNotePayload),
    })

    if (!createRes.ok) {
      try { await createRes.text() } catch {}
      console.error('[create-credit-note] invoicexpress_create_failed', createRes.status)
      return new Response(JSON.stringify({ 
        error: `Erro ao criar nota de crédito no InvoiceXpress: ${createRes.status}`,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const createData = await createRes.json()
    const creditNote = createData.credit_note || {}
    const creditNoteId = creditNote.id
    const creditNoteSeqNumber = creditNote.sequential_number

    if (!creditNoteId) {
      return new Response(JSON.stringify({ error: 'InvoiceXpress não retornou ID da nota de crédito' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Finalize credit note
    const finalizeRes = await fetch(
      `${baseUrl}/credit_notes/${creditNoteId}/change-state.json?api_key=${apiKey}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credit_note: { state: 'finalized' } }),
      }
    )

    let creditNoteReference = creditNoteSeqNumber ? `NC ${creditNoteSeqNumber}` : `NC #${creditNoteId}`
    
    if (finalizeRes.ok) {
      try {
        const finalizeData = await finalizeRes.json()
        if (finalizeData.credit_note?.sequential_number) {
          creditNoteReference = `NC ${finalizeData.credit_note.sequential_number}`
        }
      } catch {}
    } else {
      try { await finalizeRes.text() } catch {}
      console.error('[create-credit-note] invoicexpress_finalize_failed', finalizeRes.status)
      return new Response(JSON.stringify({
        error: 'A nota de crédito foi criada como rascunho, mas não foi finalizada. É necessária reconciliação.',
        code: 'credit_note_finalize_failed',
        manual_review: true,
      }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 3. Save reference in database
    if (payment_id) {
      const { error: paymentUpdateError } = await supabase
        .from('sale_payments')
        .update({
          credit_note_id: creditNoteId,
          credit_note_reference: creditNoteReference,
        })
        .eq('id', payment_id)
        .eq('organization_id', organization_id)
      if (paymentUpdateError) {
        return new Response(JSON.stringify({ error: 'Nota de crédito emitida, mas o pagamento não foi atualizado.', code: 'payment_link_failed', manual_review: true }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }
    
    if (sale_id) {
      const { error: saleUpdateError } = await supabase
        .from('sales')
        .update({
          credit_note_id: creditNoteId,
          credit_note_reference: creditNoteReference,
        })
        .eq('id', sale_id)
        .eq('organization_id', organization_id)
      if (saleUpdateError) {
        return new Response(JSON.stringify({ error: 'Nota de crédito emitida, mas a venda não foi atualizada.', code: 'sale_link_failed', manual_review: true }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // Insert into credit_notes table for Finance visibility
    const ixClientName = originalDoc.client?.name || null
    const ixTotal = creditNote.total || originalDoc.total || null

    const { error: creditPersistError } = await supabase.from('credit_notes').upsert({
      organization_id,
      invoicexpress_id: creditNoteId,
      reference: creditNoteReference,
      status: 'settled',
      client_name: ixClientName,
      total: ixTotal ? Number(ixTotal) : null,
      date: lisbonFiscalDate(),
      related_invoice_id: original_document_id,
      sale_id: sale_id || null,
      payment_id: payment_id || null,
    }, { onConflict: 'invoicexpress_id,organization_id' })
    if (creditPersistError) {
      return new Response(JSON.stringify({ error: 'Nota de crédito emitida, mas não foi guardada localmente.', code: 'credit_note_persist_failed', manual_review: true }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({
      success: true,
      credit_note_id: creditNoteId,
      credit_note_reference: creditNoteReference,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const safe = safeKeyInvoiceError(err)
    console.error('[create-credit-note]', safe.code)
    return new Response(JSON.stringify({
      error: safe.message,
      code: safe.code,
      retryable: safe.retryable,
      manual_review: safe.manual_review,
      ambiguous: safe.ambiguous,
    }), {
      status: safe.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
