import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.57.2'
import {
  documentNumberAsInteger,
  findKeyInvoiceDocumentByIdempotency,
  getKeyInvoicePdf,
  getKeyInvoiceSession,
  identityRawData,
  issueKeyInvoiceDocument,
  issueKeyInvoiceReceipt,
  KeyInvoiceError,
  manualReviewRequired,
  safeKeyInvoiceError,
} from '../_shared/keyinvoice.ts'
import { prepareKeyInvoiceSnapshotContext } from '../_shared/keyinvoice-sale-document.ts'
import { FiscalEmailError, sendFiscalPdfWithBrevo } from '../_shared/fiscal-email.ts'
import {
  fiscalFailureMode,
  fiscalSnapshotContext,
  identityFromFiscalJob,
  resolveFiscalEmailConfig,
  retryAt,
  type FiscalWorkerJob,
  type FiscalWorkerOrganization,
} from '../_shared/fiscal-worker.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

const FISCAL_EMAIL_TRIGGERS: Record<FiscalWorkerJob['document_type'], string> = {
  invoice: 'invoice_email',
  invoice_receipt: 'invoice_receipt_email',
  receipt: 'receipt_email',
  credit_note: 'credit_note_email',
}

type AdminClient = SupabaseClient<any, 'public', any>

interface WorkerOrganization extends FiscalWorkerOrganization {
  logo_url?: string | null
  billing_provider?: string | null
  integrations_enabled?: Record<string, boolean> | null
  keyinvoice_password?: string | null
  keyinvoice_api_url?: string | null
  keyinvoice_sid?: string | null
  keyinvoice_sid_expires_at?: string | null
  keyinvoice_series_config?: Record<string, any> | null
  tax_config?: Record<string, any> | null
  brevo_api_key?: string | null
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function log(step: string, details: Record<string, unknown> = {}): void {
  // Deliberately log only internal IDs/codes. Fiscal snapshots and credentials
  // contain personal or secret data and must never reach the function logs.
  console.log(`[keyinvoice-fiscal-worker] ${step} ${JSON.stringify(details)}`)
}

async function isAuthorized(req: Request, db: AdminClient): Promise<boolean> {
  const provided = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('key')
  if (!provided) return false
  const localSecret = Deno.env.get('CRON_SECRET')
  if (localSecret && provided === localSecret) return true
  const { data, error } = await db.rpc('verify_stripe_cron_secret', { p_secret: provided })
  return !error && data === true
}

async function loadOrganization(db: AdminClient, organizationId: string): Promise<WorkerOrganization> {
  const { data, error } = await db
    .from('organizations')
    .select('id,name,logo_url,billing_provider,integrations_enabled,keyinvoice_password,keyinvoice_api_url,keyinvoice_sid,keyinvoice_sid_expires_at,keyinvoice_series_config,tax_config,brevo_api_key,brevo_sender_email')
    .eq('id', organizationId)
    .single()
  if (error || !data) {
    throw new KeyInvoiceError('Organização fiscal não encontrada', { code: 'organization_not_found', httpStatus: 404 })
  }
  if (data.billing_provider !== 'keyinvoice' || data.integrations_enabled?.keyinvoice === false) {
    throw manualReviewRequired('A integração KeyInvoice não está ativa nesta organização')
  }
  if (!data.keyinvoice_password) {
    throw manualReviewRequired('A organização não tem chave KeyInvoice configurada')
  }
  return data as WorkerOrganization
}

function filePart(value: string | null): string {
  return (value || 'default').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)
}

async function storePdf(
  db: AdminClient,
  job: FiscalWorkerJob,
  identity: ReturnType<typeof identityFromFiscalJob>,
  bytes: Uint8Array,
): Promise<string> {
  const path = `${job.organization_id}/${job.sale_id}/${filePart(identity.docType)}-${filePart(identity.docSeries)}-${filePart(identity.docNum)}.pdf`
  const { error } = await db.storage.from('invoices').upload(path, bytes, {
    contentType: 'application/pdf',
    upsert: true,
  })
  if (error) {
    throw new KeyInvoiceError('Não foi possível guardar o PDF fiscal', {
      code: 'pdf_storage_failed',
      httpStatus: 500,
      retryable: true,
    })
  }
  return path
}

