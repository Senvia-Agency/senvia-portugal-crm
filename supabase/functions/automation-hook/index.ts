import { createClient } from 'npm:@supabase/supabase-js@2.57.2';
import { requestMfaResponse } from '../_shared/user-authorization.ts';
import { handleHook } from './handler.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
Deno.serve(async (request: Request) => {
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { persistSession: false },
  });
  return handleHook(request, {
    flow: async id => {
      const { data, error } = await db.from('automation_flows')
        .select('id,organization_id,status,trigger_type,trigger_config').eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },
    adminDenial: async (req, organizationId) => {
      const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      const { data, error } = await db.auth.getUser(bearer);
      if (error || !data.user) return new Response(JSON.stringify({ error: 'Não autorizado.' }), { status: 401, headers: corsHeaders });
      const mfa = await requestMfaResponse(req, data.user.id, corsHeaders);
      if (mfa) return mfa;
      const { data: member } = await db.rpc('is_org_member', { _user_id: data.user.id, _org_id: organizationId });
      const { data: admin } = await db.rpc('is_org_admin', { _user_id: data.user.id, _org_id: organizationId });
      return member === true && admin === true ? null : new Response(JSON.stringify({ error: 'Sem permissão.' }), { status: 403, headers: corsHeaders });
    },
    readHash: async flowId => {
      const { data, error } = await db.from('automation_hook_secrets').select('secret_hash').eq('flow_id', flowId).maybeSingle();
      if (error) throw error;
      return data?.secret_hash ?? null;
    },
    writeHash: async (flowId, organizationId, hash) => {
      const { error } = await db.from('automation_hook_secrets').upsert({ flow_id: flowId, organization_id: organizationId, secret_hash: hash, rotated_at: new Date().toISOString() });
      if (error) throw error;
    },
    enroll: async body => {
      const { data, error } = await db.functions.invoke('automation-engine', { body });
      if (error || data?.error) throw new Error('Engine rejected enrollment');
      return data;
    },
  });
});
