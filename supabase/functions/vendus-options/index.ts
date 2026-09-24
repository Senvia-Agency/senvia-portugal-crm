import { authorizeKeyInvoiceAdmin } from '../_shared/fiscal-authorization.ts'
import { userRateLimit } from '../_shared/user-rate-limit.ts'
import { VendusError, vendusRequest } from '../_shared/vendus.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function validId(value: unknown): number | null {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function title(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : fallback
}

// These IDs belong to the Vendus account. The customer only receives an API key.
// Look up choices with that key instead of asking for undocumented numbers.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const organizationId = typeof body.organization_id === 'string' ? body.organization_id : ''
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId)) {
      return json({ error: 'Organização inválida' }, 400)
    }

    const authorization = await authorizeKeyInvoiceAdmin(req, organizationId, corsHeaders)
    if (!authorization.ok) return authorization.response
    const limited = await userRateLimit(authorization.admin, authorization.userId, 'vendus-options', corsHeaders)
    if (limited) return limited

    const suppliedKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
    if (suppliedKey && (suppliedKey.length > 256 || !/^[A-Za-z0-9_-]+$/.test(suppliedKey))) {
      return json({ error: 'Formato da chave API Vendus inválido' }, 400)
    }
    const { data: org, error: orgError } = await authorization.admin.from('organizations')
      .select('vendus_api_key').eq('id', organizationId).maybeSingle()
    if (orgError || !org) return json({ error: 'Organização não encontrada' }, 404)
    const apiKey = suppliedKey || String(org.vendus_api_key || '').trim()
    if (!apiKey) return json({ error: 'Introduz a chave API Vendus.' }, 400)

    const [registerRows, paymentRows] = await Promise.all([
      vendusRequest<unknown>(apiKey, '/registers/?isActive=yes&per_page=1000'),
      vendusRequest<unknown>(apiKey, '/documents/paymentmethods/?per_page=1000'),
    ])
    if (!Array.isArray(registerRows) || !Array.isArray(paymentRows)
      || registerRows.length >= 1000 || paymentRows.length >= 1000) {
      return json({ error: 'Não foi possível obter a lista completa de caixas e métodos de pagamento da Vendus.' }, 502)
    }

    const registers = registerRows.flatMap((row) => {
      if (!row || typeof row !== 'object') return []
      const item = row as Record<string, unknown>
      const id = validId(item.id)
      if (!id || item.mode === 'tests' || item.status === 'close'
        || item.situation === 'off' || item.subscription_active === 'no') return []
      return [{ id, title: title(item.title, `Caixa ${id}`), type: String(item.type || ''),
        store_id: validId(item.store_id) }]
    }).sort((a, b) => (a.type === 'api' ? -1 : 0) - (b.type === 'api' ? -1 : 0))
    const payment_methods = paymentRows.flatMap((row) => {
      if (!row || typeof row !== 'object') return []
      const item = row as Record<string, unknown>
      const id = validId(item.id)
      if (!id || item.status === 'off') return []
      const store_ids = Array.isArray(item.stores)
        ? item.stores.map((store) => validId(typeof store === 'object' && store !== null
          ? ((store as Record<string, unknown>).id ?? (store as Record<string, unknown>).store_id)
          : store)).filter((store): store is number => store !== null)
        : []
      return [{ id, title: title(item.title, `Método ${id}`), type: String(item.type || ''), store_ids }]
    })
    return json({ registers, payment_methods })
  } catch (error) {
    const safe = error instanceof VendusError ? error : new VendusError('Não foi possível consultar a Vendus.', 502, 'provider_error')
    console.error('[vendus-options]', safe.code)
    return json({ error: safe.message, code: safe.code }, safe.status)
  }
})
