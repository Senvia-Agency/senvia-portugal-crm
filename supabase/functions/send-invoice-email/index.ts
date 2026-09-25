import { requestMfaResponse } from '../_shared/user-authorization.ts'
import { userRateLimit } from '../_shared/user-rate-limit.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { FiscalEmailError, renderFiscalDocumentEmailTemplate, sendFiscalPdfWithBrevo } from '../_shared/fiscal-email.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DOCUMENT_LABELS: Record<string, string> = {
  invoice: 'Fatura',
  invoice_receipt: 'Fatura-Recibo',
  receipt: 'Recibo',
  credit_note: 'Nota de Crédito',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || authHeader.replace(/^Bearer\s+/i, '') === serviceKey) {
      return json({ error: 'Not authenticated' }, 401)
    }

    const supabase = createClient(supabaseUrl, serviceKey)
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return json({ error: 'Invalid token' }, 401)

    const mfaResponse = await requestMfaResponse(req, user.id, corsHeaders)
    if (mfaResponse) return mfaResponse
    const rateLimitResponse = await userRateLimit(supabase, user.id, 'send-invoice-email', corsHeaders)
    if (rateLimitResponse) return rateLimitResponse

    const body = await req.json()
    const invoiceId = typeof body.invoice_id === 'string' ? body.invoice_id : null
    const documentId = body.document_id
    const documentType = typeof body.document_type === 'string' ? body.document_type : ''
    const organizationId = typeof body.organization_id === 'string' ? body.organization_id : ''
    const recipient = typeof body.email === 'string' ? body.email.trim() : ''
    if ((!invoiceId && (documentId === null || documentId === undefined)) || !documentType || !organizationId || !recipient) {
      return json({ error: 'Faltam dados para enviar o documento fiscal.' }, 400)
    }
    if (!DOCUMENT_LABELS[documentType]) return json({ error: 'Tipo de documento fiscal inválido.' }, 400)

    const { data: membership } = await supabase
      .from('organization_members')
      .select('id')
      .eq('user_id', user.id)
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .maybeSingle()
    if (!membership) return json({ error: 'Não tens acesso a esta organização.' }, 403)

    const { data: canIssue, error: permissionError } = await supabase.rpc('has_module_permission', {
      _user_id: user.id,
      _org_id: organizationId,
      _module: 'finance',
      _subarea: 'invoices',
      _action: 'issue',
    })
    if (permissionError || canIssue !== true) {
      return json({ error: 'Sem permissão para enviar documentos fiscais.' }, 403)
    }

    const { data: organization, error: organizationError } = await supabase
      .from('organizations')
      .select('id,name,logo_url,brevo_api_key,brevo_sender_email')
      .eq('id', organizationId)
      .single()
    if (organizationError || !organization) return json({ error: 'Não foi possível carregar a organização.' }, 500)

    const apiKey = Deno.env.get('BREVO_TRANSACTIONAL_API_KEY')
      || organization.brevo_api_key
      || Deno.env.get('BREVO_API_KEY')
    if (!apiKey) {
      return json({ error: 'Brevo não está configurado para enviar documentos fiscais.' }, 400)
    }

    let invoiceQuery = supabase
      .from('invoices')
      .select('id,organization_id,provider,document_type,status,client_name,reference,date,pdf_path,email_attempts')
      .eq('organization_id', organizationId)
      .eq('document_type', documentType)
    if (invoiceId) invoiceQuery = invoiceQuery.eq('id', invoiceId)
    else invoiceQuery = invoiceQuery.eq('invoicexpress_id', documentId)

    const { data: invoices, error: invoiceError } = await invoiceQuery.limit(2)
    if (invoiceError) throw new Error('Não foi possível carregar o documento fiscal.')
    if (!invoices?.length) return json({ error: 'Documento fiscal não encontrado.' }, 404)
    if (invoices.length > 1) return json({ error: 'Existem vários documentos com esse número. Seleciona o documento pela série.' }, 409)
    const invoice = invoices[0]
    if (['cancelled', 'canceled', 'void', 'draft'].includes(String(invoice.status || '').toLowerCase())) {
      return json({ error: 'Só é possível enviar documentos fiscais finalizados.' }, 409)
    }

    const pdfPath = typeof invoice.pdf_path === 'string' ? invoice.pdf_path : ''
    if (!pdfPath.startsWith(`${organizationId}/`)) {
      return json({ error: 'O PDF deste documento ainda não está disponível no Senvia OS.' }, 409)
    }
    const { data: pdfFile, error: pdfError } = await supabase.storage.from('invoices').download(pdfPath)
    if (pdfError || !pdfFile) return json({ error: 'Não foi possível obter o PDF para anexar ao email.' }, 409)
    const pdf = new Uint8Array(await pdfFile.arrayBuffer())
    if (pdf.length < 5 || new TextDecoder().decode(pdf.subarray(0, 5)) !== '%PDF-') {
      return json({ error: 'O ficheiro guardado não é um PDF válido.' }, 409)
    }

    const documentLabel = DOCUMENT_LABELS[documentType]
    const reference = String(invoice.reference || `${documentLabel} ${documentId ?? ''}`).trim()
    const messageId = crypto.randomUUID()
    const senderEmail = organization.brevo_sender_email || Deno.env.get('BREVO_SENDER_EMAIL') || 'noreply@senvia.pt'
    const senderName = organization.name || 'SENVIA OS'
    const html = renderFiscalDocumentEmailTemplate({
      organizationName: senderName,
      logoUrl: organization.logo_url,
      recipientName: invoice.client_name || 'Cliente',
      documentType: documentLabel,
      documentNumber: reference,
      issueDate: invoice.date,
    })
    const pdfName = `${reference}.pdf`
    const attempts = Number(invoice.email_attempts || 0) + 1

    let sentMessageId: string
    try {
      const result = await sendFiscalPdfWithBrevo(apiKey, {
        to: recipient,
        toName: invoice.client_name || recipient,
        senderEmail,
        senderName,
        replyTo: senderEmail,
        subject: `${documentLabel} ${reference}`,
        html,
        pdfName,
        idempotencyKey: messageId,
      }, pdf)
      sentMessageId = result.messageId
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao enviar o email fiscal através da Brevo.'
      const code = error instanceof FiscalEmailError ? 'brevo_email_failed' : 'fiscal_email_failed'
      await supabase.from('invoices').update({
        email_status: 'failed',
        email_attempts: attempts,
        email_last_error: message.slice(0, 1000),
        email_next_retry_at: null,
      }).eq('id', invoice.id).eq('organization_id', organizationId)
      console.error('[send-invoice-email] brevo_failed', { invoiceId: invoice.id, code })
      return json({ error: message, code, manual_review: error instanceof FiscalEmailError && error.ambiguous }, 502)
    }

    const { error: stateError } = await supabase.from('invoices').update({
      email_status: 'sent',
      email_attempts: attempts,
      email_sent_at: new Date().toISOString(),
      email_message_id: sentMessageId,
      email_last_error: null,
      email_next_retry_at: null,
    }).eq('id', invoice.id).eq('organization_id', organizationId)
    if (stateError) {
      return json({
        error: 'O email foi aceite pela Brevo, mas o estado local não foi atualizado. Confirma o histórico antes de reenviar.',
        code: 'email_state_persist_failed',
        manual_review: true,
      }, 500)
    }

    return json({ success: true, messageId: sentMessageId, provider: 'brevo' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível enviar o documento fiscal.'
    console.error('[send-invoice-email] request_failed')
    return json({ error: message }, 500)
  }
})
