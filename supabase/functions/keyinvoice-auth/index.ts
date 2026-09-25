import { authorizeKeyInvoiceAdmin } from '../_shared/fiscal-authorization.ts'
import { getKeyInvoiceSession, safeKeyInvoiceError } from '../_shared/keyinvoice.ts'
import { userRateLimit } from '../_shared/user-rate-limit.ts'

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

/** Reuse or create the API session without exposing it to the browser. */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const organizationId = typeof body.organization_id === 'string' ? body.organization_id : ''
    if (!organizationId) return json({ error: 'organization_id é obrigatório' }, 400)

    const authorization = await authorizeKeyInvoiceAdmin(req, organizationId, corsHeaders)
    if (!authorization.ok) return authorization.response
    const rateLimitResponse = await userRateLimit(authorization.admin, authorization.userId, 'keyinvoice-auth', corsHeaders)
    if (rateLimitResponse) return rateLimitResponse

    const { data: org, error: orgError } = await authorization.admin
      .from('organizations')
      .select('keyinvoice_password, keyinvoice_api_url, keyinvoice_sid, keyinvoice_sid_expires_at')
      .eq('id', organizationId)
      .single()
    if (orgError || !org) return json({ error: 'Organização não encontrada' }, 404)

    await getKeyInvoiceSession(authorization.admin, org, organizationId)
    return json({ success: true, connected: true, expires_in: 3600 })
  } catch (error) {
    const safe = safeKeyInvoiceError(error)
    console.error('[keyinvoice-auth]', safe.code)
    return json({ error: safe.message, code: safe.code, retryable: safe.retryable }, safe.status)
  }
})
