import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { tr } from '@/i18n';

export interface EmailSignature {
  id: string;
  name: string;
  html: string;
}

export interface VacationReply {
  enabled: boolean;
  start_date?: string | null; // 'YYYY-MM-DD'
  end_date?: string | null;   // 'YYYY-MM-DD' (optional)
  subject?: string;
  message?: string;           // HTML/plain body of the auto-reply
  only_contacts?: boolean;    // only reply to senders that exist as CRM lead/client
}

export interface EmailChannel {
  id: string;
  organization_id: string;
  channel_type: 'email';
  provider: string;
  label: string | null;
  chatwoot_inbox_id: number | null;
  status: string;
  assigned_user_ids: string[];
  rotate_enabled: boolean;
  color: string | null;
  metadata: {
    email_address?: string;
    imap_server?: string;
    imap_port?: number;
    imap_ssl?: boolean;
    imap_login?: string;
    smtp_server?: string;
    smtp_port?: number;
    smtp_ssl?: boolean;
    smtp_login?: string;
    provider_key?: string;
    // Signatures (per caixa). The gateway appends the chosen default to outgoing
    // mail: signature_default_new for fresh emails, signature_default_reply for replies.
    signatures?: EmailSignature[];
    signature_default_new?: string | null;
    signature_default_reply?: string | null;
    // Vacation auto-reply (Gmail-style "resposta automática de férias").
    vacation_reply?: VacationReply;
    // imap_password / smtp_password intentionally excluded (stripped below)
  } | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface EmailChannelInput {
  label: string;
  email_config: {
    email_address: string;
    imap_server: string;
    imap_port: number;
    imap_ssl: boolean;
    imap_login: string;
    imap_password: string;
    smtp_server: string;
    smtp_port: number;
    smtp_ssl: boolean;
    smtp_login: string;
    smtp_password: string;
    provider_key?: string;
  };
}

export interface EmailChannelUpdate {
  channel_id: string;
  label?: string;
  email_config?: Partial<Omit<EmailChannelInput['email_config'], 'email_address'>> & {
    email_address?: string;
    imap_password?: string; // optional — keep existing if blank
    smtp_password?: string; // optional — keep existing if blank
  };
}

/**
 * Passa `metadata_public` para `metadata`, que é o nome que os componentes usam.
 *
 * Isto era um `stripPasswords` que filtrava as chaves acabadas em `_password`
 * — mas corria sobre uma resposta que JÁ tinha as passwords lá dentro. Limpava
 * o objeto em memória depois de ele ter atravessado a rede: no separador Network
 * do browser, e na cache do React Query, elas estavam. Agora nunca são enviadas,
 * e não há nada para limpar.
 */
function comMetadataPublico(ch: Record<string, unknown>): EmailChannel {
  const { metadata_public, ...resto } = ch;
  return {
    ...(resto as unknown as EmailChannel),
    metadata: (metadata_public ?? null) as EmailChannel['metadata'],
  };
}

export function useEmailChannels() {
  const { organization } = useAuth();
  return useQuery({
    queryKey: ['email-channels', organization?.id],
    queryFn: async (): Promise<EmailChannel[]> => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from('messaging_channels')
        // `metadata_public` é o metadata sem as passwords. O `stripPasswords`
        // abaixo limpava-as DEPOIS de o browser as ter recebido — apareciam no
        // separador Network e na cache antes de serem escondidas. Esconder na
        // interface nunca foi o mesmo que não enviar.
        .select(
          'id, organization_id, channel_type, provider, label, chatwoot_inbox_id,'
          + ' status, assigned_user_ids, rotate_enabled, color, created_at, updated_at,'
          + ' metadata_public',
        )
        .eq('organization_id', organization.id)
        .eq('channel_type', 'email')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []).map((r) => comMetadataPublico(r as unknown as Record<string, unknown>));
    },
    enabled: !!organization?.id,
  });
}

export function useCreateEmailChannel() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: EmailChannelInput) => {
      if (!organization?.id) throw new Error(tr('Organização não encontrada'));
      const { data, error } = await supabase.functions.invoke('email-inbox', {
        body: { organization_id: organization.id, action: 'create', ...input },
      });
      // The function says why a mailbox was refused (wrong password, Microsoft, unreachable server).
      if (error) {
        const reason = await (error as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(reason?.error ?? error.message);
      }
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error);
      return data as { ok: boolean; channel_id: string; chatwoot_inbox_id: number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-channels', organization?.id] });
      queryClient.invalidateQueries({ queryKey: ['messaging-channels', organization?.id] });
    },
  });
}

export function useUpdateEmailChannel() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: EmailChannelUpdate) => {
      if (!organization?.id) throw new Error(tr('Organização não encontrada'));
      const { data, error } = await supabase.functions.invoke('email-inbox', {
        body: { organization_id: organization.id, action: 'update', ...input },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-channels', organization?.id] });
      queryClient.invalidateQueries({ queryKey: ['messaging-channels', organization?.id] });
    },
  });
}

// Save signatures / vacation config into the caixa's metadata. Uses the shallow
// JSONB merge RPC so it never clobbers the IMAP/SMTP credentials already stored.
export function useSaveEmailChannelMeta() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ channelId, patch }: { channelId: string; patch: Record<string, unknown> }) => {
      const { error } = await (supabase.rpc as any)('merge_messaging_channel_metadata_by_id', {
        p_channel_id: channelId,
        p_patch: patch,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-channels', organization?.id] });
      queryClient.invalidateQueries({ queryKey: ['messaging-channels', organization?.id] });
    },
  });
}

export function useDeleteEmailChannel() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (channelId: string) => {
      if (!organization?.id) throw new Error(tr('Organização não encontrada'));
      const { data, error } = await supabase.functions.invoke('email-inbox', {
        body: { organization_id: organization.id, action: 'delete', channel_id: channelId },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-channels', organization?.id] });
      queryClient.invalidateQueries({ queryKey: ['messaging-channels', organization?.id] });
    },
  });
}
