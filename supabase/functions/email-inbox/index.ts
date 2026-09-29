// email-inbox — criar, alterar e apagar caixas de email. Ações: create | update | delete
//
// SEM CHATWOOT. A caixa é nossa de ponta a ponta: esta função guarda a
// configuração, e o `email-gateway` (Node + ImapFlow, ao lado do Chatwoot mas
// sem lhe tocar) liga por IMAP/SMTP direto ao servidor de correio e escreve em
// email_folders / email_messages. O Chatwoot chegou a criar uma caixa espelho
// aqui — não servia para nada: o cliente de email do CRM nunca leu de lá.
//
// As passwords vivem em `messaging_channel_secrets` (RLS ligado, zero
// políticas), NÃO no metadata — que o CRM lê a partir do browser. Até
// 2026-08-13 estavam lá, e chegavam lá.
import {
  corsHeaders, json, getConfig, authOrgAdmin,
} from '../_shared/multicanal.ts';

interface EmailConfig {
  email_address: string;
  imap_server: string;
  imap_port: number;
  imap_ssl: boolean;
  imap_login: string;
  imap_password?: string; // opcional na alteração — em branco mantém a atual
  smtp_server: string;
  smtp_port: number;
  smtp_ssl: boolean;
  smtp_login: string;
  smtp_password?: string; // opcional na alteração — em branco mantém a atual
  provider_key?: string;  // 'gmail' | 'outlook' | 'zoho' | 'custom' (só para a UI)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  try {
    const cfg = getConfig();
    const body = await req.json().catch(() => ({}));
    const { action, organization_id } = body;

    if (!organization_id) return json({ error: 'organization_id em falta' }, 400);

    const auth = await authOrgAdmin(req, cfg, organization_id);
    if ('error' in auth) return auth.error;
    const { admin } = auth;

    const { data: orgData, error: orgErr } = await admin
      .from('organizations')
      .select('id, name')
      .eq('id', organization_id)
      .single();
    if (!orgData || orgErr) return json({ error: 'Organização não encontrada' }, 404);

    // ── CREATE ────────────────────────────────────────────────────────────────
    if (action === 'create') {
      const { label, email_config } = body as { label: string; email_config: EmailConfig };

      if (!label?.trim()) return json({ error: 'Nome da caixa obrigatório' }, 400);
      if (!email_config?.email_address?.includes('@')) return json({ error: 'Endereço de email inválido' }, 400);
      if (!email_config?.imap_server?.trim()) return json({ error: 'Servidor IMAP obrigatório' }, 400);
      if (!email_config?.smtp_server?.trim()) return json({ error: 'Servidor SMTP obrigatório' }, 400);
      if (!email_config?.imap_password) return json({ error: 'Password IMAP obrigatória' }, 400);
      if (!email_config?.smtp_password) return json({ error: 'Password SMTP obrigatória' }, 400);

      const emailNorm = email_config.email_address.toLowerCase().trim();

      // Já existe uma caixa com este endereço nesta organização?
      const { data: dup } = await admin
        .from('messaging_channels')
        .select('id')
        .eq('organization_id', organization_id)
        .eq('channel_type', 'email')
        .filter('metadata->>email_address', 'eq', emailNorm)
        .maybeSingle();
      if (dup) return json({ error: 'Já existe uma caixa com este endereço de email nesta organização' }, 409);

      // As passwords NÃO entram aqui. Este objeto é lido pelo CRM; tudo o que
      // lhe puseres dentro chega ao browser de quem abrir as Definições.
      const metadata = {
        email_address: emailNorm,
        imap_server: email_config.imap_server.trim(),
        imap_port: Number(email_config.imap_port) || 993,
        imap_ssl: email_config.imap_ssl !== false,
        imap_login: (email_config.imap_login || emailNorm).trim(),
        smtp_server: email_config.smtp_server.trim(),
        smtp_port: Number(email_config.smtp_port) || 587,
        smtp_ssl: email_config.smtp_ssl === true,
        smtp_login: (email_config.smtp_login || emailNorm).trim(),
        provider_key: email_config.provider_key || 'custom',
      };

      const { data: channel, error: dbErr } = await admin
        .from('messaging_channels')
        .insert({
          organization_id,
          channel_type: 'email',
          provider: 'email',
          label: label.trim(),
          status: 'connected',
          metadata,
        })
        .select('id')
        .single();

      if (dbErr || !channel) {
        if (dbErr?.code === '23514' && dbErr.message?.includes('INBOX_LIMIT_REACHED')) return json({ error: 'O limite de caixas de entrada do plano foi atingido.' }, 409);
        console.error('[email-inbox] insert falhou:', dbErr);
        return json({ error: 'Erro ao guardar caixa na base de dados' }, 500);
      }

      // As credenciais, fora do alcance do browser. Sem elas o gateway não liga
      // à caixa — por isso, se isto falhar, desfaz-se a linha em vez de deixar
      // uma caixa que aparece na lista e nunca recebe email.
      const { error: segredoErr } = await admin.from('messaging_channel_secrets').upsert({
        channel_id: channel.id,
        organization_id,
        imap_password: email_config.imap_password,
        smtp_password: email_config.smtp_password,
      }, { onConflict: 'channel_id' });

      if (segredoErr) {
        console.error('[email-inbox] credenciais falharam, a desfazer:', segredoErr);
        await admin.from('messaging_channels').delete().eq('id', channel.id);
        return json({ error: 'Erro ao guardar as credenciais da caixa' }, 500);
      }

      return json({ ok: true, channel_id: channel.id });
    }

