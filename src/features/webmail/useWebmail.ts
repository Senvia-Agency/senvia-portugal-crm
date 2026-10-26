import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useMessagingChannels } from '@/hooks/useMessagingChannels';
import { COMMAND_LABELS, emailCommandErrorMessage, type EmailMessage } from '@/hooks/useEmail';
import {
  deleteContactList, describeWebmailError, isMissingMigration, readContactLists, readContacts, readDrafts, readFolders,
  readMessages, readPreferences, readSignatures, readThread, saveContactList, saveOrder, savePreference, saveSignatures,
  setDefaultAccount, type ListQuery, type PreferencePatch, type SignatureDraft,
} from './webmail-api';
import { buildAccounts, type MailAccount } from './webmail-model';

const db = supabase as unknown as { from: (table: string) => any };

export function useWebmailScope() {
  const { user, organization, roles, isSuperAdmin } = useAuth();
  return {
    userId: user?.id ?? null,
    organizationId: organization?.id ?? null,
    admin: isSuperAdmin || roles.includes('admin'),
  };
}

/** The caixas this person can open, merged with their own name, colour, order, default and alerts. */
export function useMailAccounts() {
  const { userId, organizationId, admin } = useWebmailScope();
  const channels = useMessagingChannels();
  const preferences = useQuery({
    queryKey: ['webmail-preferences', organizationId, userId],
    queryFn: () => readPreferences(organizationId!, userId!),
    enabled: !!organizationId && !!userId,
    retry: (count, error) => !isMissingMigration(error) && count < 2,
  });
  const accounts = useMemo(
    () => (userId ? buildAccounts(channels.data ?? [], preferences.data ?? [], userId, admin) : []),
    [channels.data, preferences.data, userId, admin],
  );
  return {
    accounts, admin,
    isLoading: channels.isLoading,
    preferencesError: preferences.error ? describeWebmailError(preferences.error) : null,
  };
}

export function usePreferenceActions() {
  const { userId, organizationId } = useWebmailScope();
  const client = useQueryClient();
  const key = ['webmail-preferences', organizationId, userId];
  const refresh = () => client.invalidateQueries({ queryKey: key });
  const guard = () => { if (!userId || !organizationId) throw new Error('Sessão sem organização.'); return { userId, organizationId }; };
  return {
    save: useMutation({
      mutationFn: ({ channelId, patch }: { channelId: string; patch: PreferencePatch }) => {
        const scope = guard();
        return savePreference(scope.organizationId, scope.userId, channelId, patch);
      },
      onSettled: refresh,
    }),
    setDefault: useMutation({
      mutationFn: (channelId: string | null) => { const scope = guard(); return setDefaultAccount(scope.organizationId, scope.userId, channelId); },
      onSettled: refresh,
    }),
    reorder: useMutation({
      mutationFn: (channelIds: readonly string[]) => { const scope = guard(); return saveOrder(scope.organizationId, scope.userId, channelIds); },
      // The new order shows at once; a failure puts the saved one back.
      onMutate: async channelIds => {
        await client.cancelQueries({ queryKey: key });
        const previous = client.getQueryData(key);
        client.setQueryData(key, (old: { channel_id: string }[] | undefined) => {
          const rows = new Map((old ?? []).map(row => [row.channel_id, row]));
          return channelIds.map((channelId, position) => ({
            label: null, color: null, notify: true, is_default: false, ...rows.get(channelId), channel_id: channelId, position,
          }));
        });
        return { previous };
      },
      onError: (_error, _ids, context) => client.setQueryData(key, context?.previous),
      onSettled: refresh,
    }),
  };
}

export function useWebmailFolders(channelIds: readonly string[]) {
  return useQuery({
    queryKey: ['email-folders', 'webmail', ...channelIds],
    queryFn: () => readFolders(channelIds),
    enabled: channelIds.length > 0,
    staleTime: 20_000,
    // The gateway's heartbeat and unread counts change without a row event when nothing arrives.
    refetchInterval: 60_000,
  });
}

