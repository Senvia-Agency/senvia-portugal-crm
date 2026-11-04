// lead-reassign — pg_cron invokes this every 5 minutes. The database moves the
// overdue leads (reassign_stale_leads, which also logs them); this tells people:
// a push to the new salesperson and to the previous one, and the new-lead email
// to the new salesperson when the organization keeps email on.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { internalJobGuard } from '../_shared/internal-auth.ts';

type Moved = { organization_id: string; lead_id: string; from_user: string | null; to_user: string; reason: string; notify_email: boolean };

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function emailHtml(lead: { name: string; phone: string | null; email: string | null; source: string | null }, previous: string | null) {
  const row = (label: string, value: string | null) => value
    ? `<tr><td style="padding:10px 16px 0;color:#94a3b8;font-size:13px;font-weight:600">${label}</td><td style="padding:10px 16px 0;color:#f1f5f9;font-size:14px;text-align:right">${esc(value)}</td></tr>` : '';
  return `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:'Segoe UI',Roboto,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;padding:40px 16px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#1e293b;border-radius:16px;overflow:hidden">
  <tr><td style="padding:32px 32px 16px;text-align:center">
    <img src="https://app.senvia.pt/senvia-logo-white.png" alt="Senvia OS" width="140" style="display:inline-block;margin-bottom:24px" />
    <h1 style="color:#ffffff;font-size:22px;margin:0">🔄 Lead passada para si</h1>
    <p style="color:#94a3b8;font-size:14px;margin:8px 0 0">${previous ? `Estava com ${esc(previous)} e não teve andamento a tempo.` : 'Não teve andamento a tempo.'} Contacte-a quanto antes.</p>
  </td></tr>
  <tr><td style="padding:0 32px 24px">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;border-radius:12px;border:1px solid #334155;padding-bottom:10px">
      ${row('Nome', lead.name && lead.name !== 'Anónimo' ? lead.name : null)}
      ${row('Telefone', lead.phone && lead.phone !== '000000000' ? lead.phone : null)}
      ${row('Email', lead.email && lead.email !== 'nao-fornecido@placeholder.local' ? lead.email : null)}
      ${row('Fonte', lead.source)}
    </table>
  </td></tr>
  <tr><td style="padding:0 32px 32px;text-align:center">
    <a href="https://app.senvia.pt/leads" style="display:inline-block;background:#10b981;color:#ffffff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">Ver Lead no Senvia</a>
  </td></tr>
  <tr><td style="padding:16px 32px;border-top:1px solid #334155;text-align:center"><p style="color:#64748b;font-size:12px;margin:0">Senvia OS · <a href="https://senvia.pt" style="color:#64748b">senvia.pt</a></p></td></tr>
</table></td></tr></table></body></html>`;
}

Deno.serve(async (req) => {
  const denied = await internalJobGuard(req);
  if (denied) return denied;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data, error } = await admin.rpc('reassign_stale_leads');
    if (error) throw error;
    const moved = (data ?? []) as Moved[];
    if (moved.length === 0) return json({ ok: true, moved: 0 });

    const leadIds = [...new Set(moved.map(m => m.lead_id))];
    const userIds = [...new Set(moved.flatMap(m => [m.to_user, m.from_user]).filter(Boolean) as string[])];
    const orgIds = [...new Set(moved.map(m => m.organization_id))];
    const [{ data: leads }, { data: people }, { data: orgs }] = await Promise.all([
      admin.from('leads').select('id, name, phone, email, source').in('id', leadIds),
      admin.from('profiles').select('id, full_name, email').in('id', userIds),
      admin.from('organizations').select('id, name, brevo_api_key, brevo_sender_email').in('id', orgIds),
    ]);
    const leadOf = new Map((leads ?? []).map(l => [l.id, l]));
    const personOf = new Map((people ?? []).map(p => [p.id, p]));
    const orgOf = new Map((orgs ?? []).map(o => [o.id, o]));

    const push = (organization_id: string, user_ids: string[], title: string, body: string, tag: string) =>
      fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ organization_id, user_ids, title, body, url: '/leads', tag }),
      }).catch(e => console.error('push failed', e));

    let emails = 0;
    for (const m of moved) {
      const lead = leadOf.get(m.lead_id);
      if (!lead) continue;
      const name = lead.name && lead.name !== 'Anónimo' ? lead.name : 'Lead sem nome';
      const toName = personOf.get(m.to_user)?.full_name ?? 'outro comercial';
      const fromName = m.from_user ? personOf.get(m.from_user)?.full_name ?? null : null;

      await push(m.organization_id, [m.to_user], '🔄 Lead passada para si', `${name} — sem andamento a tempo. Contacte quanto antes.`, `reassign-${m.lead_id}`);
      if (m.from_user) {
        await push(m.organization_id, [m.from_user], 'Lead passada a outro comercial', `${name} passou para ${toName} por falta de andamento.`, `reassign-${m.lead_id}`);
      }

      const to = personOf.get(m.to_user);
      const org = orgOf.get(m.organization_id);
      const brevoKey = Deno.env.get('BREVO_TRANSACTIONAL_API_KEY') || org?.brevo_api_key || Deno.env.get('BREVO_API_KEY');
      if (m.notify_email && to?.email && brevoKey) {
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': brevoKey, 'Content-Type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            sender: { email: org?.brevo_sender_email || 'geral@senvia.pt', name: org?.brevo_sender_email ? org.name : 'Senvia' },
            to: [{ email: to.email, name: to.full_name || to.email }],
            subject: `🔄 Lead passada para si: ${name}`,
            htmlContent: emailHtml(lead, fromName),
          }),
        }).catch(e => { console.error('email failed', e); return null; });
        if (res?.ok) emails++;
        else if (res) console.error('email rejected', res.status, await res.text().catch(() => ''));
      }
    }

    return json({ ok: true, moved: moved.length, emails });
  } catch (err) {
    console.error('lead-reassign error:', (err as Error).message);
    return json({ error: (err as Error).message || 'Erro interno' }, 500);
  }
});
