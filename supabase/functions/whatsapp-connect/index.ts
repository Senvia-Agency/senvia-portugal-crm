// whatsapp-connect — links a WhatsApp number by QR code: creates (or reuses) an
// Evolution instance for the caixa and returns the QR (base64 PNG) to scan.
// Idempotent: safe to call repeatedly while the QR modal is open.
//
// Restored from the first integration (removed 2026-08-11, f9b645fa) with one
// change of destination: messages now go to `evolution-webhook` and from there
// to the CRM's own inbox, instead of to a Chatwoot the CRM had to mirror. The
// Chatwoot mirror is still wired, by whatsapp-status, once the session opens —
// doing it here flooded Chatwoot with "Connection successfully established!"
// during the scan.
//
// Pass `channel_id` to reconnect a caixa, or omit it (optionally with `label`)
// to create a new one with its own instance, so several numbers never collide.
import {
  corsHeaders, json, getConfig, authOrgAdmin, evolutionFetch,
  ensureChatwootAccount, instanceNameForChannel,
} from '../_shared/multicanal.ts';
import {
  EVOLUTION_WEBHOOK_EVENTS, configureInstanceWebhook, isNativeEvolution, webhookUrlFor,
} from '../_shared/evolution-inbox.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  try {
    const cfg = getConfig();
    if (!cfg.evolutionUrl || !cfg.evolutionKey) {
      return json({ error: 'Integração de WhatsApp não configurada (secrets em falta)' }, 500);
    }

    const { organization_id, channel_id, label } = await req.json().catch(() => ({}));
    const auth = await authOrgAdmin(req, cfg, organization_id);
    if ('error' in auth) return auth.error;
    const { admin } = auth;

    const { data: org, error: orgErr } = await admin
      .from('organizations')
      .select('id, name, chatwoot_account_id, chatwoot_account_token')
      .eq('id', organization_id)
      .single();
    if (orgErr || !org) return json({ error: 'Organização não encontrada' }, 404);

    type ChannelRow = {
      id: string; evolution_instance: string | null; chatwoot_inbox_id: number | null;
      provider: string; metadata: Record<string, unknown> | null; archived_at: string | null;
    };
    const fields = 'id, evolution_instance, chatwoot_inbox_id, provider, metadata, archived_at';
    let channelRow: ChannelRow;

    if (channel_id) {
      const { data } = await admin
        .from('messaging_channels')
        .select(fields)
        .eq('id', channel_id)
        .eq('organization_id', org.id)
        .maybeSingle();
      if (!data) return json({ error: 'Caixa não encontrada' }, 404);
      // Rows of the first integration are not adopted behind the user's back:
      // their instances may still hold a session nobody is watching.
      if (!isNativeEvolution(data)) {
        return json({ error: 'Esta caixa não pode ser ligada por QR code. Cria uma caixa nova de WhatsApp.' }, 409);
      }
      if (data.archived_at) {
        return json({ error: 'Esta caixa está arquivada. Cria uma caixa nova para voltar a ligar o número.' }, 409);
      }
      channelRow = data as ChannelRow;
    } else {
      const { data, error: insErr } = await admin
        .from('messaging_channels')
        .insert({
          organization_id: org.id,
          channel_type: 'whatsapp',
          provider: 'evolution',
          status: 'connecting',
          label: String(label ?? '').trim() || 'WhatsApp',
          // native_inbox: messages go to the CRM's inbox (see evolution-inbox.ts).
          // groups_enabled false: the inbox is one-to-one, group chats are dropped.
          metadata: { native_inbox: true, groups_enabled: false },
        })
        .select(fields)
        .single();
      if (insErr || !data) {
        if (/INBOX_LIMIT_REACHED/.test(insErr?.message ?? '')) {
          return json({ error: insErr!.message.replace(/^.*INBOX_LIMIT_REACHED:\s*/, '') }, 409);
        }
        console.error('channel insert failed:', insErr);
        return json({ error: 'Falha ao criar a caixa' }, 500);
      }
      channelRow = data as ChannelRow;
    }

    const instanceName = channelRow.evolution_instance || instanceNameForChannel(org.id, channelRow.id);

    // Stored at once, so status polls resolve the right instance before the
    // slow Evolution provisioning below completes.
    if (!channelRow.evolution_instance) {
      await admin.from('messaging_channels')
        .update({ evolution_instance: instanceName })
        .eq('id', channelRow.id);
    }

    let evolutionState: string | undefined;
    let evolutionQr: string | null = null;
    const stateRes = await evolutionFetch(cfg, `/instance/connectionState/${instanceName}`);
    if (stateRes.ok) {
      const stateData = await stateRes.json();
      evolutionState = stateData?.instance?.state;
      evolutionQr = stateData?.instance?.qrcode?.base64 ?? null;
    }

    // Already open: calling /instance/connect/ would drop the live session.
    if (evolutionState === 'open') {
      await configureInstanceWebhook(cfg, instanceName);
      await admin.from('messaging_channels')
        .update({ status: 'connected', needs_repair: false })
        .eq('id', channelRow.id);
      return json({ success: true, channel_id: channelRow.id, instance: instanceName, already_connected: true, qr: null, pairing_code: null });
    }

    // A scan is in flight: regenerating the QR now cancels the handshake and
    // leaves the phone on "A ligar..." forever. Hand back the current QR.
    if (evolutionState === 'connecting' && evolutionQr) {
      return json({
        success: true, channel_id: channelRow.id, instance: instanceName,
        qr: evolutionQr, pairing_code: null, already_connected: false,
      });
    }

    const createPayload = async () => ({
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      groupsIgnore: true,
      rejectCall: false,
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
      webhook: {
        url: await webhookUrlFor(cfg, instanceName),
        byEvents: false,
        base64: false,
        events: EVOLUTION_WEBHOOK_EVENTS,
      },
    });

    const fetchRes = await evolutionFetch(cfg, `/instance/fetchInstances?instanceName=${instanceName}`);
    const existing = fetchRes.ok ? await fetchRes.json() : [];
    let instanceExists = Array.isArray(existing) && existing.length > 0;

    // Create only when it genuinely doesn't exist. Deleting a 'connecting'
    // instance does not free the name in time, and the immediate create then
    // fails with 403 "name already in use"; /instance/connect/ below
    // regenerates the QR of a closed or stale instance instead.
    if (!instanceExists) {
      if (cfg.chatwootUrl && cfg.chatwootPlatformToken) {
        // Needed only for the mirror; a Chatwoot hiccup must not block the QR.
        await ensureChatwootAccount(admin, cfg, org).catch((e) => console.error('Chatwoot account:', e));
      }
      const createRes = await evolutionFetch(cfg, '/instance/create', 'POST', await createPayload());
      if (!createRes.ok) {
        console.error('Evolution create failed:', createRes.status, await createRes.text());
        return json({ error: 'Falha ao criar a ligação no servidor de WhatsApp' }, 502);
      }
    }
    await configureInstanceWebhook(cfg, instanceName);

    await admin.from('messaging_channels')
      .update({
        evolution_instance: instanceName,
        status: 'connecting',
        needs_repair: false,
        flap_count: 0,
        flap_window_start: null,
      })
      .eq('id', channelRow.id);

    let connectRes = await evolutionFetch(cfg, `/instance/connect/${instanceName}`);
    if (!connectRes.ok) {
      console.error('Evolution connect failed:', connectRes.status, await connectRes.text());
      return json({ error: 'Falha ao obter o QR code' }, 502);
    }
    let connect = await connectRes.json();

    // An instance with a corrupted session can return neither QR nor pairing
    // code. Tear it down (logout → delete), wait for the name to free up,
    // recreate and connect again. The only path that deletes.
    if (instanceExists && !connect.base64 && !connect.pairingCode) {
      try { await evolutionFetch(cfg, `/instance/logout/${instanceName}`, 'DELETE'); } catch (_e) { /* ignore */ }
      try { await evolutionFetch(cfg, `/instance/delete/${instanceName}`, 'DELETE'); } catch (_e) { /* ignore */ }
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const chk = await evolutionFetch(cfg, `/instance/fetchInstances?instanceName=${instanceName}`);
        const arr = chk.ok ? await chk.json() : [];
        if (!Array.isArray(arr) || arr.length === 0) { instanceExists = false; break; }
      }
      const createRes = await evolutionFetch(cfg, '/instance/create', 'POST', await createPayload());
      if (!createRes.ok) {
        console.error('Evolution recreate failed:', createRes.status, await createRes.text());
        return json({ error: 'Falha ao recriar a ligação no servidor de WhatsApp' }, 502);
      }
      await configureInstanceWebhook(cfg, instanceName);
      // A fresh instance has no Chatwoot wiring; whatsapp-status redoes it.
      await admin.from('messaging_channels').update({ chatwoot_inbox_id: null }).eq('id', channelRow.id);
      connectRes = await evolutionFetch(cfg, `/instance/connect/${instanceName}`);
      if (!connectRes.ok) {
        console.error('Evolution connect (after recreate) failed:', connectRes.status, await connectRes.text());
        return json({ error: 'Falha ao obter o QR code' }, 502);
      }
      connect = await connectRes.json();
    }

    return json({
      success: true,
      channel_id: channelRow.id,
      instance: instanceName,
      qr: connect.base64 ?? null,
      pairing_code: connect.pairingCode ?? null,
      already_connected: !connect.base64 && !connect.pairingCode,
    });
  } catch (err) {
    console.error('whatsapp-connect error:', err);
    return json({ error: (err as Error).message || 'Erro interno' }, 500);
  }
});