async function fetchAndStorePdf(
  db: AdminClient,
  job: FiscalWorkerJob,
  session: Awaited<ReturnType<typeof getKeyInvoiceSession>>,
  identity: ReturnType<typeof identityFromFiscalJob>,
): Promise<{ path: string | null; state: Record<string, unknown> }> {
  try {
    const bytes = await getKeyInvoicePdf(session, identity)
    return { path: await storePdf(db, job, identity, bytes), state: { status: 'stored' } }
  } catch (error) {
    const safe = safeKeyInvoiceError(error)
    return {
      path: null,
      state: { status: 'pending', errorCode: safe.code, retryable: safe.retryable },
    }
  }
}

async function completeFiscalDocument(
  db: AdminClient,
  job: FiscalWorkerJob,
  claimToken: string,
  identity: ReturnType<typeof identityFromFiscalJob>,
  pdfPath: string | null,
  rawData: Record<string, unknown>,
): Promise<void> {
  if (!identity.docSeries) {
    throw new KeyInvoiceError('O KeyInvoice não devolveu a série do documento emitido', {
      code: 'provider_identity_incomplete',
      httpStatus: 502,
      ambiguous: true,
      manualReview: true,
    })
  }
  const { error } = await db.rpc('complete_recurring_fiscal_document', {
    p_invoice_id: job.id,
    p_claim_token: claimToken,
    p_invoicexpress_id: documentNumberAsInteger(identity),
    p_provider_document_type_code: identity.docType,
    p_provider_series: identity.docSeries,
    p_provider_document_number: identity.docNum,
    p_reference: identity.fullDocNumber,
    p_provider_status: 'final',
    p_pdf_path: pdfPath,
    p_raw_data: rawData,
    p_provider_atcud: identity.atcud,
    p_issued_at: new Date().toISOString(),
  })
  if (error) {
    throw new KeyInvoiceError('O documento foi emitido, mas não foi possível concluir o registo local', {
      code: 'issued_but_not_persisted',
      httpStatus: 500,
      ambiguous: true,
      manualReview: true,
    })
  }
}

async function issuePrimaryDocument(
  db: AdminClient,
  org: WorkerOrganization,
  job: FiscalWorkerJob,
  claimToken: string,
): Promise<void> {
  const context = await prepareKeyInvoiceSnapshotContext(db, org, job)
  const frozenLines = Array.isArray(job.fiscal_snapshot?.lines) ? job.fiscal_snapshot.lines : []
  for (let index = 0; index < context.lines.length; index++) {
    const localProductId = frozenLines[index]?.productId
    const providerProductId = context.lines[index]?.productId
    if (!localProductId || !providerProductId) continue
    const { error: mappingError } = await db
      .from('products')
      .update({ keyinvoice_product_id: providerProductId })
      .eq('id', localProductId)
      .eq('organization_id', job.organization_id)
      .is('keyinvoice_product_id', null)
    if (mappingError) {
      throw manualReviewRequired('O produto KeyInvoice já está associado de forma incompatível')
    }
    const { data: persistedMapping, error: mappingReadError } = await db
      .from('products')
      .select('keyinvoice_product_id')
      .eq('id', localProductId)
      .eq('organization_id', job.organization_id)
      .single()
    if (mappingReadError || persistedMapping?.keyinvoice_product_id !== providerProductId) {
      throw manualReviewRequired('O produto local tem outro identificador no KeyInvoice')
    }
  }
  const identity = await issueKeyInvoiceDocument(context.session, {
    kind: context.kind,
    lines: context.lines,
    clientId: context.providerClientId,
    clientVATIN: context.clientNif,
    clientName: context.clientName,
    comments: context.comments,
    docSeries: context.docSeries,
  })
  const pdf = await fetchAndStorePdf(db, job, context.session, identity)
  const productMappings = context.lines.map((line, index) => ({
    productId: frozenLines[index]?.productId ?? null,
    code: frozenLines[index]?.code ?? null,
    providerProductId: line.productId,
  }))
  await completeFiscalDocument(db, job, claimToken, identity, pdf.path, identityRawData(identity, {
    fiscalDate: context.fiscalDate,
    idempotencyKey: context.idempotencyKey,
    productMappings,
    pdf: pdf.state,
  }))
}

