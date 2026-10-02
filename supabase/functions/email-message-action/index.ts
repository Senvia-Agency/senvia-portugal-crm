import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ImapFlow } from 'npm:imapflow@1.7.8';
import ipaddr from 'npm:ipaddr.js@2.5.0';
import { applyMailboxAction, emailMessageActions, type EmailMessageAction } from './imap-action.ts';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Folder = { id: string; path: string; role: string };
type Message = { id: string; channel_id: string; organization_id: string; folder_id: string; uid: number };
type ImapMetadata = {
  imap_server?: unknown;
  imap_port?: unknown;
  imap_ssl?: unknown;
  imap_login?: unknown;
  email_address?: unknown;
};

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseInput(input: unknown): { action: EmailMessageAction; messageIds: string[] } | null {
  if (!input || typeof input !== 'object') return null;
  const payload = input as { action?: unknown; message_ids?: unknown };
  if (typeof payload.action !== 'string' || !emailMessageActions.includes(payload.action as EmailMessageAction)) return null;
  if (!Array.isArray(payload.message_ids) || payload.message_ids.length === 0 || payload.message_ids.length > 100) return null;
  const messageIds = [...new Set(payload.message_ids)];
  if (messageIds.length !== payload.message_ids.length || !messageIds.every((id) => typeof id === 'string' && uuid.test(id))) return null;
  return { action: payload.action as EmailMessageAction, messageIds };
}

async function publicImapAddress(host: string): Promise<string> {
  if (!host || host.length > 253 || /[\s/@\\%\[\]]/.test(host)) throw new Error('Servidor IMAP inválido.');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => ipaddr.parse(address).range() !== 'unicast')) {
    throw new Error('Servidor IMAP não público.');
  }
  return addresses[0].address;
}

async function refreshFolderCount(
  client: ImapFlow,
  admin: ReturnType<typeof createClient>,
  folder: Folder,
  channelId: string,
  organizationId: string,
): Promise<void> {
  try {
    const status = await client.status(folder.path, { messages: true, unseen: true });
    const totalCount = typeof status.messages === 'number' ? status.messages : null;
    const unreadCount = typeof status.unseen === 'number' ? status.unseen : null;
    if (totalCount === null || unreadCount === null) return;
    await admin.from('email_folders').update({ total_count: totalCount, unread_count: unreadCount }).eq('id', folder.id)
      .eq('channel_id', channelId).eq('organization_id', organizationId);
  } catch {}
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) return json({ error: 'Sessão necessária' }, 401);
    const input = parseInput(await req.json());
    if (!input) return json({ error: 'Pedido de email inválido.' }, 400);

    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceRoleKey) return json({ error: 'Serviço de email indisponível.' }, 503);

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await userClient.auth.getUser();
    if (authError || !auth.user) return json({ error: 'Sessão inválida' }, 401);

    const { data: rows, error: messagesError } = await userClient.from('email_messages')
      .select('id,channel_id,organization_id,folder_id,uid').in('id', input.messageIds);
    const messages = (rows ?? []) as Message[];
    if (messagesError || messages.length !== input.messageIds.length) {
      return json({ error: 'Uma ou mais mensagens deixaram de estar disponíveis nesta caixa.' }, 404);
    }

    const first = messages[0];
    if (!messages.every((message) => message.channel_id === first.channel_id
      && message.organization_id === first.organization_id && message.folder_id === first.folder_id
      && Number.isSafeInteger(message.uid) && message.uid > 0)) {
      return json({ error: 'Seleciona mensagens da mesma pasta.' }, 400);
    }

    const { data: sourceData, error: sourceError } = await userClient.from('email_folders')
      .select('id,path,role').eq('id', first.folder_id).eq('channel_id', first.channel_id).maybeSingle();
    const source = sourceData as Folder | null;
    if (sourceError || !source) return json({ error: 'Pasta de email indisponível.' }, 404);
    if (input.action === 'move_to_trash' && source.role === 'trash') {
      return json({ error: 'As mensagens já estão no Lixo.' }, 400);
    }

    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: channel } = await admin.from('messaging_channels').select('metadata').eq('id', first.channel_id)
      .eq('organization_id', first.organization_id).eq('channel_type', 'email').maybeSingle();
    const { data: secret } = await admin.from('messaging_channel_secrets').select('imap_password').eq('channel_id', first.channel_id)
      .eq('organization_id', first.organization_id).maybeSingle();
    const metadata = channel?.metadata as ImapMetadata | undefined;
    const host = stringValue(metadata?.imap_server);
    const user = stringValue(metadata?.imap_login) ?? stringValue(metadata?.email_address);
    const password = stringValue(secret?.imap_password);
    if (!host || !user || !password || Number(metadata?.imap_port ?? 993) !== 993 || metadata?.imap_ssl === false) {
      return json({ error: 'Configuração IMAP indisponível.' }, 503);
    }

    let target: Folder | null = null;
    if (input.action === 'move_to_trash') {
      const { data: targetData } = await admin.from('email_folders').select('id,path,role').eq('channel_id', first.channel_id)
        .eq('organization_id', first.organization_id).eq('role', 'trash').maybeSingle();
      target = targetData as Folder | null;
      if (!target) return json({ error: 'A pasta Lixo não está disponível nesta conta.' }, 503);
    }

    const address = await publicImapAddress(host);
    const client = new ImapFlow({
      host: address,
      servername: host,
      port: 993,
      secure: true,
      tls: { rejectUnauthorized: true, servername: host },
      auth: { user, pass: password },
      logger: false,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      disableAutoIdle: true,
    });
    client.on('error', () => {});
    const timeout = setTimeout(() => client.close(), 45_000);
    try {
      await client.connect();
      const mailboxResult = await applyMailboxAction(client, {
        action: input.action,
        sourcePath: source.path,
        sourceIsTrash: source.role === 'trash',
        targetPath: target?.path,
        uids: messages.map((message) => message.uid),
      });
      let cachePending = false;
      if (input.action === 'move_to_trash') {
        if (!target || !mailboxResult || mailboxResult.size !== messages.length) {
          throw new Error('O servidor de correio não devolveu a localização das mensagens movidas.');
        }
        const updates = await Promise.all(messages.map(async (message) => {
          const destinationUid = mailboxResult.get(message.uid);
          if (!destinationUid) return true;
          const { error } = await admin.from('email_messages').update({ folder_id: target.id, uid: destinationUid, updated_at: new Date().toISOString() })
            .eq('id', message.id).eq('channel_id', message.channel_id).eq('organization_id', message.organization_id);
          return Boolean(error);
        }));
        cachePending = updates.some(Boolean);
      } else {
        const { error } = await admin.from('email_messages').delete().in('id', input.messageIds);
        cachePending = Boolean(error);
      }
      await Promise.all([
        refreshFolderCount(client, admin, source, first.channel_id, first.organization_id),
        ...(target ? [refreshFolderCount(client, admin, target, first.channel_id, first.organization_id)] : []),
      ]);
      return json({ ok: true, processed: input.messageIds.length, cache_pending: cachePending });
    } finally {
      clearTimeout(timeout);
      client.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const safe = /^(Não há mensagens|A eliminação permanente|A pasta Lixo|O servidor de correio não confirmou|Servidor IMAP|Esta ação)/.test(message);
    return json({ error: safe ? message : 'Não foi possível concluir a ação no servidor de correio. Tenta novamente.' }, 502);
  }
});
