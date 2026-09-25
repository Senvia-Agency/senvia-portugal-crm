import { requestMfaResponse } from "../_shared/user-authorization.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { documentIdentityFromRawData, documentNumberAsInteger, getKeyInvoiceSession, identityRawData, lisbonFiscalDate, safeKeyInvoiceError, voidKeyInvoiceDocument } from '../_shared/keyinvoice.ts'
import { userRateLimit } from '../_shared/user-rate-limit.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    const rateLimitResponse = await userRateLimit(supabase, user.id, 'cancel-invoice', corsHeaders)
    if (rateLimitResponse) return rateLimitResponse

    const { invoice_id, payment_id, sale_id, organization_id, reason, invoicexpress_id, document_type } = await req.json()

    if (!organization_id || !reason || (!invoice_id && !invoicexpress_id) || !document_type) {
      return new Response(JSON.stringify({ error: 'Campos obrigatórios: organization_id, reason, invoicexpress_id, document_type' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!invoice_id && !payment_id && !sale_id) {
      return new Response(JSON.stringify({ error: 'invoice_id, payment_id ou sale_id é obrigatório' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
      return new Response(JSON.stringify({ error: 'Sem permissão para anular documentos fiscais' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch org credentials
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('invoicexpress_account_name, invoicexpress_api_key, billing_provider, keyinvoice_password, keyinvoice_api_url, keyinvoice_sid, keyinvoice_sid_expires_at')
      .eq('id', organization_id)
      .single()

    if (orgError || !org) {
      return new Response(JSON.stringify({ error: 'Não foi possível carregar a configuração de faturação' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const billingProvider = (org as any)?.billing_provider || 'invoicexpress'
    if (invoice_id) {
      const { data: selectedInvoice, error: selectedInvoiceError } = await supabase
        .from('invoices')
        .select('provider')
        .eq('id', invoice_id)
        .eq('organization_id', organization_id)
        .maybeSingle()
      if (selectedInvoiceError) throw selectedInvoiceError
      if (!selectedInvoice) {
        return new Response(JSON.stringify({ error: 'Documento fiscal não encontrado.', code: 'document_not_found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (selectedInvoice.provider === 'vendus') {
        return new Response(JSON.stringify({ error: 'A anulação de documentos Vendus ainda não é suportada.', code: 'vendus_operation_unsupported' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    } else if (Number.isSafeInteger(Number(invoicexpress_id)) && Number(invoicexpress_id) > 0) {
      const { data: vendusDocument, error: vendusLookupError } = await supabase
        .from('invoices')
        .select('id')
        .eq('organization_id', organization_id)
        .eq('provider', 'vendus')
        .eq('invoicexpress_id', Number(invoicexpress_id))
        .eq('document_type', document_type)
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
      return new Response(JSON.stringify({ error: 'A anulação via Vendus ainda não é suportada.', code: 'vendus_operation_unsupported' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    let localInvoiceId: string | null = null
    let shouldClearLegacySaleReference = billingProvider !== 'keyinvoice'

    if (billingProvider === 'keyinvoice') {
      if (!org?.keyinvoice_password) {
        return new Response(JSON.stringify({ error: 'Chave da API KeyInvoice não configurada' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      let invoiceQuery = supabase
        .from('invoices')
        .select('*')
        .eq('organization_id', organization_id)
      if (invoice_id) invoiceQuery = invoiceQuery.eq('id', invoice_id)
      else invoiceQuery = invoiceQuery.eq('invoicexpress_id', invoicexpress_id).eq('document_type', document_type)
      if (payment_id) invoiceQuery = invoiceQuery.eq('payment_id', payment_id)
      if (sale_id) invoiceQuery = invoiceQuery.eq('sale_id', sale_id)
      const { data: invoiceRows, error: invoiceError } = await invoiceQuery.limit(2)
      if (invoiceError || !invoiceRows || invoiceRows.length !== 1) {
        const ambiguous = (invoiceRows?.length ?? 0) > 1
        return new Response(JSON.stringify({
          error: ambiguous
            ? 'Existem vários documentos com esse número. Selecione o documento pela série.'
            : 'Documento fiscal não encontrado.',
          code: ambiguous ? 'ambiguous_document_identity' : 'document_not_found',
        }), { status: ambiguous ? 409 : 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const invoiceRecord = invoiceRows[0]
      localInvoiceId = invoiceRecord.id
      shouldClearLegacySaleReference = !invoiceRecord.recurring_cycle_id
      if (!['invoice', 'invoice_receipt'].includes(invoiceRecord.document_type)) {
        return new Response(JSON.stringify({
          error: 'Este tipo de documento exige anulação manual no KeyInvoice.',
          code: 'unsupported_void_origin',
          manual_review: true,
        }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const idempotencyKey = `manual:credit-note:${invoiceRecord.id}`
      const { data: priorCredit, error: priorError } = await supabase.from('invoices')
        .select('*')
        .eq('organization_id', organization_id)
        .eq('fiscal_idempotency_key', idempotencyKey)
        .maybeSingle()
      if (priorError) throw priorError
      if (priorCredit && priorCredit.processing_status !== 'issued') {
        return new Response(JSON.stringify({
          error: 'A anulação já foi iniciada e exige reconciliação antes de nova tentativa.',
          code: 'credit_note_reconciliation_required',
          manual_review: true,
        }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      if (!priorCredit) {
        if (invoiceRecord.status === 'canceled' || invoiceRecord.processing_status === 'void') {
          return new Response(JSON.stringify({
            error: 'O documento já está anulado, mas não existe uma nota de crédito reconciliada.',
            code: 'void_credit_note_missing',
            manual_review: true,
          }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
        const identity = documentIdentityFromRawData(invoiceRecord.raw_data, {
          docType: invoiceRecord.provider_document_type_code,
          docNum: invoiceRecord.provider_document_number ?? invoiceRecord.invoicexpress_id,
        })
        const session = await getKeyInvoiceSession(supabase, org, organization_id)
        const fiscalDate = lisbonFiscalDate()
        const creditSnapshot = {
          schemaVersion: 1,
          fiscalDate,
          reason,
          originalDocument: identity,
          originalSnapshot: invoiceRecord.fiscal_snapshot || invoiceRecord.raw_data?.snapshot || null,
        }
        const claimToken = crypto.randomUUID()
        const claimedAt = new Date().toISOString()
        const { data: creditJob, error: jobError } = await supabase.from('invoices').insert({
          organization_id,
          sale_id: invoiceRecord.sale_id,
          payment_id: invoiceRecord.payment_id,
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
          fiscal_snapshot: creditSnapshot,
          fiscal_idempotency_key: idempotencyKey,
          raw_data: { source: 'keyinvoice', snapshot: creditSnapshot },
          email_status: 'not_requested',
        }).select('*').single()
        if (jobError || !creditJob) {
          return new Response(JSON.stringify({
            error: 'Não foi possível reservar a anulação fiscal. Nenhum pedido foi enviado ao KeyInvoice.',
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
          if (stateError) console.error('[cancel-invoice] credit_job_state_failed')
          throw error
        }

        const { error: voidStateError } = await supabase.from('invoices').update({
          status: 'canceled',
          processing_status: 'void',
          updated_at: new Date().toISOString(),
        }).eq('id', invoiceRecord.id).eq('organization_id', organization_id)
        if (voidStateError) {
          return new Response(JSON.stringify({
            error: 'Documento anulado no KeyInvoice, mas o estado local não foi atualizado.',
            code: 'void_persist_failed',
            manual_review: true,
          }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        const creditIdentity = voidResult.generatedDocument
        if (!creditIdentity || !creditIdentity.docSeries) {
          const { error: stateError } = await supabase.from('invoices').update({
            processing_status: 'manual_review',
            processing_last_error: creditIdentity ? 'provider_credit_note_series_missing' : 'provider_credit_note_identity_missing',
            processing_claim_token: null,
            processing_claimed_at: null,
            ...(creditIdentity ? { raw_data: identityRawData(creditIdentity, { fiscalDate, snapshot: creditSnapshot }) } : {}),
          }).eq('id', creditJob.id).eq('organization_id', organization_id).eq('processing_claim_token', claimToken)
          if (stateError) console.error('[cancel-invoice] credit_identity_state_failed')
          return new Response(JSON.stringify({
            error: creditIdentity
              ? 'O KeyInvoice não devolveu a série da nota de crédito criada.'
              : 'O documento foi anulado, mas o KeyInvoice não devolveu a identidade da nota de crédito.',
            code: creditIdentity ? 'provider_credit_note_series_missing' : 'provider_credit_note_identity_missing',
            manual_review: true,
          }), { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        let creditNumber: number
        try {
          creditNumber = documentNumberAsInteger(creditIdentity)
        } catch (error) {
          const safe = safeKeyInvoiceError(error)
          const { error: stateError } = await supabase.from('invoices').update({
            processing_status: 'manual_review',
            processing_last_error: safe.code,
            processing_claim_token: null,
            processing_claimed_at: null,
            raw_data: identityRawData(creditIdentity, { fiscalDate, snapshot: creditSnapshot }),
          }).eq('id', creditJob.id).eq('organization_id', organization_id).eq('processing_claim_token', claimToken)
          if (stateError) console.error('[cancel-invoice] credit_number_state_failed')
          throw error
        }
        const { error: creditError } = await supabase.from('invoices').update({
          invoicexpress_id: creditNumber,
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
          raw_data: identityRawData(creditIdentity, { fiscalDate, snapshot: creditSnapshot }),
        }).eq('id', creditJob.id).eq('organization_id', organization_id).eq('processing_claim_token', claimToken)
        if (creditError) {
          return new Response(JSON.stringify({
            error: 'Documento anulado no KeyInvoice, mas a nota de crédito devolvida não foi guardada. É necessária reconciliação.',
            code: 'credit_note_persist_failed',
            manual_review: true,
          }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
      }
    } else {
      // InvoiceXpress cancel flow
      if (!org?.invoicexpress_account_name || !org?.invoicexpress_api_key) {
        return new Response(JSON.stringify({ error: 'Credenciais InvoiceXpress não configuradas' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const endpointMap: Record<string, string> = { invoice: 'invoices', invoice_receipt: 'invoice_receipts', receipt: 'receipts' }
      const docKeyMap: Record<string, string> = { invoice: 'invoice', invoice_receipt: 'invoice_receipt', receipt: 'receipt' }
      const endpointName = endpointMap[document_type] || 'invoices'
      const docKey = docKeyMap[document_type] || 'invoice'
      const baseUrl = `https://${org.invoicexpress_account_name}.app.invoicexpress.com`

      const cancelRes = await fetch(
        `${baseUrl}/${endpointName}/${invoicexpress_id}/change-state.json?api_key=${org.invoicexpress_api_key}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ [docKey]: { state: 'canceled', message: reason } }),
        }
      )

      if (!cancelRes.ok) {
        try { await cancelRes.text() } catch {}
        console.error('[cancel-invoice] invoicexpress_cancel_failed', cancelRes.status)
        return new Response(JSON.stringify({ error: `Erro ao anular fatura no InvoiceXpress (${cancelRes.status})` }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      try { await cancelRes.text() } catch {}
    }

    // Update only the exact local document. KeyInvoice document numbers can be
    // repeated across types and series.
    const statusUpdate: Record<string, unknown> = { status: 'canceled', updated_at: new Date().toISOString() }
    if (localInvoiceId) statusUpdate.processing_status = 'void'
    let statusQuery = supabase
      .from('invoices')
      .update(statusUpdate)
      .eq('organization_id', organization_id)
    statusQuery = localInvoiceId
      ? statusQuery.eq('id', localInvoiceId)
      : statusQuery.eq('invoicexpress_id', invoicexpress_id).eq('document_type', document_type)
    const { error: statusError } = await statusQuery
    if (statusError) {
      return new Response(JSON.stringify({
        error: 'Documento anulado no fornecedor, mas o estado local não foi atualizado. É necessária reconciliação.',
        code: 'void_persist_failed',
        manual_review: true,
      }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Clear references
    if (payment_id) {
      const { error: paymentUpdateError } = await supabase
        .from('sale_payments')
        .update({
          invoice_reference: null,
          invoice_file_url: null,
          invoicexpress_id: null,
        })
        .eq('id', payment_id)
        .eq('organization_id', organization_id)
      if (paymentUpdateError) {
        return new Response(JSON.stringify({ error: 'Documento anulado, mas não foi possível atualizar o pagamento.', code: 'payment_unlink_failed', manual_review: true }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }
    
    if (sale_id && shouldClearLegacySaleReference) {
      const { error: saleUpdateError } = await supabase
        .from('sales')
        .update({
          invoicexpress_id: null,
          invoicexpress_type: null,
          invoice_reference: null,
        })
        .eq('id', sale_id)
        .eq('organization_id', organization_id)
      if (saleUpdateError) {
        return new Response(JSON.stringify({ error: 'Documento anulado, mas não foi possível atualizar a venda.', code: 'sale_unlink_failed', manual_review: true }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    return new Response(JSON.stringify({ success: true, operation: billingProvider === 'keyinvoice' ? 'credit_note_reversal' : 'void' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const safe = safeKeyInvoiceError(err)
    console.error('[cancel-invoice]', safe.code)
    return new Response(JSON.stringify({ error: safe.message, code: safe.code, retryable: safe.retryable, manual_review: safe.manual_review }), {
      status: safe.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