async function issueReceipt(
  db: AdminClient,
  org: WorkerOrganization,
  job: FiscalWorkerJob,
  claimToken: string,
): Promise<void> {
  if (!job.related_invoice_id || !job.payment_id) {
    throw manualReviewRequired('O recibo não está ligado ao pagamento e à Fatura de origem')
  }
  const [{ data: related, error: relatedError }, { data: payment, error: paymentError }] = await Promise.all([
    db.from('invoices').select('*').eq('id', job.related_invoice_id).eq('organization_id', job.organization_id).single(),
    db.from('sale_payments').select('id,status,amount,reversal_status,reversed_amount').eq('id', job.payment_id).eq('organization_id', job.organization_id).single(),
  ])
  if (relatedError || !related || related.processing_status !== 'issued' || related.document_type !== 'invoice') {
    throw manualReviewRequired('A Fatura de origem do recibo não está emitida')
  }
  if (paymentError || !payment || payment.status !== 'paid') {
    throw manualReviewRequired('O pagamento do recibo deixou de estar confirmado')
  }
  if (payment.reversal_status && payment.reversal_status !== 'none') {
    throw manualReviewRequired('O pagamento foi revertido antes da emissão do recibo')
  }

  const original = identityFromFiscalJob(related as FiscalWorkerJob)
  const snapshot = fiscalSnapshotContext(job.fiscal_snapshot)
  const clientName = String(snapshot.client.name || '').trim()
  const session = await getKeyInvoiceSession(db, org, job.organization_id)
  const amount = Number(job.total)
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount - Number(payment.amount)) > 0.01) {
    throw manualReviewRequired('O valor congelado do recibo não coincide com o pagamento confirmado')
  }
  const identity = await issueKeyInvoiceReceipt(session, {
    original,
    amount,
    client: {
      name: clientName || 'Cliente',
      address: snapshot.client.address,
      postalCode: snapshot.client.postalCode ?? snapshot.client.postal_code,
      locality: snapshot.client.locality,
      countryCode: snapshot.client.countryCode ?? snapshot.client.country_code,
    },
  })
  const pdf = await fetchAndStorePdf(db, job, session, identity)
  await completeFiscalDocument(db, job, claimToken, identity, pdf.path, identityRawData(identity, {
    fiscalDate: snapshot.fiscalDate,
    sourceDocument: original,
    paymentId: job.payment_id,
    pdf: pdf.state,
  }))
}

async function notifyFiscalAlert(
  job: FiscalWorkerJob,
  title: string,
  body: string,
): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return
  try {
    await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        organization_id: job.organization_id,
        title,
        body,
        url: '/financeiro/faturas',
        tag: `fiscal-${job.id}`,
      }),
    })
  } catch {
    // The durable ledger remains the source of truth. An unavailable push
    // channel must never alter or retry a fiscal document.
  }
}

