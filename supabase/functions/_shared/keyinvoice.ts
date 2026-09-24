/**
 * Shared KeyInvoice API 5 client.
 *
 * This module deliberately contains no HTTP endpoint authorization. Scheduled
 * workers import these service-safe functions directly; browser-facing edge
 * functions must authorize the caller before using them.
 */

export const DEFAULT_KEYINVOICE_API_URL = 'https://login.keyinvoice.com/API5.php'
export const LISBON_TIME_ZONE = 'Europe/Lisbon'

// These are the document type codes already exercised by the existing
// integration. Receipt and credit-note codes must be taken from the API
// response, never guessed from a UI label.
export const KEYINVOICE_ISSUE_DOC_TYPES = {
  invoice: '4',
  invoice_receipt: '34',
} as const

const SUPPORTED_METHODS = new Set([
  'authenticate',
  'insertClient',
  'listClients',
  'insertProduct',
  'listProducts',
  'insertDocument',
  'insertReceipt',
  'getDocumentPDF',
  'sendDocumentPDF2Email',
  'setDocumentVoid',
  'listDocuments',
])
const FISCAL_WRITE_METHODS = new Set(['insertDocument', 'insertReceipt', 'setDocumentVoid'])

const BASE_ALLOWED_HOSTS = new Set(['login.keyinvoice.com', 'demo.keyinvoice.com'])

export interface KeyInvoiceOrganization {
  keyinvoice_password?: string | null
  keyinvoice_api_url?: string | null
  keyinvoice_sid?: string | null
  keyinvoice_sid_expires_at?: string | null
}

export interface KeyInvoiceSession {
  apiUrl: string
  sid: string
}

export interface KeyInvoiceDocumentIdentity {
  provider: 'keyinvoice'
  docType: string
  docSeries: string | null
  docNum: string
  fullDocNumber: string
  atcud: string | null
  identityKey: string
}

export interface KeyInvoiceClientInput {
  name: string
  vatin: string
  email?: string | null
  phone?: string | null
  address?: string | null
  locality?: string | null
  postalCode?: string | null
  country?: string | null
}

export interface KeyInvoiceProductInput {
  localId?: string | null
  /** Exact provider identifier frozen into the fiscal snapshot before claim. */
  providerProductId?: string | null
  code?: string | null
  name: string
  unitPrice: number
  taxValue: number
  taxExemptionReason?: string | null
}

export interface KeyInvoiceResult<T = unknown> {
  Status: number
  Data?: T
  ErrorCode?: string | number
  ErrorMessage?: string
  Sid?: string
}

export class KeyInvoiceError extends Error {
  readonly code: string
  readonly httpStatus: number
  readonly retryable: boolean
  readonly manualReview: boolean
  readonly ambiguous: boolean

  constructor(
    message: string,
    options: { code?: string; httpStatus?: number; retryable?: boolean; manualReview?: boolean; ambiguous?: boolean } = {},
  ) {
    super(message)
    this.name = 'KeyInvoiceError'
    this.code = options.code || 'keyinvoice_error'
    this.httpStatus = options.httpStatus || 502
    this.retryable = options.retryable ?? false
    this.manualReview = options.manualReview ?? false
    this.ambiguous = options.ambiguous ?? false
  }
}

export function manualReviewRequired(message: string): KeyInvoiceError {
  return new KeyInvoiceError(message, {
    code: 'manual_review_required',
    httpStatus: 422,
    manualReview: true,
  })
}

function allowedHosts(): Set<string> {
  const hosts = new Set(BASE_ALLOWED_HOSTS)
  let configured = ''
  try {
    configured = Deno.env.get('KEYINVOICE_ALLOWED_HOSTS') || ''
  } catch {
    // Unit tests and other restricted runtimes may not grant env access. The
    // fixed official allowlist remains safe in that case.
  }
  for (const host of configured.split(',')) {
    const clean = host.trim().toLowerCase()
    if (clean) hosts.add(clean)
  }
  return hosts
}

/** Reject arbitrary URLs so an organization setting cannot exfiltrate the API key/SID. */
export function resolveKeyInvoiceApiUrl(configured?: string | null): string {
  const raw = configured?.trim() || DEFAULT_KEYINVOICE_API_URL
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new KeyInvoiceError('Endereço da API KeyInvoice inválido', {
      code: 'invalid_api_url',
      httpStatus: 400,
    })
  }

  if (url.protocol !== 'https:' || !allowedHosts().has(url.hostname.toLowerCase())) {
    throw new KeyInvoiceError('O endereço da API KeyInvoice não é permitido', {
      code: 'api_host_not_allowed',
      httpStatus: 400,
    })
  }
  if (url.username || url.password || url.port) {
    throw new KeyInvoiceError('O endereço da API KeyInvoice não é permitido', {
      code: 'api_url_credentials_not_allowed',
      httpStatus: 400,
    })
  }

  // API5.php is the only endpoint used by this integration. Query strings and
  // fragments are rejected to keep credentials away from user-controlled URLs.
  if (!/\/API5\.php$/i.test(url.pathname) || url.search || url.hash) {
    throw new KeyInvoiceError('O endereço deve apontar para o endpoint oficial API5.php', {
      code: 'invalid_api_path',
      httpStatus: 400,
    })
  }
  return url.toString()
}

