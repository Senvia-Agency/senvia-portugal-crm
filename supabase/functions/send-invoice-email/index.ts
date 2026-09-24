import { requestMfaResponse } from "../_shared/user-authorization.ts";
import { userRateLimit } from '../_shared/user-rate-limit.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { documentIdentityFromRawData, getKeyInvoiceSession, safeKeyInvoiceError, sendKeyInvoiceDocumentEmail } from '../_shared/keyinvoice.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DOC_TYPE_MAP: Record<string, string> = {
  invoice: 'invoices',
  invoice_receipt: 'invoice_receipts',
  receipt: 'receipts',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)
    if (authHeader.replace(/^Bearer\s+/i, '') === supabaseKey) return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const mfaResponse = await requestMfaResponse(req, user.id, corsHeaders);
    if (mfaResponse) return mfaResponse;
    const rateLimitResponse = await userRateLimit(supabase, user.id, 'send-invoice-email', corsHeaders)
    if (rateLimitResponse) return rateLimitResponse

    const { invoice_id, document_id, document_type, organization_id, email, subject, body } = await req.json()

    if ((!invoice_id && !document_id) || !document_type || !organization_id || !email) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
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
      return new Response(JSON.stringify({ error: 'Not a member of this organization' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
      return new Response(JSON.stringify({ error: 'Sem permissão para enviar documentos fiscais' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get organization credentials
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('invoicexpress_account_name, invoicexpress_api_key, billing_provider, keyinvoice_password, keyinvoice_api_url, keyinvoice_sid, keyinvoice_sid_expires_at')
      .eq('id', organization_id)
      .single()

    if (orgError || !org) {
      return new Response(JSON.stringify({ error: 'Não foi possível carregar a configuração de faturação' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
        return new Response(JSON.stringify({ error: 'O envio por email de documentos Vendus ainda não é suportado.', code: 'vendus_operation_unsupported' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    } else if (Number.isSafeInteger(Number(document_id)) && Number(document_id) > 0) {
      const { data: vendusDocument, error: vendusLookupError } = await supabase
        .from('invoices')
        .select('id')
        .eq('organization_id', organization_id)
        .eq('provider', 'vendus')
        .eq('invoicexpress_id', Number(document_id))
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
      return new Response(JSON.stringify({ error: 'O envio por email via Vendus ainda não é suportado.', code: 'vendus_operation_unsupported' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (billingProvider === 'keyinvoice') {
      if (!org?.keyinvoice_password) {
        return new Response(JSON.stringify({ error: 'Chave da API KeyInvoice não configurada' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      let invoiceQuery = supabase
        .from('invoices')
        .select('id,invoicexpress_id,document_type,reference,raw_data,provider_document_type_code,provider_series,provider_document_number,email_attempts')
        .eq('organization_id', organization_id)
      if (invoice_id) invoiceQuery = invoiceQuery.eq('id', invoice_id)
      else invoiceQuery = invoiceQuery.eq('invoicexpress_id', document_id).eq('document_type', document_type)
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
      const identity = documentIdentityFromRawData(invoiceRecord.raw_data, {
        docType: invoiceRecord.provider_document_type_code,
        docNum: invoiceRecord.provider_document_number ?? invoiceRecord.invoicexpress_id,
      })
      const session = await getKeyInvoiceSession(supabase, org, organization_id)
      await sendKeyInvoiceDocumentEmail(session, {
        identity,
        email,
        subject: subject || 'Documento fiscal',
        body: body || '',
      })
      const { error: emailStateError } = await supabase.from('invoices').update({
        email_status: 'sent',
        email_attempts: Number(invoiceRecord.email_attempts || 0) + 1,
        email_sent_at: new Date().toISOString(),
        email_last_error: null,
        email_next_retry_at: null,
      }).eq('id', invoiceRecord.id).eq('organization_id', organization_id)
      if (emailStateError) {
        return new Response(JSON.stringify({
          error: 'O email foi enviado pelo KeyInvoice, mas o estado local não foi atualizado.',
          code: 'email_state_persist_failed',
          manual_review: true,
        }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
    } else {
      // InvoiceXpress email flow
      if (!org?.invoicexpress_account_name || !org?.invoicexpress_api_key) {
        return new Response(JSON.stringify({ error: 'InvoiceXpress not configured' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const apiType = DOC_TYPE_MAP[document_type] || document_type
      const baseUrl = `https://${org.invoicexpress_account_name}.app.invoicexpress.com`
      const url = `${baseUrl}/${apiType}/${document_id}/email-document.json?api_key=${org.invoicexpress_api_key}`

      const payload = {
        message: {
          client: { email, save: '0' },
          subject: subject || '',
          body: body || '',
          logo: '0',
        },
      }

      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        try { await res.text() } catch {}
        console.error('[send-invoice-email] invoicexpress_email_failed', res.status)
        return new Response(JSON.stringify({ error: `InvoiceXpress error: ${res.status}` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const safe = safeKeyInvoiceError(err)
    console.error('[send-invoice-email]', safe.code)
    return new Response(JSON.stringify({ error: safe.message, code: safe.code, retryable: safe.retryable }), {
      status: safe.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
