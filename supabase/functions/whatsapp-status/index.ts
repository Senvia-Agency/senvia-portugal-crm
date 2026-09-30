// whatsapp-status — reports a caixa's WhatsApp connection state and keeps its
// messaging_channels row in sync. Polled by the QR modal every few seconds.
//
// The first time the session is open it also re-applies the inbox webhook and
// wires the Chatwoot mirror (Evolution's own Chatwoot integration), so the
// conversations appear in chat.senvia.pt as well. Wiring only once the session
// is open keeps Evolution quiet during the scan and reconnect loops.
//
// Restored from the first integration (f9b645fa^); it now only serves caixas
// created by the current one (`metadata.native_inbox`).
import {
  corsHeaders, json, getConfig, authOrgAdmin, evolutionFetch, chatwootFetch,
  ensureChatwootAccount, findChatwootInboxByName, type MulticanalConfig,
} from '../_shared/multicanal.ts';
import { configureInstanceWebhook, isNativeEvolution } from '../_shared/evolution-inbox.ts';

function mapState(state: string | undefined): 'connected' | 'connecting' | 'disconnected' {
  if (state === 'open') return 'connected';
  if (state === 'connecting') return 'connecting';
  return 'disconnected';
}

interface ChannelRow {
  id: string;
  label: string | null;
  status: string | null;
  evolution_instance: string | null;
  chatwoot_inbox_id: number | null;
  needs_repair: boolean | null;
  provider: string;
  metadata: Record<string, unknown> | null;
}

// Best effort: the inbox works without Chatwoot, so a failure here is logged,
// never returned.
async function wireChatwootMirror(
  // deno-lint-ignore no-explicit-any
  admin: any,
  cfg: MulticanalConfig,
  organizationId: string,
  ch: ChannelRow,
  instanceName: string,
): Promise<void> {
  if (!cfg.chatwootUrl) return;
  try {
    const { data: org } = await admin
      .from('organizations')
      .select('id, name, chatwoot_account_id, chatwoot_account_token')
      .eq('id', organizationId)
      .single();
    if (!org) return;
    const { accountId, token } = await ensureChatwootAccount(admin, cfg, org);

    let inboxName: string;
    let autoCreate: boolean;
    if (ch.chatwoot_inbox_id) {
      // Re-wiring: use the inbox's real name in case it was renamed there.
      const inboxRes = await chatwootFetch(cfg, token, `/api/v1/accounts/${accountId}/inboxes/${ch.chatwoot_inbox_id}`);
      const inboxData = inboxRes.ok ? await inboxRes.json() : null;
      inboxName = inboxData?.name ?? inboxData?.payload?.name ?? '';
      autoCreate = false;
    } else {
      inboxName = `${(ch.label || '').trim() || 'WhatsApp'} ${ch.id.slice(0, 6)}`;
      autoCreate = true;
    }
    if (!inboxName) return;

    const res = await evolutionFetch(cfg, `/chatwoot/set/${instanceName}`, 'POST', {
      enabled: true,
      accountId: String(accountId),
      token,
      url: cfg.chatwootUrl,
      signMsg: true,
      signDelimiter: '\n',
      nameInbox: inboxName,
      reopenConversation: true,
      conversationPending: false,
      mergeBrazilContacts: false,
      importContacts: false,
      importMessages: false,
      daysLimitImportMessages: 7,
      autoCreate,
      ignoreGroups: true,
      organization: org.name,
      logo: '',
    });
    if (!res.ok) {
      console.error('chatwoot/set failed:', res.status, await res.text());
      return;
    }

    const inboxId = ch.chatwoot_inbox_id ?? await findChatwootInboxByName(cfg, accountId, token, inboxName);
    await admin.from('messaging_channels')
      .update({ ...(inboxId ? { chatwoot_inbox_id: inboxId } : {}), needs_repair: false })
      .eq('id', ch.id);
  } catch (e) {
    console.error('Chatwoot wiring error:', e);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  try {
    const cfg = getConfig();
    const { organization_id, channel_id } = await req.json().catch(() => ({}));
    const auth = await authOrgAdmin(req, cfg, organization_id);
    if ('error' in auth) return auth.error;
    const { admin } = auth;
    if (!channel_id) return json({ error: 'channel_id em falta' }, 400);

    const { data: ch } = await admin
      .from('messaging_channels')
      .select('id, label, status, evolution_instance, chatwoot_inbox_id, needs_repair, provider, metadata')
      .eq('id', channel_id)
      .eq('organization_id', organization_id)
      .maybeSingle();
    if (!ch || !isNativeEvolution(ch)) return json({ status: 'disconnected', phone_number: null, qr: null });
    const row = ch as ChannelRow;
    // Row exists but the instance is still being provisioned.
    if (!row.evolution_instance) return json({ status: 'connecting', phone_number: null, qr: null });
    const instanceName = row.evolution_instance;

    const stateRes = await evolutionFetch(cfg, `/instance/connectionState/${instanceName}`);
    if (!stateRes.ok) return json({ status: 'disconnected', phone_number: null, qr: null });
    const stateData = await stateRes.json();
    const status = mapState(stateData?.instance?.state);

    // Some Evolution builds include the live QR here. Reading it costs nothing
    // and lets the modal follow Baileys' QR rotation without calling
    // /instance/connect/ again, which would reset a scan in progress.
    const qr: string | null = status === 'connecting'
      ? (stateData?.instance?.qrcode?.base64 ?? null)
      : null;

    let phoneNumber: string | null = null;
    if (status === 'connected') {
      const fetchRes = await evolutionFetch(cfg, `/instance/fetchInstances?instanceName=${instanceName}`);
      if (fetchRes.ok) {
        const list = await fetchRes.json();
        const ownerJid: string | undefined = Array.isArray(list) ? list[0]?.ownerJid : undefined;
        if (ownerJid) phoneNumber = ownerJid.split('@')[0].split(':')[0] || null;
      }

      // Just connected (or flagged for repair): make sure the events come to
      // the inbox, then mirror to Chatwoot.
      if (row.status !== 'connected' || row.needs_repair || !row.chatwoot_inbox_id) {
        await configureInstanceWebhook(cfg, instanceName);
        await wireChatwootMirror(admin, cfg, organization_id, row, instanceName);
      }
    }

    await admin.from('messaging_channels')
      .update({ status, ...(phoneNumber ? { phone_number: phoneNumber } : {}) })
      .eq('id', row.id);

    return json({ status, phone_number: phoneNumber, qr });
  } catch (err) {
    console.error('whatsapp-status error:', err);
    return json({ error: (err as Error).message || 'Erro interno' }, 500);
  }
});