export function lisbonFiscalDate(value: Date | string | number = new Date()): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new KeyInvoiceError('Data fiscal inválida', { code: 'invalid_fiscal_date', httpStatus: 400 })
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LISBON_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${byType.year}-${byType.month}-${byType.day}`
}

export function normalizeCountryCode(country?: string | null): string {
  const value = (country || '').trim()
  if (!value) return 'PT'
  const upper = value.toUpperCase()
  if (/^[A-Z]{2}$/.test(upper)) return upper
  const countries: Record<string, string> = {
    PORTUGAL: 'PT', ESPANHA: 'ES', SPAIN: 'ES', FRANCA: 'FR', FRANÇA: 'FR', FRANCE: 'FR',
    ALEMANHA: 'DE', GERMANY: 'DE', ITALIA: 'IT', ITÁLIA: 'IT', ITALY: 'IT',
    BRASIL: 'BR', BRAZIL: 'BR', ANGOLA: 'AO', MOCAMBIQUE: 'MZ', MOÇAMBIQUE: 'MZ',
    'CABO VERDE': 'CV', BELGICA: 'BE', BÉLGICA: 'BE', BELGIUM: 'BE',
    'PAISES BAIXOS': 'NL', 'PAÍSES BAIXOS': 'NL', NETHERLANDS: 'NL',
    'REINO UNIDO': 'GB', 'UNITED KINGDOM': 'GB', 'ESTADOS UNIDOS': 'US',
    'UNITED STATES': 'US', SUICA: 'CH', SUÍÇA: 'CH', SWITZERLAND: 'CH',
  }
  return countries[upper] || 'PT'
}

function providerMessage(value: unknown): string {
  if (typeof value !== 'string') return ''
  // Do not echo credentials, tokens, email addresses or full provider payloads.
  return value
    .replace(/(?:api[-_ ]?key|apikey|sid|token|password)\s*[:=]\s*\S+/gi, '[credencial removida]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removido]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}

export function safeKeyInvoiceError(error: unknown): { message: string; code: string; status: number; retryable: boolean; manual_review: boolean; ambiguous: boolean } {
  if (error instanceof KeyInvoiceError) {
    return {
      message: error.message,
      code: error.code,
      status: error.httpStatus,
      retryable: error.retryable,
      manual_review: error.manualReview,
      ambiguous: error.ambiguous,
    }
  }
  return {
    message: 'O serviço KeyInvoice não concluiu a operação',
    code: 'keyinvoice_unexpected_error',
    status: 500,
    retryable: false,
    manual_review: false,
    ambiguous: false,
  }
}

export async function callKeyInvoice<T = unknown>(
  apiUrl: string,
  payload: Record<string, unknown>,
  credentials: { sid?: string; apiKey?: string },
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<KeyInvoiceResult<T>> {
  const method = String(payload.method || '')
  if (!SUPPORTED_METHODS.has(method)) {
    throw new KeyInvoiceError('Operação KeyInvoice não permitida', {
      code: 'unsupported_method',
      httpStatus: 400,
    })
  }
  const url = resolveKeyInvoiceApiUrl(apiUrl)
  if (!credentials.sid && !credentials.apiKey) {
    throw new KeyInvoiceError('Credencial KeyInvoice em falta', {
      code: 'missing_credentials',
      httpStatus: 400,
    })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000)
  try {
    const response = await (options.fetcher || fetch)(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(credentials.sid ? { Sid: credentials.sid } : {}),
        ...(credentials.apiKey ? { Apikey: credentials.apiKey } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!response.ok) {
      const ambiguous = FISCAL_WRITE_METHODS.has(method)
      throw new KeyInvoiceError(`KeyInvoice indisponível (HTTP ${response.status})`, {
        code: ambiguous ? 'provider_write_result_ambiguous' : 'provider_http_error',
        httpStatus: 502,
        retryable: !ambiguous && (response.status === 408 || response.status === 429 || response.status >= 500),
        manualReview: ambiguous,
        ambiguous,
      })
    }

    let result: KeyInvoiceResult<T>
    try {
      result = await response.json()
    } catch {
      const ambiguous = FISCAL_WRITE_METHODS.has(method)
      throw new KeyInvoiceError('Resposta inválida do KeyInvoice', {
        code: ambiguous ? 'provider_write_result_ambiguous' : 'invalid_provider_response',
        httpStatus: 502,
        retryable: !ambiguous,
        manualReview: ambiguous,
        ambiguous,
      })
    }

    if (Number(result?.Status) !== 1) {
      const detail = providerMessage(result?.ErrorMessage)
      throw new KeyInvoiceError(detail ? `KeyInvoice recusou a operação: ${detail}` : 'KeyInvoice recusou a operação', {
        code: result?.ErrorCode ? `provider_${String(result.ErrorCode)}` : 'provider_rejected',
        httpStatus: 422,
        retryable: false,
      })
    }
    return result
  } catch (error) {
    if (error instanceof KeyInvoiceError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      const ambiguous = FISCAL_WRITE_METHODS.has(method)
      throw new KeyInvoiceError('O KeyInvoice excedeu o tempo de resposta', {
        code: ambiguous ? 'provider_write_result_ambiguous' : 'provider_timeout',
        httpStatus: 504,
        retryable: !ambiguous,
        manualReview: ambiguous,
        ambiguous,
      })
    }
    const ambiguous = FISCAL_WRITE_METHODS.has(method)
    throw new KeyInvoiceError('Não foi possível contactar o KeyInvoice', {
      code: ambiguous ? 'provider_write_result_ambiguous' : 'provider_network_error',
      httpStatus: 502,
      retryable: !ambiguous,
      manualReview: ambiguous,
      ambiguous,
    })
  } finally {
    clearTimeout(timeout)
  }
}

export async function getKeyInvoiceSession(
  db: any,
  org: KeyInvoiceOrganization,
  organizationId: string,
  options: { forceRefresh?: boolean; fetcher?: typeof fetch } = {},
): Promise<KeyInvoiceSession> {
  const apiKey = org.keyinvoice_password?.trim()
  if (!apiKey) {
    throw new KeyInvoiceError('Chave da API KeyInvoice não configurada', {
      code: 'missing_api_key',
      httpStatus: 400,
    })
  }
  const apiUrl = resolveKeyInvoiceApiUrl(org.keyinvoice_api_url)
  const now = Date.now()
  if (!options.forceRefresh && org.keyinvoice_sid && org.keyinvoice_sid_expires_at) {
    const expiresAt = new Date(org.keyinvoice_sid_expires_at).getTime()
    if (Number.isFinite(expiresAt) && expiresAt > now + 5 * 60_000) {
      return { apiUrl, sid: org.keyinvoice_sid }
    }
  }

  const result = await callKeyInvoice(apiUrl, { method: 'authenticate' }, { apiKey }, { fetcher: options.fetcher })
  const sid = typeof result.Sid === 'string' ? result.Sid.trim() : ''
  if (!sid) {
    throw new KeyInvoiceError('O KeyInvoice não devolveu uma sessão válida', {
      code: 'missing_session',
      httpStatus: 502,
    })
  }
  const expiresAt = new Date(now + 60 * 60_000).toISOString()
  const { error: cacheError } = await db
    .from('organizations')
    .update({ keyinvoice_sid: sid, keyinvoice_sid_expires_at: expiresAt })
    .eq('id', organizationId)
  if (cacheError) {
    throw new KeyInvoiceError('Sessão criada, mas não foi possível guardá-la com segurança', {
      code: 'session_cache_failed',
      httpStatus: 500,
      retryable: true,
    })
  }
  return { apiUrl, sid }
}

function collectionFromData(data: unknown, keys: string[]): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data.filter((row) => row && typeof row === 'object') as Array<Record<string, unknown>>
  if (!data || typeof data !== 'object') return []
  const record = data as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) return value.filter((row) => row && typeof row === 'object') as Array<Record<string, unknown>>
    if (value && typeof value === 'object') return [value as Record<string, unknown>]
  }
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) return value.filter((row) => row && typeof row === 'object') as Array<Record<string, unknown>>
  }
  return []
}

export async function resolveKeyInvoiceClient(
  session: KeyInvoiceSession,
  client: KeyInvoiceClientInput,
  fetcher?: typeof fetch,
): Promise<string | null> {
  const name = client.name.trim()
  const vatin = client.vatin.replace(/\s+/g, '').toUpperCase()
  if (!name || !vatin) throw manualReviewRequired('O cliente não tem nome ou NIF válido')

  const payload: Record<string, unknown> = {
    method: 'insertClient',
    Name: name,
    VATIN: vatin,
    CountryCode: normalizeCountryCode(client.country),
  }
  if (client.email) payload.Email = client.email.trim()
  if (client.phone) payload.Phone = client.phone.trim()
  if (client.address) payload.Address = client.address.trim()
  if (client.locality) payload.Locality = client.locality.trim()
  if (client.postalCode) payload.PostalCode = client.postalCode.trim()

  try {
    const inserted = await callKeyInvoice<Record<string, unknown>>(
      session.apiUrl,
      payload,
      { sid: session.sid },
      { fetcher },
    )
    const row = inserted.Data || {}
    const insertedId = identityPart(row.IdClient ?? row.Id ?? row.id)
    if (insertedId) return insertedId
  } catch (error) {
    // Existing VAT numbers commonly make insertClient fail; resolve the exact
    // existing client below. Network/timeout failures remain retryable.
    if (error instanceof KeyInvoiceError && error.retryable) throw error
  }

  const listed = await callKeyInvoice(
    session.apiUrl,
    { method: 'listClients' },
    { sid: session.sid },
    { fetcher },
  )
  const match = collectionFromData(listed.Data, ['Clients', 'Client']).find((row) =>
    String(row.VATIN ?? row.vatin ?? '').replace(/\s+/g, '').toUpperCase() === vatin
  )
  return match ? identityPart(match.IdClient ?? match.Id ?? match.id) : null
}

function stableProductCode(product: KeyInvoiceProductInput): string {
  const preferred = (product.code || '').trim()
  const raw = preferred || (product.localId ? `SENVIA-${product.localId}` : `SENVIA-${product.name}`)
  const clean = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  if (!clean) throw manualReviewRequired(`O produto "${product.name}" não tem código fiscal válido`)
  return clean.slice(0, 40)
}

export async function resolveKeyInvoiceProducts(
  session: KeyInvoiceSession,
  requested: KeyInvoiceProductInput[],
  fetcher?: typeof fetch,
): Promise<Map<number, string>> {
  const resolved = new Map<number, string>()
  const unresolvedIndexes = requested
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => {
      const frozenId = identityPart(item.providerProductId)
      if (frozenId) {
        resolved.set(index, frozenId)
        return false
      }
      return true
    })

  // An old mapped product can retain 23% at KeyInvoice even when the
  // organization is now exempt. Verify exempt mappings before any document is
  // issued; a mismatch requires a deliberate provider product correction.
  const frozenExempt = requested.filter((item) => identityPart(item.providerProductId) && item.taxValue === 0)
  if (frozenExempt.length > 0) {
    const listed = await callKeyInvoice(session.apiUrl, { method: 'listProducts' }, { sid: session.sid }, { fetcher })
    const providerProducts = collectionFromData(listed.Data, ['Products', 'Product'])
    for (const item of frozenExempt) {
      const frozenId = identityPart(item.providerProductId)
      const exact = providerProducts.find((row) => identityPart(row.IdProduct ?? row.Id ?? row.id) === frozenId)
      const providerTax = Number(exact?.TaxValue ?? exact?.taxValue ?? Number.NaN)
      const providerExemption = exact?.TaxExemptionReasonCode ?? exact?.taxExemptionReasonCode
      if (!exact || !Number.isFinite(providerTax) || providerTax !== 0
        || (providerExemption && providerExemption !== item.taxExemptionReason)) {
        throw manualReviewRequired(`Confirme que o produto "${item.name}" está isento (${item.taxExemptionReason || 'motivo em falta'}) no KeyInvoice antes de emitir`)
      }
    }
  }

  // A claimed worker should normally receive frozen mappings. Avoid a provider
  // read (and especially a create) when every mapping is already immutable.
  if (unresolvedIndexes.length === 0) return resolved

  const listProducts = async (): Promise<Array<Record<string, any>>> => {
    const listed = await callKeyInvoice(
      session.apiUrl,
      { method: 'listProducts' },
      { sid: session.sid },
      { fetcher },
    )
    return collectionFromData(listed.Data, ['Products', 'Product'])
  }
  const products = await listProducts()

  const acceptExact = (item: KeyInvoiceProductInput, code: string, rows: Array<Record<string, any>>): string | null => {
    const exact = rows.find((row) => String(row.IdProduct ?? row.Id ?? row.id ?? '') === code)
    if (!exact) return null
    const id = identityPart(exact.IdProduct ?? exact.Id ?? exact.id)
    if (!id) throw manualReviewRequired(`O produto "${item.name}" não tem identificador no KeyInvoice`)
    const providerTax = Number(exact.TaxValue ?? exact.taxValue ?? Number.NaN)
    if (Number.isFinite(providerTax) && Math.abs(providerTax - item.taxValue) > 0.001) {
      throw manualReviewRequired(`O produto "${item.name}" tem uma taxa de IVA diferente no KeyInvoice`)
    }
    return id
  }

  for (const { item, index } of unresolvedIndexes) {
    const code = stableProductCode(item)
    const existingId = acceptExact(item, code, products)
    if (existingId) {
      resolved.set(index, existingId)
      continue
    }

    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0 || !Number.isFinite(item.taxValue) || item.taxValue < 0) {
      throw manualReviewRequired(`O produto "${item.name}" tem preço ou IVA inválido`)
    }
    if (item.taxValue === 0 && !item.taxExemptionReason) {
      throw manualReviewRequired(`Indique o motivo de isenção de IVA do produto "${item.name}"`)
    }

    try {
      const created = await callKeyInvoice<Record<string, unknown>>(
        session.apiUrl,
        {
          method: 'insertProduct',
          IdProduct: code,
          Name: item.name.trim() || code,
          TaxValue: String(item.taxValue),
          ...(item.taxValue === 0 ? { TaxExemptionReasonCode: item.taxExemptionReason } : {}),
          IsService: '1',
          HasStocks: '0',
          Active: '1',
          Price: String(item.unitPrice),
        },
        { sid: session.sid },
        { fetcher },
      )
      const row = created.Data || {}
      const id = identityPart(row.IdProduct ?? row.Id ?? row.id) || code
      resolved.set(index, id)
      products.push({ IdProduct: id, Name: item.name, TaxValue: item.taxValue })
    } catch (error) {
      // Two workers may resolve the same code before either insertion commits.
      // Re-list after any rejected/uncertain create and accept only an exact
      // code with the exact tax. Otherwise preserve the original failure.
      try {
        const refreshed = await listProducts()
        const racedId = acceptExact(item, code, refreshed)
        if (racedId) {
          resolved.set(index, racedId)
          products.push(...refreshed)
          continue
        }
      } catch (relistError) {
        if (relistError instanceof KeyInvoiceError && relistError.manualReview) throw relistError
      }
      throw error
    }
  }
  return resolved
}

export function prepareKeyInvoiceSaleLines(
  sale: Record<string, unknown>,
  saleItems: Array<Record<string, any>>,
  taxConfig: Record<string, any> = {},
): {
  products: KeyInvoiceProductInput[]
  quantities: number[]
  fiscalSnapshot: Record<string, unknown>
  fiscalDate: string
} {
  const defaultRetention = Number(
    sale.retention_rate ?? sale.retention_percentage ?? sale.retention
      ?? taxConfig.retention_rate ?? taxConfig.retention_percentage ?? taxConfig.retention ?? 0,
  )
  if (!Number.isFinite(defaultRetention) || defaultRetention < 0 || defaultRetention > 100) {
    throw manualReviewRequired('A retenção configurada não é válida para faturação automática')
  }
  if (defaultRetention > 0) {
    throw manualReviewRequired('A emissão automática com retenção requer validação do contrato API na conta demo')
  }
  const defaultTax = Number(taxConfig.tax_value ?? 23)
  const defaultExemption = typeof taxConfig.tax_exemption_reason === 'string' ? taxConfig.tax_exemption_reason : null
  const organizationExempt = defaultTax === 0
  const items = saleItems.length > 0
    ? saleItems
    : [{
      product_id: null,
      name: `Venda ${String(sale.code || sale.id || '')}`.trim(),
      quantity: 1,
      unit_price: Number(sale.subtotal ?? sale.total_value ?? 0),
      product: null,
    }]
  const subtotal = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0)
  const subtotalAfterLineDiscounts = items.reduce((sum, item) => {
    const lineDiscount = Number(item.discount_percent ?? item.discountPercentage ?? 0)
    if (!Number.isFinite(lineDiscount) || lineDiscount < 0 || lineDiscount > 100) return Number.NaN
    return sum + Number(item.quantity || 0) * Number(item.unit_price || 0) * (1 - lineDiscount / 100)
  }, 0)
  const globalDiscount = Math.max(0, Number(sale.discount || 0))
  if (!Number.isFinite(subtotal) || subtotal <= 0 || !Number.isFinite(subtotalAfterLineDiscounts)
    || subtotalAfterLineDiscounts <= 0 || !Number.isFinite(globalDiscount)
    || globalDiscount > subtotalAfterLineDiscounts + 0.005) {
    throw manualReviewRequired('Os totais da venda não são válidos para faturação automática')
  }
  const globalDiscountRatio = globalDiscount > 0 ? globalDiscount / subtotalAfterLineDiscounts : 0
  const discount = subtotal - (subtotalAfterLineDiscounts - globalDiscount)
  const products: KeyInvoiceProductInput[] = []
  const quantities: number[] = []
  const snapshotLines: Array<Record<string, unknown>> = []
  for (const item of items) {
    const quantity = Number(item.quantity)
    const originalUnitPrice = Number(item.unit_price)
    const product = item.product || {}
    const lineDiscountPercent = Number(item.discount_percent ?? item.discountPercentage ?? 0)
    const lineDiscountRatio = lineDiscountPercent / 100
    // A sale item is the immutable commercial snapshot. Product and
    // organization values are fallbacks only when the item did not freeze a
    // field at sale time.
    const taxValue = organizationExempt ? 0
      : Number(item.tax_value ?? item.taxRate ?? product.tax_value ?? product.taxRate ?? defaultTax)
    const exemption = organizationExempt ? defaultExemption
      : item.tax_exemption_reason ?? item.taxExemptionReason
        ?? product.tax_exemption_reason ?? product.taxExemptionReason ?? defaultExemption
    const lineRetention = Number(
      item.retention_rate ?? item.retention_percentage ?? item.retention
        ?? product.retention_rate ?? product.retention_percentage ?? product.retention
        ?? defaultRetention,
    )
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(originalUnitPrice) || originalUnitPrice < 0
      || !Number.isFinite(taxValue) || taxValue < 0 || taxValue > 100
      || !Number.isFinite(lineRetention) || lineRetention < 0 || lineRetention > 100) {
      throw manualReviewRequired(`A linha "${String(item.name || 'Serviço')}" tem dados fiscais inválidos`)
    }
    if (lineRetention > 0) {
      throw manualReviewRequired(`A linha "${String(item.name || 'Serviço')}" tem retenção e exige validação na conta demo`)
    }
    let unitPrice = originalUnitPrice * (1 - lineDiscountRatio) * (1 - globalDiscountRatio)
    const pricesIncludeTax = Boolean(
      item.price_includes_vat ?? item.price_includes_tax
        ?? product.price_includes_vat ?? product.price_includes_tax
        ?? taxConfig.prices_include_vat ?? taxConfig.prices_include_tax ?? false,
    )
    if (pricesIncludeTax && taxValue > 0) unitPrice /= (1 + taxValue / 100)
    unitPrice = Math.round((unitPrice + Number.EPSILON) * 1_000_000) / 1_000_000
    products.push({
      localId: item.product_id || product.id || null,
      providerProductId: item.providerProductId ?? item.keyinvoice_product_id
        ?? product.providerProductId ?? product.keyinvoice_product_id ?? null,
      code: item.product_code || item.code || product.code || product.sku || null,
      name: String(item.name || product.name || 'Serviço'),
      unitPrice,
      taxValue,
      taxExemptionReason: exemption,
    })
    quantities.push(quantity)
    snapshotLines.push({
      localItemId: item.id || null,
      localProductId: item.product_id || product.id || null,
      providerProductId: item.providerProductId ?? item.keyinvoice_product_id
        ?? product.providerProductId ?? product.keyinvoice_product_id ?? null,
      productCode: item.product_code || item.code || product.code || product.sku || null,
      name: String(item.name || product.name || 'Serviço'),
      description: String(item.name || product.name || 'Serviço'),
      quantity,
      originalUnitPrice,
      billedUnitPrice: unitPrice,
      pricesIncludeTax,
      priceIncludesVat: pricesIncludeTax,
      taxValue,
      taxRate: taxValue,
      taxExemptionReason: exemption,
      allocatedDiscount: Math.round(originalUnitPrice * quantity * (1 - (1 - lineDiscountRatio) * (1 - globalDiscountRatio)) * 100) / 100,
      discountPercent: Math.round((1 - (1 - lineDiscountRatio) * (1 - globalDiscountRatio)) * 100_000) / 1_000,
      sourceLineTotal: Math.round(originalUnitPrice * quantity * (1 - lineDiscountRatio) * (1 - globalDiscountRatio) * 100) / 100,
      retentionRate: lineRetention,
    })
  }
  const fiscalDate = lisbonFiscalDate()
  return {
    products,
    quantities,
    fiscalDate,
    fiscalSnapshot: {
      schemaVersion: 1,
      fiscalDate,
      currency: 'EUR',
      subtotal,
      discount,
      retention: defaultRetention,
      lines: snapshotLines,
    },
  }
}

function identityPart(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  return String(value).trim() || null
}

export function documentIdentityFromApi(
  data: unknown,
  fallbackDocType?: string,
): KeyInvoiceDocumentIdentity {
  const row = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const docType = identityPart(row.DocType ?? row.docType ?? fallbackDocType)
  const docSeries = identityPart(row.DocSeries ?? row.docSeries)
  const docNum = identityPart(row.DocNum ?? row.docNum)
  if (!docType || !docNum) {
    throw manualReviewRequired('O KeyInvoice não devolveu a identidade fiscal completa do documento')
  }
  const fullDocNumber = identityPart(row.FullDocNumber ?? row.fullDocNumber)
    || `${docType} ${docSeries ? `${docSeries}/` : ''}${docNum}`
  const atcud = identityPart(row.ATCUD ?? row.Atcud ?? row.atcud)
  return {
    provider: 'keyinvoice',
    docType,
    docSeries,
    docNum,
    fullDocNumber,
    atcud,
    identityKey: `keyinvoice:${docType}:${docSeries || '-'}:${docNum}`,
  }
}

export function documentIdentityFromRawData(
  rawData: unknown,
  fallback?: { docType?: string | null; docNum?: string | number | null },
): KeyInvoiceDocumentIdentity {
  const raw = (rawData && typeof rawData === 'object' ? rawData : {}) as Record<string, unknown>
  const nested = raw.identity && typeof raw.identity === 'object'
    ? raw.identity as Record<string, unknown>
    : raw
  return documentIdentityFromApi({
    DocType: nested.docType ?? nested.DocType ?? fallback?.docType,
    DocSeries: nested.docSeries ?? nested.DocSeries,
    DocNum: nested.docNum ?? nested.DocNum ?? fallback?.docNum,
    FullDocNumber: nested.fullDocNumber ?? nested.FullDocNumber ?? raw.fullDocNumber,
    ATCUD: nested.atcud ?? nested.ATCUD ?? raw.atcud,
  })
}

export function identityRawData(
  identity: KeyInvoiceDocumentIdentity,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    source: 'keyinvoice',
    provider: 'keyinvoice',
    docType: identity.docType,
    docSeries: identity.docSeries,
    docNum: identity.docNum,
    fullDocNumber: identity.fullDocNumber,
    atcud: identity.atcud,
    identityKey: identity.identityKey,
    identity,
    ...extra,
  }
}

export async function issueKeyInvoiceDocument(
  session: KeyInvoiceSession,
  input: {
    kind: 'invoice' | 'invoice_receipt'
    lines: Array<{ productId: string; quantity: number; unitPrice: number }>
    clientId?: string | null
    clientVATIN?: string | null
    clientName?: string | null
    comments?: string | null
    docSeries?: string | null
  },
  fetcher?: typeof fetch,
): Promise<KeyInvoiceDocumentIdentity> {
  if (input.lines.length === 0) throw manualReviewRequired('O documento não tem linhas para faturar')
  const docType = KEYINVOICE_ISSUE_DOC_TYPES[input.kind]
  const payload: Record<string, unknown> = {
    method: 'insertDocument',
    DocType: docType,
    DocLines: input.lines.map((line) => {
      if (!line.productId || !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
        throw manualReviewRequired('Uma linha do documento fiscal tem quantidade ou preço inválido')
      }
      return {
        IdProduct: line.productId,
        Qty: String(line.quantity),
        Price: line.unitPrice.toFixed(6).replace(/0+$/, '').replace(/\.$/, ''),
      }
    }),
  }
  if (input.clientId) payload.IdClient = input.clientId
  else {
    if (!input.clientVATIN || !input.clientName) {
      throw manualReviewRequired('O cliente não tem identificação fiscal suficiente')
    }
    payload.ClientVATIN = input.clientVATIN
    payload.ClientName = input.clientName
  }
  if (input.comments) payload.Comments = input.comments
  if (input.docSeries) payload.DocSeries = input.docSeries

  const result = await callKeyInvoice<Record<string, unknown>>(
    session.apiUrl,
    payload,
    { sid: session.sid },
    { fetcher },
  )
  return documentIdentityFromApi(result.Data, docType)
}

export async function issueKeyInvoiceReceipt(
  session: KeyInvoiceSession,
  input: {
    original: KeyInvoiceDocumentIdentity
    amount: number
    clientId?: string | null
    client?: { name: string; address?: string | null; postalCode?: string | null; locality?: string | null; countryCode?: string | null }
  },
  fetcher?: typeof fetch,
): Promise<KeyInvoiceDocumentIdentity> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw manualReviewRequired('O valor do recibo tem de ser superior a zero')
  }
  const payload: Record<string, unknown> = {
    method: 'insertReceipt',
    DocLines: [{
      DocType: input.original.docType,
      ...(input.original.docSeries ? { DocSeries: input.original.docSeries } : {}),
      DocNum: input.original.docNum,
      SettleValue: input.amount.toFixed(2),
    }],
  }
  if (input.clientId) payload.IdClient = input.clientId
  else if (input.client) {
    payload.Name = input.client.name
    if (input.client.address) payload.Address = input.client.address
    if (input.client.postalCode) payload.PostalCode = input.client.postalCode
    if (input.client.locality) payload.Locality = input.client.locality
    payload.CountryCode = normalizeCountryCode(input.client.countryCode)
  }
  const result = await callKeyInvoice<Record<string, unknown>>(
    session.apiUrl,
    payload,
    { sid: session.sid },
    { fetcher },
  )
  // A receipt code is account/API-contract dependent, so only the returned code is accepted.
  return documentIdentityFromApi(result.Data)
}

function extractBase64Pdf(data: unknown): string | null {
  if (typeof data === 'string') return data.replace(/^data:[^;]+;base64,/, '')
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  for (const key of ['PDF', 'pdf', 'Content', 'content', 'File', 'file', 'Base64', 'base64', 'FileContent', 'Document', 'document', 'PDFContent']) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 100) return value.replace(/^data:[^;]+;base64,/, '')
  }
  return null
}

export async function getKeyInvoicePdf(
  session: KeyInvoiceSession,
  identity: KeyInvoiceDocumentIdentity,
  fetcher?: typeof fetch,
): Promise<Uint8Array> {
  const result = await callKeyInvoice(
    session.apiUrl,
    {
      method: 'getDocumentPDF',
      DocType: identity.docType,
      ...(identity.docSeries ? { DocSeries: identity.docSeries } : {}),
      DocNum: identity.docNum,
    },
    { sid: session.sid },
    { fetcher },
  )
  const base64 = extractBase64Pdf(result.Data)
  if (!base64) {
    throw new KeyInvoiceError('O KeyInvoice não devolveu o PDF do documento', {
      code: 'pdf_missing',
      httpStatus: 502,
      retryable: true,
    })
  }
  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    throw new KeyInvoiceError('O PDF devolvido pelo KeyInvoice é inválido', {
      code: 'invalid_pdf',
      httpStatus: 502,
      retryable: true,
    })
  }
}

export async function sendKeyInvoiceDocumentEmail(
  session: KeyInvoiceSession,
  input: { identity: KeyInvoiceDocumentIdentity; email: string; subject?: string | null; body?: string | null },
  fetcher?: typeof fetch,
): Promise<void> {
  const email = input.email.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new KeyInvoiceError('Endereço de email inválido', { code: 'invalid_email', httpStatus: 400 })
  }
  await callKeyInvoice(
    session.apiUrl,
    {
      method: 'sendDocumentPDF2Email',
      DocType: input.identity.docType,
      ...(input.identity.docSeries ? { DocSeries: input.identity.docSeries } : {}),
      DocNum: input.identity.docNum,
      EmailDestinations: email,
      EmailSubject: (input.subject || 'Documento fiscal').slice(0, 180),
      EmailBody: (input.body || '').slice(0, 20_000),
    },
    { sid: session.sid },
    { fetcher },
  )
}

export async function voidKeyInvoiceDocument(
  session: KeyInvoiceSession,
  input: { identity: KeyInvoiceDocumentIdentity; reason: string },
  fetcher?: typeof fetch,
): Promise<{ generatedDocument: KeyInvoiceDocumentIdentity | null; raw: unknown }> {
  const reason = input.reason.trim()
  if (reason.length < 3) {
    throw new KeyInvoiceError('Indique um motivo de anulação válido', { code: 'invalid_void_reason', httpStatus: 400 })
  }
  const result = await callKeyInvoice<Record<string, unknown>>(
    session.apiUrl,
    {
      method: 'setDocumentVoid',
      DocType: input.identity.docType,
      ...(input.identity.docSeries ? { DocSeries: input.identity.docSeries } : {}),
      DocNum: input.identity.docNum,
      CreditReason: reason,
    },
    { sid: session.sid },
    { fetcher },
  )
  let generatedDocument: KeyInvoiceDocumentIdentity | null = null
  try {
    generatedDocument = documentIdentityFromApi(result.Data)
  } catch (error) {
    if (!(error instanceof KeyInvoiceError) || !error.manualReview) throw error
  }
  return { generatedDocument, raw: result.Data }
}

function collectObjects(value: unknown, output: Array<Record<string, unknown>>, depth = 0): void {
  if (depth > 5 || value === null || value === undefined) return
  if (Array.isArray(value)) {
    for (const child of value) collectObjects(child, output, depth + 1)
    return
  }
  if (typeof value !== 'object') return
  const row = value as Record<string, unknown>
  if ((row.DocNum ?? row.docNum) !== undefined && (row.DocType ?? row.docType) !== undefined) output.push(row)
  for (const child of Object.values(row)) collectObjects(child, output, depth + 1)
}

/** Read-only reconciliation by the complete fiscal identity. */
export async function lookupKeyInvoiceDocument(
  session: KeyInvoiceSession,
  identity: KeyInvoiceDocumentIdentity,
  fetcher?: typeof fetch,
): Promise<Record<string, unknown> | null> {
  const result = await callKeyInvoice(
    session.apiUrl,
    { method: 'listDocuments' },
    { sid: session.sid },
    { fetcher },
  )
  const candidates: Array<Record<string, unknown>> = []
  collectObjects(result.Data, candidates)
  return candidates.find((row) => {
    const type = identityPart(row.DocType ?? row.docType)
    const series = identityPart(row.DocSeries ?? row.docSeries)
    const number = identityPart(row.DocNum ?? row.docNum)
    return type === identity.docType && series === identity.docSeries && number === identity.docNum
  }) || null
}

/**
 * Reconcile an insertDocument call whose HTTP result was ambiguous. The
 * idempotency marker is embedded in Comments before the write. Zero matches
 * means "not found"; more than one is unsafe and requires human review.
 */
export async function findKeyInvoiceDocumentByIdempotency(
  session: KeyInvoiceSession,
  idempotencyKey: string,
  options: { docType?: string | null; fiscalDate?: string | null; fetcher?: typeof fetch } = {},
): Promise<KeyInvoiceDocumentIdentity | null> {
  const key = idempotencyKey.trim()
  if (!key || key.length > 180) {
    throw new KeyInvoiceError('Chave de idempotência fiscal inválida', { code: 'invalid_idempotency_key', httpStatus: 400 })
  }
  const marker = `SENVIA:${key}`
  const result = await callKeyInvoice(
    session.apiUrl,
    { method: 'listDocuments' },
    { sid: session.sid },
    { fetcher: options.fetcher },
  )
  const candidates: Array<Record<string, unknown>> = []
  collectObjects(result.Data, candidates)
  const matches = candidates.filter((row) => {
    const comments = String(row.Comments ?? row.comments ?? row.Observations ?? row.observations ?? '')
    if (!comments.includes(marker)) return false
    const docType = identityPart(row.DocType ?? row.docType)
    if (options.docType && docType !== options.docType) return false
    if (options.fiscalDate) {
      const date = identityPart(row.DocDate ?? row.docDate ?? row.Date ?? row.date)
      if (date && date !== options.fiscalDate) return false
    }
    return true
  })
  if (matches.length === 0) return null
  if (matches.length > 1) {
    throw manualReviewRequired('Foram encontrados vários documentos KeyInvoice para a mesma chave de idempotência')
  }
  return documentIdentityFromApi(matches[0], options.docType || undefined)
}

export function documentNumberAsInteger(identity: KeyInvoiceDocumentIdentity): number {
  if (!/^\d+$/.test(identity.docNum)) {
    throw manualReviewRequired('O número devolvido pelo KeyInvoice não cabe no formato legado da base de dados')
  }
  const value = Number(identity.docNum)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw manualReviewRequired('O número devolvido pelo KeyInvoice não cabe no formato legado da base de dados')
  }
  return value
}