    // ── UPDATE ────────────────────────────────────────────────────────────────
    if (action === 'update') {
      const { channel_id, label, email_config } = body as {
        channel_id: string;
        label?: string;
        email_config?: Partial<EmailConfig>;
      };
      if (!channel_id) return json({ error: 'channel_id em falta' }, 400);

      const { data: ch } = await admin
        .from('messaging_channels')
        .select('id, label, metadata')
        .eq('id', channel_id)
        .eq('organization_id', organization_id)
        .eq('channel_type', 'email')
        .maybeSingle();
      if (!ch) return json({ error: 'Caixa não encontrada' }, 404);

      const existing = (ch.metadata as Record<string, unknown>) ?? {};

      // As passwords atuais vêm do cofre. Um metadata antigo ainda pode tê-las
      // (caixas criadas antes da mudança) — daí o recurso.
      const { data: segredo } = await admin
        .from('messaging_channel_secrets')
        .select('imap_password, smtp_password')
        .eq('channel_id', channel_id)
        .maybeSingle();

      const newMeta: Record<string, unknown> = { ...existing };
      // Se lá estiverem de uma versão anterior, saem agora — é este o momento em
      // que a caixa deixa de as ter no sítio errado.
      delete newMeta.imap_password;
      delete newMeta.smtp_password;

      let imapPass = segredo?.imap_password ?? (existing.imap_password as string | undefined) ?? null;
      let smtpPass = segredo?.smtp_password ?? (existing.smtp_password as string | undefined) ?? null;

      if (email_config) {
        const ec = email_config;
        if (ec.email_address) newMeta.email_address = ec.email_address.toLowerCase().trim();
        if (ec.imap_server) newMeta.imap_server = ec.imap_server.trim();
        if (ec.imap_port) newMeta.imap_port = Number(ec.imap_port);
        if (ec.imap_ssl !== undefined) newMeta.imap_ssl = ec.imap_ssl;
        if (ec.imap_login) newMeta.imap_login = ec.imap_login.trim();
        // Em branco = manter a atual, que é o que a interface promete.
        if (ec.imap_password) imapPass = ec.imap_password;
        if (ec.smtp_server) newMeta.smtp_server = ec.smtp_server.trim();
        if (ec.smtp_port) newMeta.smtp_port = Number(ec.smtp_port);
        if (ec.smtp_ssl !== undefined) newMeta.smtp_ssl = ec.smtp_ssl;
        if (ec.smtp_login) newMeta.smtp_login = ec.smtp_login.trim();
        if (ec.smtp_password) smtpPass = ec.smtp_password;
        if (ec.provider_key) newMeta.provider_key = ec.provider_key;
      }

      const { error: segErr } = await admin.from('messaging_channel_secrets').upsert({
        channel_id, organization_id, imap_password: imapPass, smtp_password: smtpPass,
      }, { onConflict: 'channel_id' });
      if (segErr) {
        console.error('[email-inbox] credenciais não guardadas:', segErr);
        return json({ error: 'Erro ao guardar as credenciais da caixa' }, 500);
      }

      const patch: Record<string, unknown> = { metadata: newMeta };
      if (label?.trim()) patch.label = label.trim();

      const { error: upErr } = await admin
        .from('messaging_channels')
        .update(patch)
        .eq('id', channel_id)
        .eq('organization_id', organization_id);
      if (upErr) {
        console.error('[email-inbox] update falhou:', upErr);
        return json({ error: 'Erro ao atualizar a caixa' }, 500);
      }

      return json({ ok: true });
    }

    // ── DELETE ────────────────────────────────────────────────────────────────
    if (action === 'delete') {
      const { channel_id } = body;
      if (!channel_id) return json({ error: 'channel_id em falta' }, 400);

      const { data: ch } = await admin
        .from('messaging_channels')
        .select('id')
        .eq('id', channel_id)
        .eq('organization_id', organization_id)
        .eq('channel_type', 'email')
        .maybeSingle();
      if (!ch) return json({ error: 'Caixa não encontrada' }, 404);

      const { error: delErr } = await admin
        .from('messaging_channels')
        .update({ archived_at: new Date().toISOString(), status: 'disconnected' })
        .eq('id', channel_id)
        .eq('organization_id', organization_id);
      if (delErr) {
        console.error('[email-inbox] delete falhou:', delErr);
        return json({ error: 'Erro ao arquivar a caixa' }, 500);
      }

      return json({ ok: true });
    }

    return json({ error: `Ação desconhecida: ${action}` }, 400);

  } catch (err) {
    console.error('[email-inbox] erro inesperado:', err);
    return json({ error: (err as Error).message || 'Erro interno' }, 500);
  }
});
