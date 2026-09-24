/** Vendus API v1.1 client. API keys stay on the server and are never put in URLs. */
const VENDUS_BASE_URL = 'https://www.vendus.pt/ws/v1.1'

export class VendusError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string,
    public readonly providerCode?: string) {
    super(message)
    this.name = 'VendusError'
  }
}

function vendusUrl(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new VendusError('Caminho Vendus inválido', 500, 'invalid_api_path')
  }
  return `${VENDUS_BASE_URL}${path}`
}

function apiHeaders(apiKey: string, headers?: HeadersInit): Headers {
  const result = new Headers(headers)
  result.set('Authorization', `Bearer ${apiKey}`)
  result.set('Accept', 'application/json')
  return result
}

export async function vendusRequest<T = any>(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!apiKey?.trim()) throw new VendusError('Chave API Vendus não configurada', 400, 'missing_api_key')
  const headers = apiHeaders(apiKey, init.headers)
  if (init.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(vendusUrl(path), { ...init, headers })
  } catch {
    throw new VendusError('Não foi possível contactar a Vendus. Confirme o documento antes de repetir.', 503, 'network_error')
  }
  if (!response.ok) {
    // Only expose a short, scrubbed validation message. Never log provider
    // payloads, which may contain customer data or credentials.
    const status = response.status
    let providerCode: string | undefined
    let providerMessage: string | undefined
    if (status === 400 || status === 422) {
      try {
        const body = await response.json()
        const issue = Array.isArray(body?.errors) ? body.errors[0] : body?.error
        const rawCode = typeof issue === 'object' ? issue?.code : undefined
        if (typeof rawCode === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(rawCode)) providerCode = rawCode
        const rawMessage = typeof issue === 'object' ? issue?.message : issue
        if (typeof rawMessage === 'string') {
          providerMessage = rawMessage.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
            .replace(/\b\d{9}\b/g, '[NIF]')
            .replace(/\b[A-Za-z0-9_-]{30,}\b/g, '[identificador]')
            .replace(/[\r\n]+/g, ' ').trim().slice(0, 180)
        }
      } catch { /* use the safe generic message */ }
    }
    const code = status === 401 || status === 403 ? 'invalid_credentials'
      : status === 429 ? 'rate_limited'
      : status === 422 || status === 400 ? 'invalid_document'
      : status === 409 ? 'duplicate_document'
      : 'provider_error'
    const message = status === 401 || status === 403
      ? 'A Vendus recusou a chave API ou as permissões do utilizador.'
      : status === 429
      ? 'Limite de pedidos da Vendus atingido. Tente novamente mais tarde.'
      : status === 422 || status === 400
      ? `A Vendus rejeitou o documento${providerMessage ? `: ${providerMessage}` : '. Verifica cliente, artigos, impostos e série.'}`
      : status === 409
      ? 'A Vendus já recebeu este documento. Confirme o estado antes de repetir.'
      : `A Vendus não conseguiu processar o pedido (${status}).`
    throw new VendusError(message, status, code, providerCode)
  }
  try {
    return await response.json() as T
  } catch {
    throw new VendusError('Resposta inesperada da Vendus', 502, 'invalid_response')
  }
}

export async function getVendusPdf(apiKey: string, id: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new VendusError('Documento Vendus inválido', 400, 'invalid_document_id')
  let response: Response
  try {
    response = await fetch(vendusUrl(`/documents/${id}.pdf?mode=normal`), {
      headers: apiHeaders(apiKey, { Accept: 'application/pdf' }),
    })
  } catch {
    throw new VendusError('Não foi possível obter o PDF da Vendus', 503, 'pdf_network_error')
  }
  if (!response.ok) throw new VendusError('Não foi possível obter o PDF da Vendus', response.status, 'pdf_unavailable')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length < 5 || bytes.length > 20_000_000 ||
    String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') {
    throw new VendusError('O ficheiro devolvido pela Vendus não é um PDF válido', 502, 'invalid_pdf')
  }
  return bytes
}

export interface VendusIdentity {
  id: number
  type: 'FT' | 'FR' | 'RG' | 'NC'
  series: string
  number: string
  reference: string
  atcud: string | null
}

/** Parse the full fiscal number returned by Vendus; never invent a series. */
export function parseVendusIdentity(document: Record<string, unknown>): VendusIdentity {
  const id = Number(document.id)
  const type = String(document.type || '').trim().toUpperCase()
  const reference = String(document.number || '').trim()
  const match = /^(FT|FR|RG|NC)\s+(.+)\/([^/]+)$/.exec(reference)
  if (!Number.isSafeInteger(id) || id <= 0 || !match || type !== match[1]) {
    throw new VendusError('A Vendus não devolveu a identidade fiscal completa do documento', 502, 'missing_fiscal_identity')
  }
  const series = match[2].trim()
  const number = match[3].trim()
  if (!series || !number) {
    throw new VendusError('A Vendus não devolveu a série ou o número fiscal', 502, 'missing_fiscal_identity')
  }
  return { id, type: type as VendusIdentity['type'], series, number, reference,
    atcud: typeof document.atcud === 'string' && document.atcud.trim() ? document.atcud.trim() : null }
}
