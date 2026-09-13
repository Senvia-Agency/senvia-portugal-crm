import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { loadRecipientHistory, matchRecipients, type RecipientSuggestion } from '@/lib/email-recipient-history';
export type { RecipientSuggestion } from '@/lib/email-recipient-history';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

// The email_* tables are newer than the generated Supabase types, so we access
// them through an untyped handle and apply our own result interfaces.
const db = supabase as unknown as {
  from: (t: string) => any;
};

export type EmailFolderRole = 'inbox' | 'sent' | 'drafts' | 'junk' | 'trash' | 'archive' | 'custom';

export interface EmailFolder {
  id: string;
  channel_id: string;
  path: string;
  name: string;
  role: EmailFolderRole;
  unread_count: number;
  total_count: number;
  sort: number;
}

export interface EmailAddress { name: string; address: string; }

export interface EmailMessage {
  id: string;
  channel_id: string;
  folder_id: string;
  uid: number;
  message_id: string | null;
  thread_id: string | null;
  in_reply_to: string | null;
  from_name: string | null;
  from_address: string | null;
  to_addresses: EmailAddress[];
  cc_addresses: EmailAddress[];
  subject: string | null;
  snippet: string | null;
  date: string | null;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  has_attachments: boolean;
  body_fetched: boolean;
  html_body: string | null;
  text_body: string | null;
  email_references: string[] | null;
}

export interface EmailAttachment {
  id: string;
  message_id: string;
  filename: string | null;
  content_type: string | null;
  size: number | null;
  inline: boolean;
  content_id: string | null;
  storage_path: string | null;
  data_b64?: string | null;
}

