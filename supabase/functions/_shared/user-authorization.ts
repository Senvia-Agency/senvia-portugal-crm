import { userRateLimit, LIMITED_USER_ACTIONS } from './user-rate-limit.ts';
interface MfaPolicyClient {
  rpc(name: 'meets_mfa_policy', args: { _user_id: string }): PromiseLike<{ data: unknown; error: unknown }>;
}

// The caller must first verify this user with auth.getUser(). Never pass a service-role client.
export async function meetsMfaPolicy(client: MfaPolicyClient, userId: string): Promise<boolean> {
  const { data, error } = await client.rpc('meets_mfa_policy', { _user_id: userId });
  return !error && data === true;
}

export async function requestMfaResponse(
  req: Request,
  userId: string,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.49.8');
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const authorization = req.headers.get('Authorization');
  if (!url || !anonKey || !authorization?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (await meetsMfaPolicy(userClient, userId)) {
    const action = new URL(req.url).pathname.split('/').filter(Boolean).pop() || '';
    if (LIMITED_USER_ACTIONS.has(action)) {
      const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', { auth: { persistSession: false } });
      return await userRateLimit(admin, userId, action, corsHeaders);
    }
    return null;
  }
  return new Response(JSON.stringify({ error: 'MFA_REQUIRED' }), {
    status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
