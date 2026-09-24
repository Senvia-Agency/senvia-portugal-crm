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

// The integration only needs an API key. Keep the old response shape while
// previously loaded frontend bundles are still open in browser tabs.
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

    await vendusRequest<unknown>(apiKey, '/account/')
    return json({ valid: true, registers: [], payment_methods: [] })
  } catch (error) {
    const safe = error instanceof VendusError ? error : new VendusError('Não foi possível consultar a Vendus.', 502, 'provider_error')
    console.error('[vendus-options]', safe.code)
    return json({ error: safe.message, code: safe.code }, safe.status)
  }
})
