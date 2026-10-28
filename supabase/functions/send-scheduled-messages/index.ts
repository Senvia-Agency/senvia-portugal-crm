import { automationContactSuppressed } from '../_shared/automation-contact-optout.ts';
// send-scheduled-messages — pg_cron invokes this every minute; it sends the due
// scheduled WhatsApp messages through each org's Evolution instance.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json, getConfig, evolutionFetch } from '../_shared/multicanal.ts';

function normalizePhone(raw: string): string {
  // Remove everything except digits and leading +
  let cleaned = raw.replace(/[^\d+]/g, '');
  // If it already has a leading +, keep as-is
  if (cleaned.startsWith('+')) return cleaned;
  // 9-digit Portuguese number: prepend +351
  if (/^\d{9}$/.test(cleaned)) return '+351' + cleaned;
  // 11-digit Brazilian number: prepend +55
  if (/^\d{11}$/.test(cleaned)) return '+55' + cleaned;
  // Otherwise just return digits
  return cleaned;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret) {
    const provided = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('key');
    if (provided !== cronSecret) return json({ error: 'Não autorizado' }, 401);
  }

  try {
    const cfg = getConfig();
    const admin = createClient(cfg.supabaseUrl, cfg.serviceKey);

    const { data: due, error } = await admin
      .from('scheduled_messages')
      .select('id, organization_id, phone, content')
      .eq('status', 'pending')
      .lte('send_at', new Date().toISOString())
      .order('send_at', { ascending: true })
      .limit(50);
    if (error) throw error;

    // Group messages by org so we only resolve each instance once
    const orgIds = [...new Set((due ?? []).map((m) => m.organization_id))];
    const instanceMap = new Map<string, string>();

    if (orgIds.length > 0) {
      const { data: channels } = await admin
        .from('messaging_channels')
        .select('organization_id, evolution_instance')
        .in('organization_id', orgIds)
        .eq('channel_type', 'whatsapp')
        .eq('status', 'connected')
        .not('evolution_instance', 'is', null);
      for (const ch of channels ?? []) {
        instanceMap.set(ch.organization_id, ch.evolution_instance);
      }
    }

    let sent = 0;
    let failed = 0;
    for (const msg of due ?? []) {
      const { data: claimed } = await admin
        .from('scheduled_messages')
        .update({ status: 'processing' })
        .eq('id', msg.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();
      if (!claimed) continue;

      const instance = instanceMap.get(msg.organization_id);
      if (!instance) {
        await admin
          .from('scheduled_messages')
          .update({ status: 'failed', error: 'No WhatsApp channel connected for this org' })
          .eq('id', msg.id);
        failed++;
        continue;
      }

      if (await automationContactSuppressed(admin, msg.organization_id, msg.phone)) {
        const { error: cancelError } = await admin.from('scheduled_messages').update({ status: 'cancelled', error: 'Contacto pediu para parar mensagens automáticas' }).eq('id', msg.id);
        if (cancelError) throw cancelError;
        continue;
      }
      const number = normalizePhone(String(msg.phone));
      try {
        const res = await evolutionFetch(cfg, `/message/sendText/${instance}`, 'POST', {
          number,
          text: msg.content,
        });
        if (res.ok) {
          await admin
            .from('scheduled_messages')
            .update({ status: 'sent', sent_at: new Date().toISOString() })
            .eq('id', msg.id);
          sent++;
        } else {
          const errText = `${res.status} ${(await res.text()).slice(0, 280)}`;
          await admin.from('scheduled_messages').update({ status: 'failed', error: errText }).eq('id', msg.id);
          failed++;
        }
      } catch (e) {
        await admin
          .from('scheduled_messages')
          .update({ status: 'failed', error: String((e as Error).message).slice(0, 300) })
          .eq('id', msg.id);
        failed++;
      }
    }

    return json({ ok: true, due: due?.length ?? 0, sent, failed });
  } catch (err) {
    console.error('send-scheduled-messages error:', err);
    return json({ error: (err as Error).message }, 500);
  }
});

