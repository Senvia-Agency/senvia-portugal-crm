import { settleFailureSummary } from "./adapter.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.57.2';
import { handleFailureSummary, type FailureSummary } from './handler.ts';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey, { auth: { persistSession: false } });
Deno.serve(async (request: Request) => {
  try {
    return await handleFailureSummary(request, {
      now: () => new Date(),
      authorize: async req => {
        const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
        if (serviceKey && bearer === serviceKey) return true;
        const secret = req.headers.get('x-automation-secret');
        if (!secret) return false;
        const { data, error } = await db.rpc('verify_automation_secret', { p_secret: secret });
        return !error && data === true;
      },
      claim: async () => {
        const { data, error } = await db.rpc('claim_automation_failure_summaries');
        if (error) throw error;
        return (data ?? []).map((row: FailureSummary) => row);
      },
      notify: async summary => {
        const { data: member, error: memberError } = await db.from('organization_members').select('user_id')
          .eq('organization_id', summary.organization_id).eq('user_id', summary.owner_id).eq('is_active', true).maybeSingle();
        if (memberError || !member) return false;
        const { data, error } = await db.functions.invoke('send-push-notification', { body: {
          organization_id: summary.organization_id, user_ids: [summary.owner_id],
          title: 'Resumo diário das automações', body: `${summary.failed} percurso(s) falharam ontem. Consulte as execuções para corrigir e repetir.`,
          url: '/automacoes', tag: `automation-summary-${summary.organization_id}-${summary.owner_id}-${summary.summary_date}`,
        } });
        return !error && data?.success === true;
      },
      settle: (summary, success) => settleFailureSummary(db, summary, success, new Date()),
    });
  } catch (error) {
    console.error('[AUTOMATION-FAILURE-SUMMARY]', error instanceof Error ? error.name : 'unknown');
    return new Response(JSON.stringify({ error: 'Não foi possível concluir o resumo.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
