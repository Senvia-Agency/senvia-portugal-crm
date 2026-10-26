import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useTeamMembers } from '@/hooks/useTeam';
import { bootstrapChat, fetchMembers, fetchMessages, fetchReactions, isMissingMigration, listConversations, markRead, signedUrl } from './chat-api';

export const chatKeys = {
  all: ['workplace-chat'] as const,
  list: (organizationId?: string) => ['workplace-chat', organizationId, 'list'] as const,
  messages: (conversationId: string | null) => ['workplace-chat', 'messages', conversationId] as const,
  members: (conversationId: string | null) => ['workplace-chat', 'members', conversationId] as const,
  reactions: (conversationId: string | null) => ['workplace-chat', 'reactions', conversationId] as const,
};

const retryUnlessMissing = (count: number, error: unknown) => !isMissingMigration(error) && count < 2;

/** The caller's conversations; joins the organization's "Geral" channel first. Live via Realtime. */
export function useChatConversations(organizationId: string | undefined, userId: string | undefined, enabled = true) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: chatKeys.list(organizationId),
    enabled: enabled && !!organizationId,
    queryFn: async () => {
      await bootstrapChat(organizationId!);
      return listConversations(organizationId!);
    },
    retry: retryUnlessMissing,
    staleTime: 15000,
  });
  const failed = query.isError;
  // The page and the menu badge both list conversations: each needs its own channel name.
  const instance = useRef(crypto.randomUUID().slice(0, 8)).current;
  useEffect(() => {
    if (!organizationId || !userId || !enabled || failed) return;
    const refresh = () => { void client.invalidateQueries({ queryKey: chatKeys.list(organizationId) }); };
    const channel = supabase.channel(`workplace-chat-list:${organizationId}:${userId}:${instance}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workplace_chat_messages', filter: `organization_id=eq.${organizationId}` }, (payload) => {
        refresh();
        const row = (payload.new && 'conversation_id' in payload.new ? payload.new : payload.old) as { conversation_id?: string };
        if (row?.conversation_id) void client.invalidateQueries({ queryKey: chatKeys.messages(row.conversation_id) });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workplace_chat_members', filter: `user_id=eq.${userId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workplace_chat_member_settings', filter: `user_id=eq.${userId}` }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'workplace_chat_conversations', filter: `organization_id=eq.${organizationId}` }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [client, organizationId, userId, enabled, failed, instance]);
  return query;
}

const PAGE = 60;

/** One open conversation: messages (newest page first), members, reactions, typing and read state. */
export function useChatThread(conversationId: string | null, organizationId: string | undefined, userId: string | undefined) {
  const client = useQueryClient();
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { setLimit(PAGE); }, [conversationId]);
  const messages = useQuery({
    queryKey: [...chatKeys.messages(conversationId), limit],
    enabled: !!conversationId,
    queryFn: () => fetchMessages(conversationId!, limit),
    placeholderData: previous => previous,
    retry: retryUnlessMissing,
  });
  const members = useQuery({ queryKey: chatKeys.members(conversationId), enabled: !!conversationId, queryFn: () => fetchMembers(conversationId!), retry: retryUnlessMissing });
  const reactions = useQuery({ queryKey: chatKeys.reactions(conversationId), enabled: !!conversationId, queryFn: () => fetchReactions(conversationId!), retry: retryUnlessMissing });

  // Typing and reaction nudges travel on the conversation's private broadcast channel.
  const [typing, setTyping] = useState<Record<string, number>>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastTypingSent = useRef(0);
  useEffect(() => {
    setTyping({});
    if (!conversationId || !userId) return;
    const reload = (key: readonly unknown[]) => () => { void client.invalidateQueries({ queryKey: key }); };
    const channel = supabase.channel(`workplace-chat-${conversationId}`, { config: { private: true, broadcast: { self: false } } })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const id = (payload as { userId?: unknown } | undefined)?.userId;
        if (typeof id === 'string' && id !== userId) setTyping(current => ({ ...current, [id]: Date.now() }));
      })
      .on('broadcast', { event: 'reactions' }, reload(chatKeys.reactions(conversationId)))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'workplace_chat_reactions', filter: `conversation_id=eq.${conversationId}` }, reload(chatKeys.reactions(conversationId)))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workplace_chat_members', filter: `conversation_id=eq.${conversationId}` }, reload(chatKeys.members(conversationId)))
      .subscribe();
    channelRef.current = channel;
    const sweep = window.setInterval(() => {
      setTyping(current => {
        const fresh = Object.fromEntries(Object.entries(current).filter(([, at]) => Date.now() - at < 4000));
        return Object.keys(fresh).length === Object.keys(current).length ? current : fresh;
      });
    }, 1500);
    return () => { window.clearInterval(sweep); channelRef.current = null; void supabase.removeChannel(channel); };
  }, [client, conversationId, userId]);

  const notifyTyping = useCallback(() => {
    if (Date.now() - lastTypingSent.current < 2500) return;
    lastTypingSent.current = Date.now();
    void channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { userId } });
  }, [userId]);
  const notifyReactions = useCallback(() => {
    void channelRef.current?.send({ type: 'broadcast', event: 'reactions', payload: {} });
  }, []);

  // Reading the conversation clears its unread count.
  const newest = messages.data?.messages.at(-1)?.id;
  useEffect(() => {
    if (!conversationId || !newest || document.visibilityState !== 'visible') return;
    const timer = window.setTimeout(() => {
      void markRead(conversationId).then(() => client.invalidateQueries({ queryKey: chatKeys.list(organizationId) })).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [client, conversationId, newest, organizationId]);

  return {
    messages, members, reactions, notifyTyping, notifyReactions,
    typingUserIds: Object.keys(typing),
    loadOlder: () => setLimit(current => current + PAGE),
    hasOlder: messages.data?.hasMore ?? false,
  };
}

/** Names and photos of the organization's people, with a stable fallback for former members. */
export function useChatPeople(userId: string | undefined) {
  const { data: members = [] } = useTeamMembers();
  return useMemo(() => {
    const byId = new Map(members.map(member => [member.user_id, member]));
    const nameFor = (id: string | null | undefined) => !id ? 'Antigo membro' : byId.get(id)?.full_name || 'Antigo membro';
    return {
      members: members.filter(member => !member.is_banned),
      nameFor,
      firstName: (id: string | null | undefined) => id === userId ? 'Eu' : nameFor(id).split(' ')[0],
      avatarFor: (id: string | null | undefined) => (id ? byId.get(id)?.avatar_url : null) ?? null,
    };
  }, [members, userId]);
}

/** Signed URL for a private chat file, renewed before it expires. */
export function useChatFileUrl(path: string | null | undefined) {
  return useQuery({ queryKey: ['workplace-chat', 'file', path], enabled: !!path, queryFn: () => signedUrl(path!), staleTime: 50 * 60 * 1000 });
}

/** Records a voice note with the browser's microphone. */
export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [recording]);
  const release = () => { recorder.current?.stream.getTracks().forEach(track => track.stop()); recorder.current = null; setRecording(false); setSeconds(0); };
  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(candidate => MediaRecorder.isTypeSupported(candidate));
    const next = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks.current = [];
    next.ondataavailable = event => { if (event.data.size) chunks.current.push(event.data); };
    next.start(250);
    recorder.current = next;
    startedAt.current = Date.now();
    setRecording(true);
  };
  const stop = () => new Promise<{ file: File; durationSec: number } | null>(resolve => {
    const current = recorder.current;
    if (!current) return resolve(null);
    const durationSec = Math.round((Date.now() - startedAt.current) / 100) / 10;
    current.onstop = () => {
      const mime = (current.mimeType || 'audio/webm').split(';')[0];
      const extension = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
      const file = new File(chunks.current, `nota-de-voz-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${extension}`, { type: mime });
      release();
      resolve(durationSec >= 1 ? { file, durationSec } : null);
    };
    current.stop();
  });
  const cancel = () => { if (recorder.current) { recorder.current.onstop = null; recorder.current.stop(); } release(); };
  useEffect(() => () => { recorder.current?.stream.getTracks().forEach(track => track.stop()); }, []);
  return { recording, seconds, start, stop, cancel };
}
