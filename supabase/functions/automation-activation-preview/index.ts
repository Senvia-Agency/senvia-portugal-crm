import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.57.2';
import { requestMfaResponse } from '../_shared/user-authorization.ts';
import { handleActivationPreview, previewHeaders } from './handler.ts';

const tables: Readonly<Record<string, string>> = { lead: 'leads', client: 'crm_clients', sale: 'sales', proposal: 'proposals' };
function denied(status: number): Response {
  return new Response(JSON.stringify({ error: 'Sem permissão para consultar esta automação.' }), { status, headers: previewHeaders });
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
serve(async request => {
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
  return await handleActivationPreview(request, {
    now: () => new Date(),
    authorize: async (req, flowId) => {
      const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      if (!bearer) return denied(401);
      const { data: userData, error: userError } = await db.auth.getUser(bearer);
      if (userError || !userData.user) return denied(401);
      const mfa = await requestMfaResponse(req, userData.user.id, previewHeaders);
      if (mfa) return mfa;
      const { data: flow, error } = await db.from('automation_flows').select('organization_id,trigger_type,trigger_config').eq('id', flowId).maybeSingle();
      if (error || !flow) return denied(403);
      const { data: member, error: memberError } = await db.rpc('is_org_member', { _user_id: userData.user.id, _org_id: flow.organization_id });
      const { data: admin, error: adminError } = await db.rpc('is_org_admin', { _user_id: userData.user.id, _org_id: flow.organization_id });
      if (memberError || adminError || member !== true || admin !== true) return denied(403);
      return { ...flow, trigger_config: record(flow.trigger_config) ? flow.trigger_config : {} };
    },
    records: async (flow, offset, limit) => {
      const config = flow.trigger_config ?? {};
      const table = tables[String(config.entity ?? 'lead')];
      if (!table) throw new Error('Entidade inválida.');
      const field = flow.trigger_type === 'record_date' ? config.date_field : null;
      if (field !== null && (typeof field !== 'string' || !/^[a-z][a-z0-9_]*$/.test(field))) throw new Error('Campo inválido.');
      const { data, error } = await db.from(table).select(field ? `id,${field}` : 'id')
        .eq('organization_id', flow.organization_id).order('id').range(offset, offset + limit - 1);
      if (error) throw error;
      const rows: readonly unknown[] = data ?? [];
      return rows.filter(record);
    },
  });
});
