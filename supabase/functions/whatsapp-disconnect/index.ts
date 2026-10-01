// whatsapp-disconnect — ends or archives a caixa linked by QR code.
//
//   { channel_id, logout: true } → ends the WhatsApp session, keeps the
//                                   instance and the caixa: scanning a new QR
//                                   on the same caixa brings it back.
//   { channel_id }               → archives: logs out, deletes the Evolution
//                                   instance, marks the row archived.
//   { channel_id, delete: true } → the same teardown, then deletes the caixa
//                                   and its conversations for good
//                                   (delete_messaging_channel).
//
// The first version of this function DELETED the row, and with it (ON DELETE
// CASCADE) every conversation of the caixa. Archiving keeps the history
// readable in the inbox, which is what meta-connect already does for the Meta
// channels. The Chatwoot inbox is left alone for the same reason: it holds its
// own copy of those conversations.
import {
  corsHeaders, json, getConfig, authOrgAdmin, evolutionFetch,
} from '../_shared/multicanal.ts';
import { isNativeEvolution } from '../_shared/evolution-inbox.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  try {
    const cfg = getConfig();
    const { organization_id, channel_id, logout, delete: excluir } = await req.json().catch(() => ({}));
    const auth = await authOrgAdmin(req, cfg, organization_id);
    if ('error' in auth) return auth.error;
    const { admin } = auth;
    if (!channel_id) return json({ error: 'channel_id em falta' }, 400);

    const { data: row } = await admin
      .from('messaging_channels')
      .select('id, evolution_instance, provider, metadata, archived_at')
      .eq('id', channel_id)
      .eq('organization_id', organization_id)
      .maybeSingle();
    if (!row) return json({ error: 'Caixa não encontrada' }, 404);
    // Deleting also clears out caixas of the first Evolution integration;
    // logging out and archiving stay limited to the current one.
    if (!isNativeEvolution(row) && !(excluir === true && row.provider === 'evolution')) {
      return json({ error: 'Esta caixa não foi ligada por QR code.' }, 409);
    }
    const instance = row.evolution_instance as string | null;

    if (logout) {
      if (instance) {
        try { await evolutionFetch(cfg, `/instance/logout/${instance}`, 'DELETE'); } catch (_e) { /* ignore */ }
      }
      await admin.from('messaging_channels')
        .update({ status: 'disconnected' })
        .eq('id', row.id);
      return json({ ok: true, disconnected: true });
    }

    if (row.archived_at && excluir !== true) return json({ ok: true, archived: true });

    if (instance) {
      try {
        const res = await evolutionFetch(cfg, `/instance/logout/${instance}`, 'DELETE');
        if (!res.ok) console.warn(`logout ${instance}: ${res.status} ${await res.text()}`);
      } catch (e) { console.warn(`logout ${instance} error:`, e); }
      try {
        const res = await evolutionFetch(cfg, `/instance/delete/${instance}`, 'DELETE');
        if (!res.ok) console.error(`delete ${instance}: ${res.status} ${await res.text()}`);
      } catch (e) { console.error(`delete ${instance} error:`, e); }
    }

    if (excluir === true) {
      // The caixa and its conversations, for good. The admin was told how many
      // before confirming (see delete_messaging_channel).
      const { data: apagadas, error: delErr } = await admin.rpc('delete_messaging_channel', {
        p_channel_id: row.id, p_organization_id: organization_id,
      });
      if (delErr) {
        console.error('delete_messaging_channel failed:', delErr);
        return json({ error: 'Não foi possível excluir a caixa.' }, 500);
      }
      return json({ ok: true, deleted: true, conversations_deleted: apagadas ?? 0 });
    }

    const { error } = await admin.from('messaging_channels')
      .update({ archived_at: new Date().toISOString(), status: 'disconnected' })
      .eq('id', row.id);
    if (error) return json({ error: 'Não foi possível arquivar a caixa.' }, 500);

    return json({ ok: true, archived: true });
  } catch (err) {
    console.error('whatsapp-disconnect error:', err);
    return json({ error: (err as Error).message || 'Erro interno' }, 500);
  }
});