export const listKey = (query: ListQuery) => ['email-messages', 'webmail', query.channelIds.join(','), query.folderIds?.join(',') ?? '*', !!query.unread, !!query.starred, query.search?.trim() ?? ''];
export function useMailList(query: ListQuery, enabled: boolean) {
  return useQuery({
    queryKey: listKey(query),
    queryFn: () => readMessages(query),
    enabled,
    staleTime: 15_000,
    refetchInterval: (query.search ?? '').trim() ? false : 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useMailDrafts(channelIds: readonly string[], enabled: boolean) {
  const { userId } = useWebmailScope();
  return useQuery({
    queryKey: ['email-drafts', 'webmail', userId, ...channelIds],
    queryFn: () => readDrafts(channelIds, userId!),
    enabled: enabled && !!userId,
  });
}

export function useMailThread(message: EmailMessage | null | undefined) {
  return useQuery({
    queryKey: ['email-thread', message?.channel_id, message?.thread_id, message?.id],
    queryFn: () => readThread(message!),
    enabled: !!message?.thread_id,
    staleTime: 30_000,
  });
}

/** One realtime subscription for every open caixa: lists, counts, drafts and the command queue. */
export function useWebmailRealtime(channelIds: readonly string[]) {
  const client = useQueryClient();
  const joined = channelIds.join(',');
  useEffect(() => {
    if (!joined) return;
    const filter = `channel_id=in.(${joined})`;
    const refreshMail = () => {
      void client.invalidateQueries({ queryKey: ['email-messages'] });
      void client.invalidateQueries({ queryKey: ['email-message'] });
      void client.invalidateQueries({ queryKey: ['email-thread'] });
      void client.invalidateQueries({ queryKey: ['email-folders'] });
    };
    const channel = supabase.channel(`webmail:${joined.slice(0, 80)}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_messages', filter }, refreshMail)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_folders', filter }, () => void client.invalidateQueries({ queryKey: ['email-folders'] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_drafts', filter }, () => void client.invalidateQueries({ queryKey: ['email-drafts'] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_commands', filter }, payload => {
        void client.invalidateQueries({ queryKey: ['email-command-activity'] });
        void client.invalidateQueries({ queryKey: ['email-command-failures'] });
        const row = payload.new as { type?: string; status?: string; error?: string } | undefined;
        if (row?.type === 'send' && row.status === 'done') toast.success('Email enviado');
        if (row?.status === 'error') {
          toast.error(`${(row.type && COMMAND_LABELS[row.type]) || 'Uma ação de email'} falhou`, { description: emailCommandErrorMessage(row.error) });
          refreshMail();
        }
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [client, joined]);
}

// Mailbox actions --------------------------------------------------------------------------------

function patchLists(client: QueryClient, ids: ReadonlySet<string>, patch: Partial<EmailMessage>) {
  client.setQueriesData({ queryKey: ['email-messages', 'webmail'] }, (old: EmailMessage[] | undefined) =>
    Array.isArray(old) ? old.map(message => (ids.has(message.id) ? { ...message, ...patch } : message)) : old);
  for (const id of ids) client.setQueryData(['email-message', id], (old: { message: EmailMessage } | null | undefined) =>
    old ? { ...old, message: { ...old.message, ...patch } } : old);
}

const groupBy = <T,>(items: readonly T[], key: (item: T) => string) => {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return [...groups.values()];
};

/**
 * Actions on messages that may come from several caixas (the unified view). Every command goes to the
 * message's own caixa. Messages being moved away stay hidden until they leave the list for real, or
 * come back when the request fails — the same rule as the Inbox reader.
 */
export function useMailboxActions() {
  const { userId, organizationId } = useWebmailScope();
  const client = useQueryClient();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const hiddenRef = useRef(new Set<string>());
  const release = useCallback((ids: readonly string[]) => {
    let changed = false;
    ids.forEach(id => { if (hiddenRef.current.delete(id)) changed = true; });
    if (changed) setHidden(new Set(hiddenRef.current));
  }, []);
  // Hidden at once and taken out of every list. The gateway confirms within seconds; if a command
  // fails (the realtime toast says so), the message reappears on the next read after the hold.
  const hide = (ids: readonly string[]) => {
    ids.forEach(id => hiddenRef.current.add(id));
    setHidden(new Set(hiddenRef.current));
    const gone = new Set(ids);
    client.setQueriesData({ queryKey: ['email-messages', 'webmail'] }, (old: EmailMessage[] | undefined) =>
      Array.isArray(old) ? old.filter(message => !gone.has(message.id)) : old);
    window.setTimeout(() => release(ids), 20_000);
  };

  const queue = async (channelId: string, type: string, payload: Record<string, unknown>) => {
    if (!organizationId) throw new Error('Sessão sem organização.');
    const { error } = await db.from('email_commands').insert({ organization_id: organizationId, channel_id: channelId, type, payload, created_by: userId });
    if (error) throw error;
  };
  const report = (error: unknown) => toast.error('Ação de email não concluída', { description: error instanceof Error ? error.message : describeWebmailError(error) });

  const removeAway = (type: 'archive' | 'spam' | 'move', messages: readonly EmailMessage[], extra: Record<string, unknown> = {}) => {
    const fresh = messages.filter(message => !hiddenRef.current.has(message.id));
    hide(fresh.map(message => message.id));
    return Promise.all(fresh.map(message => queue(message.channel_id, type, { messageId: message.id, ...extra }).catch(error => {
      release([message.id]);
      throw error;
    }))).catch(report);
  };

  const mailboxAction = async (action: 'move_to_trash' | 'delete_permanently', messages: readonly EmailMessage[]) => {
    const fresh = messages.filter(message => !hiddenRef.current.has(message.id));
    if (fresh.length === 0) return;
    hide(fresh.map(message => message.id));
    // The server moves one folder of one caixa per request.
    await Promise.all(groupBy(fresh, message => `${message.channel_id}:${message.folder_id}`).map(async group => {
      const ids = group.map(message => message.id);
      try {
        const { data, error } = await supabase.functions.invoke('email-message-action', { body: { action, message_ids: ids } });
        const failure = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : null;
        if (error || failure) throw new Error(failure || 'Não foi possível concluir a ação no servidor de correio.');
      } catch (error) {
        // Nothing moved on the server: the messages come back now.
        release(ids);
        report(error);
      }
    }));
    await Promise.all([client.invalidateQueries({ queryKey: ['email-messages'] }), client.invalidateQueries({ queryKey: ['email-folders'] })]);
    release(fresh.map(message => message.id));
  };

  return {
    hidden, release,
    setRead: (messages: readonly EmailMessage[], read: boolean) => {
      const changed = messages.filter(message => message.seen !== read);
      if (changed.length === 0) return;
      patchLists(client, new Set(changed.map(message => message.id)), { seen: read });
      void Promise.all(changed.map(message => queue(message.channel_id, read ? 'mark_read' : 'mark_unread', { messageId: message.id }))).catch(report);
    },
    setFlag: (messages: readonly EmailMessage[], on: boolean) => {
      patchLists(client, new Set(messages.map(message => message.id)), { flagged: on });
      void Promise.all(messages.map(message => queue(message.channel_id, on ? 'flag' : 'unflag', { messageId: message.id }))).catch(report);
    },
    archive: (messages: readonly EmailMessage[]) => removeAway('archive', messages),
    spam: (messages: readonly EmailMessage[]) => removeAway('spam', messages),
    move: (messages: readonly EmailMessage[], targetFolderId: string) => removeAway('move', messages, { targetFolderId }),
    trash: (messages: readonly EmailMessage[]) => mailboxAction('move_to_trash', messages),
    deletePermanently: (messages: readonly EmailMessage[]) => mailboxAction('delete_permanently', messages),
    markFolderRead: (folders: readonly { id: string; channel_id: string }[]) => {
      client.setQueriesData({ queryKey: ['email-messages', 'webmail'] }, (old: EmailMessage[] | undefined) =>
        Array.isArray(old) ? old.map(message => (folders.some(folder => folder.id === message.folder_id) ? { ...message, seen: true } : message)) : old);
      void Promise.all(folders.map(folder => queue(folder.channel_id, 'mark_folder_read', { folderId: folder.id }))).catch(report);
    },
    loadOlder: (folders: readonly { id: string; channel_id: string }[]) =>
      Promise.all(folders.map(folder => queue(folder.channel_id, 'load_older', { folderId: folder.id, batch: 40 }))).catch(report),
    syncUnread: (folders: readonly { id: string; channel_id: string }[]) =>
      Promise.all(folders.map(folder => queue(folder.channel_id, 'sync_unread', { folderId: folder.id }))).catch(report),
    fetchBody: async (messageId: string) => {
      const { error } = await supabase.functions.invoke('email-fetch-body', { body: { message_id: messageId } });
      if (error) {
        const detail = await error.context?.json?.().catch(() => null);
        throw new Error(detail?.error || 'Não foi possível carregar o conteúdo do email.');
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: ['email-message', messageId] }),
        client.invalidateQueries({ queryKey: ['email-thread'] }),
      ]);
    },
    fetchAttachment: (channelId: string, attachmentId: string) => queue(channelId, 'fetch_attachment', { attachmentId }),
  };
}
export type MailboxActions = ReturnType<typeof useMailboxActions>;

// Signatures, contacts and lists ------------------------------------------------------------------

export function usePersonalSignatures(channelId: string | null) {
  const { userId } = useWebmailScope();
  return useQuery({
    queryKey: ['email-signatures', channelId, userId],
    queryFn: () => readSignatures(channelId!, userId!),
    enabled: !!channelId && !!userId,
    retry: (count, error) => !isMissingMigration(error) && count < 2,
  });
}

export function useSaveSignatures(channelId: string) {
  const { userId } = useWebmailScope();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (items: readonly SignatureDraft[]) => saveSignatures(channelId, items),
    onSuccess: saved => client.setQueryData(['email-signatures', channelId, userId], saved),
  });
}

export function useMailContacts(enabled = true) {
  const { userId, organizationId } = useWebmailScope();
  return useQuery({
    queryKey: ['email-contacts', organizationId, userId],
    queryFn: () => readContacts(organizationId!, userId!),
    enabled: enabled && !!organizationId && !!userId,
    staleTime: 5 * 60_000,
    retry: (count, error) => !isMissingMigration(error) && count < 2,
  });
}

export function useContactLists(enabled = true) {
  const { userId, organizationId } = useWebmailScope();
  return useQuery({
    queryKey: ['email-contact-lists', organizationId, userId],
    queryFn: () => readContactLists(organizationId!, userId!),
    enabled: enabled && !!organizationId && !!userId,
    retry: (count, error) => !isMissingMigration(error) && count < 2,
  });
}

export function useContactListActions() {
  const { organizationId } = useWebmailScope();
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ['email-contact-lists'] });
  return {
    save: useMutation({ mutationFn: (list: Parameters<typeof saveContactList>[1]) => saveContactList(organizationId!, list), onSuccess: refresh }),
    remove: useMutation({ mutationFn: deleteContactList, onSuccess: refresh }),
  };
}

/** Accounts plus unread per caixa, kept for the nav badge and the sidebar. */
export function useWebmailUnread(accounts: readonly MailAccount[]) {
  const ids = accounts.map(account => account.id);
  const folders = useWebmailFolders(ids);
  const byAccount = new Map<string, number>();
  for (const folder of folders.data ?? []) {
    if (folder.role === 'inbox') byAccount.set(folder.channel_id, (byAccount.get(folder.channel_id) ?? 0) + (folder.unread_count || 0));
  }
  const total = [...byAccount.values()].reduce((sum, value) => sum + value, 0);
  return { folders, byAccount, total };
}
