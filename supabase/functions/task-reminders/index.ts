// task-reminders — pg_cron invokes this every minute; sends a push reminder for
// due inbox tasks to the assigned user (or the creator when unassigned).
// Clicking the notification deep-links into the conversation (/inbox?phone=...).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { internalJobGuard } from '../_shared/internal-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  const denied = await internalJobGuard(req);
  if (denied) return denied;
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: due, error } = await admin
      .from('inbox_tasks')
      .select('id, organization_id, title, contact_name, contact_phone, assigned_to, created_by, source_channel_id')
      .is('done_at', null)
      .eq('reminder_sent', false)
      .eq('suggested', false) // AI suggestions only remind after being accepted
      .not('due_at', 'is', null)
      .lte('due_at', new Date().toISOString())
      .limit(50);
    if (error) throw error;

    let sent = 0;
    for (const t of due ?? []) {
      const target = t.assigned_to ?? t.created_by;
      if (!target) continue;
      if (t.source_channel_id) {
        const access = await admin.rpc('pode_aceder_caixa', { _user_id: target, _channel_id: t.source_channel_id });
        if (access.error) throw access.error;
        if (access.data !== true) continue;
      }
      // Claim first — a concurrent cron run must not double-notify.
      const { data: claimed } = await admin
        .from('inbox_tasks')
        .update({ reminder_sent: true })
        .eq('id', t.id)
        .eq('reminder_sent', false)
        .select('id')
        .maybeSingle();
      if (!claimed) continue;

      try {
        await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({
            organization_id: t.organization_id,
            user_ids: [target],
            title: `📋 ${t.title}`,
            body: t.contact_name ? `Tarefa: ${t.contact_name}` : 'Tens uma tarefa para agora',
            url: t.contact_phone ? `/inbox?phone=${encodeURIComponent(t.contact_phone)}` : '/inbox',
            tag: `task-${t.id}`,
          }),
        });
        sent++;
      } catch (e) {
        console.error('task push failed:', t.id, e);
      }
    }

    return json({ ok: true, due: due?.length ?? 0, sent });
  } catch (err) {
    console.error('task-reminders error:', err);
    return json({ error: (err as Error).message || 'Erro interno' }, 500);
  }
});
