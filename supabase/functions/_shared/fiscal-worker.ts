import type { FiscalEmailConfig } from './fiscal-email.ts'
import type { KeyInvoiceDocumentIdentity } from './keyinvoice.ts'

export type FiscalDocumentKind = 'invoice' | 'invoice_receipt' | 'receipt' | 'credit_note'
export type FiscalFailureMode = 'retry' | 'reconciliation' | 'manual_review'

export interface FiscalWorkerJob {
  id: string
  organization_id: string
  sale_id: string
  recurring_cycle_id: string
  payment_id?: string | null
  related_invoice_id?: string | null
  document_type: FiscalDocumentKind
  provider_document_type_code?: string | null
  provider_series?: string | null
  provider_document_number?: string | null
  provider_atcud?: string | null
  fiscal_idempotency_key: string
  fiscal_snapshot: Record<string, any>
  processing_attempts?: number | null
  email_attempts?: number | null
  total?: number | null
  pdf_path?: string | null
  raw_data?: Record<string, unknown> | null
  reference?: string | null
}

export interface FiscalWorkerOrganization {
  id: string
  name?: string | null
  brevo_sender_email?: string | null
}

export interface FiscalSnapshotContext {
  sale: Record<string, any>
  client: Record<string, any>
  items: Array<Record<string, any>>
  taxConfig: Record<string, any>
  fiscalDate: string
  email: Record<string, any>
  payment: Record<string, any>
  relatedDocument: Record<string, any>
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const candidate = text(value)
    if (candidate) return candidate
  }
  return ''
}

export function fiscalSnapshotContext(snapshotValue: unknown): FiscalSnapshotContext {
  const snapshot = record(snapshotValue)
  const organization = record(snapshot.organization)
  const items = Array.isArray(snapshot.items)
    ? snapshot.items.map((entry: unknown) => {
      const wrapped = record(entry)
      const saleItem = record(wrapped.sale_item ?? wrapped.saleItem ?? wrapped.item ?? wrapped)
      const product = record(wrapped.product ?? saleItem.product)
      return { ...saleItem, product }
    })
    : []

  return {
    sale: record(snapshot.sale),
    client: record(snapshot.client),
    items,
    taxConfig: record(organization.tax_config ?? organization.taxConfig ?? snapshot.tax_config ?? snapshot.taxConfig),
    fiscalDate: firstText(snapshot.fiscal_date, snapshot.fiscalDate),
    email: record(snapshot.email),
    payment: record(snapshot.payment),
    relatedDocument: record(snapshot.related_document ?? snapshot.relatedDocument),
  }
}

export function fiscalDocumentLabel(kind: FiscalDocumentKind): string {
  switch (kind) {
    case 'invoice': return 'Fatura'
    case 'invoice_receipt': return 'Fatura-Recibo'
    case 'receipt': return 'Recibo'
    case 'credit_note': return 'Nota de Crédito'
  }
}

export function retryAt(attempt: number, now = new Date()): string {
  const delaysMinutes = [5, 15, 60, 240, 720]
  const index = Math.max(0, Math.min(Math.trunc(attempt || 1) - 1, delaysMinutes.length - 1))
  return new Date(now.getTime() + delaysMinutes[index] * 60_000).toISOString()
}

export function fiscalFailureMode(
  error: { retryable?: boolean; ambiguous?: boolean; manual_review?: boolean },
  kind: FiscalDocumentKind,
  attempt: number,
): FiscalFailureMode {
  if (error.ambiguous) {
    // FT/FR carry the SENVIA idempotency marker in Comments and can be looked
    // up safely. API 5 does not expose an equivalent verified marker for RC/NC.
    return kind === 'invoice' || kind === 'invoice_receipt'
      ? 'reconciliation'
      : 'manual_review'
  }
  if (error.retryable && attempt < 5) return 'retry'
  return 'manual_review'
}

const TEMPLATE_VARIABLES = new Set(['client_name', 'document_type', 'document_number'])

export function renderFiscalTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/{{\s*([a-z_]+)\s*}}/gi, (whole, name: string) => {
    const key = name.toLowerCase()
    return TEMPLATE_VARIABLES.has(key) ? values[key] || '' : whole
  })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function resolveFiscalEmailConfig(
  job: FiscalWorkerJob,
  organization: FiscalWorkerOrganization,
  identity: KeyInvoiceDocumentIdentity,
): FiscalEmailConfig {
  const snapshot = fiscalSnapshotContext(job.fiscal_snapshot)
  const config = record(snapshot.email.config)
  const recipientMode = config.recipient_mode === 'custom' ? 'custom' : 'client'
  const clientName = firstText(snapshot.client.company, snapshot.client.name, 'Cliente')
  const clientEmail = firstText(snapshot.client.email, snapshot.email.recipient_fallback, snapshot.email.recipientFallback)
  const to = recipientMode === 'custom'
    ? firstText(config.recipient_email)
    : firstText(clientEmail, config.fallback_email)
  if (!to) throw new Error('O documento fiscal não tem destinatário de email')

  const senderEmail = firstText(config.sender_email, organization.brevo_sender_email)
  if (!senderEmail) throw new Error('Configure um remetente Brevo para o envio fiscal')

  const label = fiscalDocumentLabel(job.document_type)
  const documentNumber = identity.fullDocNumber || job.reference || identity.docNum
  const variables = {
    client_name: clientName,
    document_type: label,
    document_number: documentNumber,
  }
  const subjectTemplate = firstText(config.subject_template, '{{document_type}} {{document_number}}')
  const bodyTemplate = firstText(
    config.body_template,
    'Olá {{client_name}},\n\nSegue em anexo o documento {{document_type}} {{document_number}}.',
  )
  const body = renderFiscalTemplate(bodyTemplate, variables)

  return {
    to,
    toName: clientName,
    cc: Array.isArray(config.cc) ? config.cc.filter((value: unknown) => typeof value === 'string') : [],
    bcc: Array.isArray(config.bcc) ? config.bcc.filter((value: unknown) => typeof value === 'string') : [],
    senderEmail,
    senderName: firstText(config.sender_name, organization.name, 'SENVIA OS'),
    replyTo: firstText(config.reply_to, senderEmail),
    subject: renderFiscalTemplate(subjectTemplate, variables),
    html: `<div style="font-family:Arial,sans-serif;white-space:normal">${escapeHtml(body).replace(/\r?\n/g, '<br>')}</div>`,
    pdfName: `${label}-${documentNumber}.pdf`,
    idempotencyKey: job.id,
  }
}

export function identityFromFiscalJob(job: FiscalWorkerJob): KeyInvoiceDocumentIdentity {
  const docType = firstText(job.provider_document_type_code)
  const docSeries = firstText(job.provider_series) || null
  const docNum = firstText(job.provider_document_number)
  if (!docType || !docSeries || !docNum) {
    throw new Error('O documento não tem identidade fiscal completa')
  }
  return {
    provider: 'keyinvoice',
    docType,
    docSeries,
    docNum,
    fullDocNumber: firstText(job.reference, `${docType} ${docSeries}/${docNum}`),
    atcud: firstText(job.provider_atcud) || null,
    identityKey: `keyinvoice:${docType}:${docSeries}:${docNum}`,
  }
}
