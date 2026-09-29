import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requestMfaResponse } from './user-authorization.ts'

export type FiscalAction = 'view' | 'issue' | 'cancel'

export type FiscalAuthorization =
  | { ok: true; userId: string; admin: any }
  | { ok: false; response: Response }

function json(headers: Record<string, string>, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

/**
 * Authorize an interactive fiscal action.
 *
 * Service-role bearer tokens are explicitly rejected here. Internal workers
 * must import the KeyInvoice service helpers instead of calling public edge
 * endpoints and bypassing user permissions/rate limits.
 */
export async function authorizeFiscalUser(
  req: Request,
  organizationId: string,
  action: FiscalAction,
  corsHeaders: Record<string, string>,
): Promise<FiscalAuthorization> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = req.headers.get('Authorization') || ''
  const bearer = authorization.replace(/^Bearer\s+/i, '')
  if (!supabaseUrl || !anonKey || !serviceKey || !bearer || bearer === serviceKey) {
    return { ok: false, response: json(corsHeaders, 401, { error: 'Não autorizado' }) }
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) {
    return { ok: false, response: json(corsHeaders, 401, { error: 'Não autorizado' }) }
  }
  const mfaResponse = await requestMfaResponse(req, user.id, corsHeaders)
  if (mfaResponse) return { ok: false, response: mfaResponse }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: allowed, error: permissionError } = await admin.rpc('has_module_permission', {
    _user_id: user.id,
    _org_id: organizationId,
    _module: 'finance',
    _subarea: 'invoices',
    _action: action,
  })
  if (permissionError || allowed !== true) {
    return { ok: false, response: json(corsHeaders, 403, { error: 'Sem permissão para esta operação fiscal' }) }
  }
  return { ok: true, userId: user.id, admin }
}
export async function authorizeKeyInvoiceAdmin(
  req: Request,
  organizationId: string,
  corsHeaders: Record<string, string>,
): Promise<FiscalAuthorization> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = req.headers.get('Authorization') || ''
  const bearer = authorization.replace(/^Bearer\s+/i, '')
  if (!supabaseUrl || !anonKey || !serviceKey || !bearer || bearer === serviceKey) {
    return { ok: false, response: json(corsHeaders, 401, { error: 'Não autorizado' }) }
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return { ok: false, response: json(corsHeaders, 401, { error: 'Não autorizado' }) }
  const mfaResponse = await requestMfaResponse(req, user.id, corsHeaders)
  if (mfaResponse) return { ok: false, response: mfaResponse }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: allowed, error } = await admin.rpc('is_org_admin', {
    _user_id: user.id,
    _org_id: organizationId,
  })
  if (error || allowed !== true) {
    return { ok: false, response: json(corsHeaders, 403, { error: 'Apenas administradores podem validar a integração' }) }
  }
  return { ok: true, userId: user.id, admin }
}