async function failIssue(
  db: AdminClient,
  job: FiscalWorkerJob,
  claimToken: string,
  error: unknown,
): Promise<void> {
  const safe = safeKeyInvoiceError(error)
  const mode = fiscalFailureMode(safe, job.document_type, Number(job.processing_attempts || 1))
  const failureMode = mode === 'reconciliation' ? 'reconciliation_required' : mode
  const { error: rpcError } = await db.rpc('fail_recurring_fiscal_document', {
    p_invoice_id: job.id,
    p_claim_token: claimToken,
    p_error: `[${safe.code}] ${safe.message}`,
    p_failure_mode: failureMode,
    p_retry_after: mode === 'retry' ? retryAt(Number(job.processing_attempts || 1)) : null,
  })
  if (rpcError) log('fail-rpc-error', { jobId: job.id, code: rpcError.code })
  if (mode !== 'retry') {
    await notifyFiscalAlert(
      job,
      mode === 'reconciliation' ? 'Documento fiscal a reconciliar' : 'Documento fiscal requer revisão',
      `${job.document_type}: ${safe.message}`,
    )
  }
  log('issue-failed', { jobId: job.id, code: safe.code, mode })
}

async function processIssueJob(db: AdminClient, job: FiscalWorkerJob, claimToken: string): Promise<boolean> {
  try {
    // A claim may predate a mode change. Recheck the activation boundary before
    // making any fiscal API call, including when the job was queued earlier.
    const { data: cycle, error: cycleError } = await db
      .from('sale_recurring_cycles')
      .select('id,recurrence_id,period_start')
      .eq('id', job.recurring_cycle_id)
      .eq('organization_id', job.organization_id)
      .single()
    if (cycleError || !cycle) {
      throw manualReviewRequired('Não foi possível validar o ciclo antes da emissão fiscal')
    }
    const { data: recurrence, error: recurrenceError } = await db
      .from('sale_recurrences')
      .select('id,fiscal_mode,fiscal_auto_start_after')
      .eq('id', cycle.recurrence_id)
      .eq('organization_id', job.organization_id)
      .single()
    if (recurrenceError || !recurrence || recurrence.fiscal_mode !== 'automatic') {
      throw manualReviewRequired('A emissão automática da recorrência não está ativa ou não pôde ser validada')
    }
    if (recurrence.fiscal_auto_start_after && cycle.period_start <= recurrence.fiscal_auto_start_after) {
      throw manualReviewRequired('Este ciclo já existia quando a emissão automática foi ativada; requer revisão manual')
    }
    const org = await loadOrganization(db, job.organization_id)
    if (job.document_type === 'invoice' || job.document_type === 'invoice_receipt') {
      await issuePrimaryDocument(db, org, job, claimToken)
    } else if (job.document_type === 'receipt') {
      await issueReceipt(db, org, job, claimToken)
    } else {
      // API 5's partial credit-note contract has not yet been proven against a
      // demo account. Never guess a fiscal write; keep the queued refund and
      // exact source document visible for an authorized human.
      throw manualReviewRequired('A nota de crédito automática aguarda validação do contrato na conta demo')
    }
    log('issued', { jobId: job.id, kind: job.document_type })
    return true
  } catch (error) {
    await failIssue(db, job, claimToken, error)
    return false
  }
}

async function runIssue(db: AdminClient): Promise<Record<string, number>> {
  // A recurring cycle may have been created days before it became due. Trigger
  // callbacks cannot run merely because Lisbon crossed midnight, so every
  // issue pass first materializes the now-due, idempotent fiscal jobs.
  const { data: scheduled, error: scheduleError } = await db.rpc(
    'schedule_due_recurring_fiscal_documents',
    { p_limit: 250 },
  )
  if (scheduleError) {
    throw new Error(`schedule_due_recurring_fiscal_documents: ${scheduleError.code || 'error'}`)
  }
  const claimToken = crypto.randomUUID()
  const { data, error } = await db.rpc('claim_recurring_fiscal_documents', {
    p_limit: 25,
    p_worker_id: claimToken,
  })
  if (error) throw new Error(`claim_recurring_fiscal_documents: ${error.code || 'error'}`)
  let completed = 0
  let failed = 0
  for (const row of (data || []) as FiscalWorkerJob[]) {
    if (await processIssueJob(db, row, claimToken)) completed++
    else failed++
  }
  return { scheduled: Number(scheduled || 0), claimed: data?.length || 0, completed, failed }
}

