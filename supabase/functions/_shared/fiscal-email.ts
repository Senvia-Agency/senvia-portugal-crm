export interface FiscalEmailConfig {
  to: string
  toName?: string | null
  cc?: string[]
  bcc?: string[]
  senderEmail: string
  senderName: string
  replyTo?: string | null
  subject: string
  html: string
  pdfName: string
  /** Stable UUID reused for every retry of the same fiscal document. */
  idempotencyKey?: string
}

export interface FiscalEmailResult {
  messageId: string
}

export class FiscalEmailError extends Error {
  readonly retryable: boolean
  readonly ambiguous: boolean

  constructor(message: string, retryable = false, ambiguous = false) {
    super(message)
    this.name = 'FiscalEmailError'
    this.retryable = retryable
    this.ambiguous = ambiguous
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_PDF_BYTES = 20 * 1024 * 1024

function checkedEmail(value: string, field: string): string {
  const normalized = value.trim().toLowerCase()
  if (!EMAIL.test(normalized)) throw new Error(`${field}: endereço de email inválido`)
  return normalized
}

function uniqueEmails(values: string[] | undefined, field: string): string[] {
  const result = [...new Set((values ?? []).filter(Boolean).map((value) => checkedEmail(value, field)))]
  if (result.length > 20) throw new Error(`${field}: máximo de 20 destinatários`)
  return result
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

export function buildFiscalBrevoPayload(config: FiscalEmailConfig, pdf: Uint8Array): Record<string, unknown> {
  if (pdf.length === 0) throw new Error('O PDF fiscal está vazio')
  if (pdf.length > MAX_PDF_BYTES) throw new Error('O PDF fiscal excede 20 MB')
  const to = checkedEmail(config.to, 'Destinatário')
  const sender = checkedEmail(config.senderEmail, 'Remetente')
  const cc = uniqueEmails(config.cc, 'CC').filter((email) => email !== to)
  const bcc = uniqueEmails(config.bcc, 'BCC').filter((email) => email !== to && !cc.includes(email))
  const subject = config.subject.trim().slice(0, 180)
  if (!subject) throw new Error('O assunto do email fiscal é obrigatório')
  const pdfName = config.pdfName.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120)
  if (!pdfName) throw new Error('O nome do PDF fiscal é inválido')
  const idempotencyKey = config.idempotencyKey?.trim()
  if (idempotencyKey && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    throw new Error('A chave de idempotência do email fiscal é inválida')
  }

  return {
    sender: { email: sender, name: config.senderName.trim().slice(0, 70) || 'SENVIA OS' },
    to: [{ email: to, name: config.toName?.trim().slice(0, 100) || to }],
    ...(cc.length ? { cc: cc.map((email) => ({ email })) } : {}),
    ...(bcc.length ? { bcc: bcc.map((email) => ({ email })) } : {}),
    ...(config.replyTo ? { replyTo: { email: checkedEmail(config.replyTo, 'Reply-To') } } : {}),
    subject,
    htmlContent: config.html.slice(0, 100_000),
    attachment: [{ content: bytesToBase64(pdf), name: pdfName.toLowerCase().endsWith('.pdf') ? pdfName : `${pdfName}.pdf` }],
    headers: {
      'X-SENVIA-Category': 'fiscal-document',
      // Brevo interprets this body header specially and suppresses a repeated
      // transactional request during its idempotency window.
      ...(idempotencyKey ? { idempotencyKey } : {}),
    },
  }
}

export async function sendFiscalPdfWithBrevo(
  apiKey: string,
  config: FiscalEmailConfig,
  pdf: Uint8Array,
  fetcher: typeof fetch = fetch,
): Promise<FiscalEmailResult> {
  if (!apiKey.trim()) throw new Error('Brevo não configurado')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetcher('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(buildFiscalBrevoPayload(config, pdf)),
      signal: controller.signal,
    })
    if (!response.ok) {
      let providerError: { code?: unknown; message?: unknown } = {}
      try {
        providerError = await response.clone().json() as { code?: unknown; message?: unknown }
      } catch {
        // Status classification below remains authoritative when Brevo does
        // not return a JSON error body.
      }
      const duplicate = response.status === 400
        && config.idempotencyKey
        && String(providerError.code || '').toLowerCase() === 'duplicate_parameter'
        && /idempoten/i.test(String(providerError.message || 'idempotency'))
      if (duplicate) {
        // The original request was already accepted. Brevo does not repeat the
        // provider message id in this response, so retain a stable local id.
        return { messageId: `brevo-idempotency:${config.idempotencyKey}` }
      }
      throw new FiscalEmailError(
        `Brevo recusou o envio (HTTP ${response.status})`,
        response.status === 408 || response.status === 429 || response.status >= 500,
      )
    }
    const data = await response.json() as { messageId?: unknown }
    const messageId = typeof data.messageId === 'string' ? data.messageId.trim() : ''
    if (!messageId) throw new FiscalEmailError('A Brevo não devolveu o identificador do email', true, true)
    return { messageId }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new FiscalEmailError('A Brevo excedeu o tempo de resposta', true, true)
    }
    if (error instanceof FiscalEmailError) throw error
    if (error instanceof TypeError) throw new FiscalEmailError('Não foi possível contactar a Brevo', true, true)
    throw error
  } finally {
    clearTimeout(timer)
  }
}
