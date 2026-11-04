// time-clock-reminders — pg_cron invokes this every 5 minutes. The database decides
// which reminders are due (time_clock_due_reminders, which also marks them sent);
// this only turns each one into a push to that person.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { internalJobGuard } from '../_shared/internal-auth.ts';

const MESSAGES: Record<string, { title: string; body: string }> = {
  entrada: { title: 'Já registou a entrada?', body: 'Ainda não iniciou o dia no ponto.' },
  almoco: { title: 'Hora de almoço', body: 'Não se esqueça de registar a pausa.' },
  regresso: { title: 'Regresso do almoço', body: 'Registe o regresso ao trabalho.' },
  saida: { title: 'Fim do dia', body: 'Não se esqueça de terminar o dia no ponto.' },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  const denied = await internalJobGuard(req);
  if (denied) return denied;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: due, error } = await admin.rpc('time_clock_due_reminders');
    if (error) throw error;

    // One push per organization and slot, to everyone it concerns.
    const groups = new Map<string, { organization_id: string; slot: string; user_ids: string[] }>();
    for (const r of (due ?? []) as Array<{ organization_id: string; user_id: string; slot: string }>) {
      const key = `${r.organization_id}:${r.slot}`;
      const group = groups.get(key) ?? { organization_id: r.organization_id, slot: r.slot, user_ids: [] };
      group.user_ids.push(r.user_id);
      groups.set(key, group);
    }

    let sent = 0;
    for (const g of groups.values()) {
      const message = MESSAGES[g.slot];
      if (!message) continue;
      try {
        await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({
            organization_id: g.organization_id,
            user_ids: g.user_ids,
            title: message.title,
            body: message.body,
            url: '/ponto',
            tag: `ponto-${g.slot}`,
          }),
        });
        sent += g.user_ids.length;
      } catch (e) {
        console.error('time-clock push failed:', g.organization_id, g.slot, e);
      }
    }

    return json({ ok: true, due: due?.length ?? 0, sent });
  } catch (err) {
    console.error('time-clock-reminders error:', err);
    return json({ error: (err as Error).message || 'Erro interno' }, 500);
  }
});