async function runReconcile(db: AdminClient): Promise<Record<string, number>> {
  const claimToken = crypto.randomUUID()
  const { data, error } = await db.rpc('claim_fiscal_reconciliation', {
    p_limit: 25,
    p_worker_id: claimToken,
  })
  if (error) throw new Error(`claim_fiscal_reconciliation: ${error.code || 'error'}`)
  let reconciled = 0
  let unresolved = 0
  for (const job of (data || []) as FiscalWorkerJob[]) {
    try {
      if (job.document_type !== 'invoice' && job.document_type !== 'invoice_receipt') {
        const { error: unresolvedError } = await db.rpc('mark_fiscal_reconciliation_unresolved', {
          p_invoice_id: job.id,
          p_claim_token: claimToken,
          p_error: 'Este tipo de documento não tem marcador de idempotência pesquisável no contrato API validado.',
        })
        if (unresolvedError) throw unresolvedError
        await notifyFiscalAlert(job, 'Reconciliação fiscal manual', 'Confirme este documento diretamente no KeyInvoice.')
        unresolved++
        continue
      }
      const org = await loadOrganization(db, job.organization_id)
      const session = await getKeyInvoiceSession(db, org, job.organization_id)
      const snapshot = fiscalSnapshotContext(job.fiscal_snapshot)
      const identity = await findKeyInvoiceDocumentByIdempotency(session, job.fiscal_idempotency_key, {
        docType: job.provider_document_type_code,
        fiscalDate: snapshot.fiscalDate || null,
      })
      if (!identity) {
        const { error: unresolvedError } = await db.rpc('mark_fiscal_reconciliation_unresolved', {
          p_invoice_id: job.id,
          p_claim_token: claimToken,
          p_error: 'Não foi encontrado no KeyInvoice um documento único para a chave de idempotência.',
        })
        if (unresolvedError) throw unresolvedError
        await notifyFiscalAlert(job, 'Reconciliação fiscal sem correspondência', 'Confirme o documento no KeyInvoice antes de tentar novamente.')
        unresolved++
        continue
      }
      const pdf = await fetchAndStorePdf(db, job, session, identity)
      await completeFiscalDocument(db, job, claimToken, identity, pdf.path, identityRawData(identity, {
        reconciledBy: 'idempotency-marker',
        idempotencyKey: job.fiscal_idempotency_key,
        pdf: pdf.state,
      }))
      reconciled++
    } catch (reconcileError) {
      // Leave a transient read failure claimed. The database releases stale
      // reconciliation claims after 15 minutes; no write is ever retried here.
      const safe = safeKeyInvoiceError(reconcileError)
      log('reconcile-read-failed', { jobId: job.id, code: safe.code })
    }
  }
  return { claimed: data?.length || 0, reconciled, unresolved }
}

async function loadPdfForEmail(
  db: AdminClient,
  org: WorkerOrganization,
  job: FiscalWorkerJob,
): Promise<Uint8Array> {
  if (job.pdf_path) {
    const { data, error } = await db.storage.from('invoices').download(job.pdf_path)
    if (!error && data) return new Uint8Array(await data.arrayBuffer())
  }
  const identity = identityFromFiscalJob(job)
  const session = await getKeyInvoiceSession(db, org, job.organization_id)
  const bytes = await getKeyInvoicePdf(session, identity)
  const path = await storePdf(db, job, identity, bytes)
  const { error: updateError } = await db.from('invoices').update({ pdf_path: path }).eq('id', job.id)
  if (updateError) throw new Error('O PDF foi recuperado, mas o caminho não pôde ser guardado')
  return bytes
}