// Folders of an email caixa, ordered for the rail (system folders first).
export function useEmailFolders(channelId: string | null) {
  return useQuery({
    queryKey: ['email-folders', channelId],
    queryFn: async (): Promise<EmailFolder[]> => {
      if (!channelId) return [];
      const { data, error } = await db
        .from('email_folders')
        .select('id, channel_id, path, name, role, unread_count, total_count, sort')
        .eq('channel_id', channelId)
        .order('sort', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return (data || []) as EmailFolder[];
    },
    enabled: !!channelId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

// Message headers of a folder (no bodies — keeps the list light).
export function useEmailMessages(folderId: string | null) {
  return useQuery({
    queryKey: ['email-messages', folderId],
    queryFn: async (): Promise<EmailMessage[]> => {
      if (!folderId) return [];
      const { data, error } = await db
        .from('email_messages')
        .select('id, channel_id, folder_id, uid, thread_id, from_name, from_address, to_addresses, cc_addresses, subject, snippet, date, seen, flagged, answered, has_attachments')
        .eq('folder_id', folderId)
        .order('date', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as EmailMessage[];
    },
    enabled: !!folderId,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}

// Live updates: when the gateway syncs new mail / flag changes (IDLE), refresh
// the folder counts and message lists for this caixa without a manual reload.
// Command types surfaced with a friendly pt-PT label when they fail — everything
// else falls back to a generic "ação" so a new command type never crashes this.
export const COMMAND_LABELS: Record<string, string> = {
  send: 'Enviar email',
  archive: 'Arquivar', spam: 'Marcar como spam', delete: 'Apagar', move: 'Mover',
  mark_read: 'Marcar como lida', mark_unread: 'Marcar como não lida',
  flag: 'Marcar com estrela', unflag: 'Remover estrela',
  mark_folder_read: 'Marcar pasta como lida', load_older: 'Carregar mais antigos',
  sync_unread: 'Procurar não lidos', fetch_attachment: 'Obter anexo',
  fetch_body: 'Carregar conteúdo do email',
};

export function emailCommandErrorMessage(error: string | null | undefined): string | undefined {
  if (error?.includes('tipo desconhecido: fetch_body')) {
    return 'Esta tentativa de carregar o conteúdo falhou. Abre novamente o email.';
  }
  return error || undefined;
}

export function useEmailRealtime(channelId: string | null) {
  const qc = useQueryClient();
  const { toast } = useToast();
  useEffect(() => {
    if (!channelId) return;
    const channel = supabase
      .channel(`email-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_messages', filter: `channel_id=eq.${channelId}` }, () => {
        qc.invalidateQueries({ queryKey: ['email-recipient-history', channelId] });
        qc.invalidateQueries({ queryKey: ['email-messages'] });
        qc.invalidateQueries({ queryKey: ['email-message'] });
        qc.invalidateQueries({ queryKey: ['email-folders', channelId] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_folders', filter: `channel_id=eq.${channelId}` }, () => {
        qc.invalidateQueries({ queryKey: ['email-folders', channelId] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_drafts', filter: `channel_id=eq.${channelId}` }, () => {
        qc.invalidateQueries({ queryKey: ['email-drafts', channelId] });
      })
      // The gateway marks a queued action 'error' when it fails (e.g. IMAP/SMTP
      // hiccup) — without this, the optimistic UI update (archived/deleted/etc.)
      // just silently stays wrong until the next full resync. Surface it instead.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_commands', filter: `channel_id=eq.${channelId}` }, (payload) => {
        qc.invalidateQueries({ queryKey: ['email-command-activity', channelId] });
        qc.invalidateQueries({ queryKey: ['email-command-failures', channelId] });
        qc.invalidateQueries({ queryKey: ['email-message'] });
        const row = payload.new as { type?: string; status?: string; error?: string } | undefined;
        if (row?.type === 'send' && row.status === 'done') {
          qc.invalidateQueries({ queryKey: ['email-recipient-history', channelId] });
          toast({ title: 'Email enviado' });
        }
        if (row?.status !== 'error') return;
        const label = (row.type && COMMAND_LABELS[row.type]) || 'Uma ação de email';
        toast({ title: `${label} falhou`, description: emailCommandErrorMessage(row.error), variant: 'destructive' });
        // The optimistic patch this command made (e.g. removing a message from
        // the list) is now known-wrong — reconcile from the DB.
        qc.invalidateQueries({ queryKey: ['email-messages'] });
        qc.invalidateQueries({ queryKey: ['email-folders', channelId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [channelId, qc, toast]);
}

/** Durable queue progress survives closing the composer or reloading the page. */
export function useEmailCommandActivity(channelId: string | null) {
  return useQuery({
    queryKey: ['email-command-activity', channelId],
    enabled: !!channelId,
    queryFn: async (): Promise<{ pending: number; sends: number }> => {
      const { data, error } = await db.from('email_commands')
        .select('type').eq('channel_id', channelId).in('status', ['pending', 'processing']);
      if (error) throw error;
      return { pending: data.length, sends: data.filter((row: { type: string }) => row.type === 'send').length };
    },
    refetchInterval: 5000,
    staleTime: 3000,
  });
}

export interface EmailCommandFailure {
  id: string;
  type: string;
  error: string | null;
  created_at: string;
  message_id?: string | null;
}

/**
 * Ações de email que falharam e ninguém viu.
 *
 * O aviso de falha era só um evento em tempo real: se não estivesses com o CRM
 * aberto no instante exato, desaparecia sem deixar rasto. E a interface já tinha
 * removido a mensagem da lista de forma otimista — ficavas a pensar que
 * arquivaste um email que continua na caixa.
 *
 * Isto é a lista do que ficou por fazer, que se pode ver a qualquer hora.
 */
export function useEmailCommandFailures(channelId: string | null) {
  return useQuery({
    queryKey: ['email-command-failures', channelId],
    queryFn: async (): Promise<EmailCommandFailure[]> => {
      if (!channelId) return [];
      const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await db
        .from('email_commands')
        .select('id, type, error, created_at, message_id:payload->>messageId')
        .eq('channel_id', channelId)
        .eq('status', 'error')
        .gte('created_at', desde)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;

      const failures = (data || []) as EmailCommandFailure[];
      const bodyIds = failures.filter(f => f.type === 'fetch_body' && f.message_id).map(f => f.message_id!);
      const resolvedBodies = new Set<string>();
      if (bodyIds.length) {
        const { data: resolved } = await db.from('email_messages').select('id').in('id', bodyIds).eq('body_fetched', true);
        for (const message of resolved || []) resolvedBodies.add(message.id);
      }

      // "Mensagem inexistente" num comando que servia para TIRAR a mensagem da
      // pasta não é uma falha: o fim que se queria já aconteceu. É o que sai
      // quando se carrega duas vezes, ou quando a mensagem foi apagada noutro
      // lado. Avisar disto é assustar com uma coisa que correu bem.
      const remocao = new Set(['delete', 'archive', 'spam', 'move']);
      return failures.filter((f) =>
        !(f.type === 'fetch_body' && f.message_id && resolvedBodies.has(f.message_id))
        && !(remocao.has(f.type) && /inexistente|not found|no such/i.test(f.error ?? '')));
    },
    enabled: !!channelId,
    refetchInterval: 60_000,
  });
}

// Sent recipients are cached per mailbox, organization and signed-in user.
// No addresses are persisted in browser storage on a shared computer.
export function useEmailRecipientSuggestions(
  term: string,
  channelId: string | null,
  organizationId: string | undefined,
) {
  const { user } = useAuth();
  const [debouncedTerm, setDebouncedTerm] = useState(term);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedTerm(term), 200);
    return () => window.clearTimeout(timer);
  }, [term]);
  const history = useQuery({
    queryKey: ['email-recipient-history', channelId, organizationId, user?.id],
    queryFn: () => loadRecipientHistory(db, organizationId!, channelId!, user!.id),
    enabled: !!channelId && !!organizationId && !!user?.id,
    staleTime: 5 * 60_000,
  });
  // Strip PostgREST filter metacharacters from typed text.
  const safe = debouncedTerm.trim().replace(/[(),*%"\\]/g, '');
  const contacts = useQuery({
    queryKey: ['email-recipient-suggestions', organizationId, channelId, user?.id, safe],
    queryFn: async (): Promise<RecipientSuggestion[]> => {
      const results: RecipientSuggestion[] = [];
      const push = (name: string | null, address: string | null, source: 'crm' | 'recent') => {
        const addr = (address || '').trim().toLowerCase();
        if (addr) results.push({ name: name || addr, address: addr, source });
      };
      const [clients, leads, recents] = await Promise.all([
        supabase.from('crm_clients').select('name, email')
          .eq('organization_id', organizationId!).not('email', 'is', null)
          .or(`name.ilike.%${safe}%,email.ilike.%${safe}%`).limit(5),
        supabase.from('leads').select('name, email')
          .eq('organization_id', organizationId!).not('email', 'is', null)
          .or(`name.ilike.%${safe}%,email.ilike.%${safe}%`).limit(5),
        channelId ? db.from('email_messages').select('from_name, from_address')
          .eq('organization_id', organizationId).eq('channel_id', channelId)
          .or(`from_address.ilike.%${safe}%,from_name.ilike.%${safe}%`)
          .order('date', { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
      ]);
      for (const c of clients.data ?? []) push(c.name, c.email, 'crm');
      for (const l of leads.data ?? []) push(l.name, l.email, 'crm');
      for (const r of recents.data ?? []) push(r.from_name, r.from_address, 'recent');
      return results;
    },
    enabled: safe.length >= 2 && !!organizationId && !!user?.id,
    staleTime: 30_000,
  });
  // History responds immediately; only remote CRM searches are debounced.
  return { ...contacts, data: matchRecipients(term, history.data || [], contacts.data || []) };
}

export interface EmailDraft {
  id: string;
  channel_id: string;
  author_id: string | null;
  to_addresses: EmailAddress[];
  cc_addresses: EmailAddress[];
  bcc_addresses: EmailAddress[];
  subject: string | null;
  body_html: string | null;
  in_reply_to: string | null;
  reply_message_id: string | null;
  attachments: Array<{ filename: string; contentType: string; b64: string; size?: number }>;
  created_at: string;
  updated_at: string;
}

export function useEmailDrafts(channelId: string | null) {
  return useQuery({
    queryKey: ['email-drafts', channelId],
    queryFn: async (): Promise<EmailDraft[]> => {
      if (!channelId) return [];
      const { data, error } = await db
        .from('email_drafts')
        .select('*')
        .eq('channel_id', channelId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data || []) as EmailDraft[];
    },
    enabled: !!channelId,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}

// Search across the whole caixa (all folders) by subject / sender / snippet.
export function useEmailSearch(channelId: string | null, query: string) {
  const term = query.trim().replace(/[,()%]/g, ' ');
  return useQuery({
    queryKey: ['email-search', channelId, term],
    queryFn: async (): Promise<EmailMessage[]> => {
      if (!channelId || term.length < 2) return [];
      const like = `%${term}%`;
      const { data, error } = await db
        .from('email_messages')
        .select('id, channel_id, folder_id, from_name, from_address, to_addresses, cc_addresses, subject, snippet, date, seen, flagged, answered, has_attachments')
        .eq('channel_id', channelId)
        .or(`subject.ilike.${like},from_name.ilike.${like},from_address.ilike.${like},snippet.ilike.${like}`)
        .order('date', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as EmailMessage[];
    },
    enabled: !!channelId && term.length >= 2,
  });
}

// One full message (with body) + its attachments, for the reader pane.
export function useEmailMessage(messageId: string | null) {
  return useQuery({
    queryKey: ['email-message', messageId],
    queryFn: async (): Promise<{ message: EmailMessage; attachments: EmailAttachment[] } | null> => {
      if (!messageId) return null;
      const { data: message, error } = await db
        .from('email_messages').select('*').eq('id', messageId).single();
      if (error) throw error;
      const { data: attachments } = await db
        .from('email_attachments')
        .select('id, message_id, filename, content_type, size, inline, content_id, storage_path')
        .eq('message_id', messageId);
      return { message: message as EmailMessage, attachments: (attachments || []) as EmailAttachment[] };
    },
    enabled: !!messageId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