async function runEmail(db: AdminClient): Promise<Record<string, number>> {
  const claimToken = crypto.randomUUID()
  const { data, error } = await db.rpc('claim_fiscal_email_deliveries', {
    p_limit: 50,
    p_worker_id: claimToken,
  })
  if (error) throw new Error(`claim_fiscal_email_deliveries: ${error.code || 'error'}`)
  let sent = 0
  let failed = 0
  for (const job of (data || []) as FiscalWorkerJob[]) {
    try {
      const org = await loadOrganization(db, job.organization_id)
      const apiKey = Deno.env.get('BREVO_TRANSACTIONAL_API_KEY')
        || org.brevo_api_key
        || Deno.env.get('BREVO_API_KEY')
      if (!apiKey) throw new Error('A organização não tem Brevo configurado')
      const identity = identityFromFiscalJob(job)
      const pdf = await loadPdfForEmail(db, org, job)
      const { data: emailTemplate, error: templateError } = await db
        .from('email_templates')
        .select('subject,html_content')
        .eq('organization_id', job.organization_id)
        .eq('is_active', true)
        .eq('automation_trigger_type', FISCAL_EMAIL_TRIGGERS[job.document_type])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (templateError) throw new Error('Não foi possível consultar o template de email fiscal')
      if (!emailTemplate) throw new Error('Configure um template HTML ativo para este documento em Marketing → Templates')
      org.brevo_sender_email = org.brevo_sender_email
        || Deno.env.get('BREVO_SENDER_EMAIL')
        || 'noreply@senvia.pt'
      const config = resolveFiscalEmailConfig(job, org, identity, emailTemplate)
      const delivered = await sendFiscalPdfWithBrevo(apiKey, config, pdf)
      const { error: completeError } = await db.rpc('complete_fiscal_email_delivery', {
        p_invoice_id: job.id,
        p_claim_token: claimToken,
        p_message_id: delivered.messageId,
      })
      if (completeError) throw new Error('O email foi aceite, mas o estado local não foi atualizado')
      sent++
    } catch (emailError) {
      const attempts = Number(job.email_attempts || 1)
      const retryable = attempts < 5
        && (!(emailError instanceof FiscalEmailError) || emailError.retryable)
        // A timeout/network failure after the POST may mean Brevo accepted the
        // email. Retry once, inside Brevo's idempotency window; after that a
        // human must reconcile rather than risk a duplicate attachment.
        && (!(emailError instanceof FiscalEmailError) || !emailError.ambiguous || attempts < 2)
      const message = emailError instanceof Error ? emailError.message : 'Falha no envio do email fiscal'
      const { error: failError } = await db.rpc('fail_fiscal_email_delivery', {
        p_invoice_id: job.id,
        p_claim_token: claimToken,
        p_error: message.slice(0, 1000),
        p_retryable: retryable,
        p_retry_after: retryable ? retryAt(attempts) : null,
      })
      if (failError) log('email-fail-rpc-error', { jobId: job.id, code: failError.code })
      if (!retryable) {
        await notifyFiscalAlert(job, 'Envio do documento fiscal falhou', 'Revise o destinatário e a configuração Brevo.')
      }
      failed++
    }
  }
  return { claimed: data?.length || 0, sent, failed }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!supabaseUrl || !serviceKey) return json({ error: 'server_not_configured' }, 500)
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  if (!(await isAuthorized(req, db))) return json({ error: 'unauthorized' }, 401)

  let action = ''
  try {
    const body = await req.json()
    action = typeof body?.action === 'string' ? body.action : ''
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  try {
    if (action === 'issue') return json({ ok: true, action, ...(await runIssue(db)) })
    if (action === 'reconcile') return json({ ok: true, action, ...(await runReconcile(db)) })
    if (action === 'email') return json({ ok: true, action, ...(await runEmail(db)) })
    return json({ error: 'invalid_action' }, 400)
  } catch (error) {
    log('action-failed', { action, message: error instanceof Error ? error.message.slice(0, 160) : 'unknown' })
    return json({ error: 'worker_failed', action }, 500)
  }
})
