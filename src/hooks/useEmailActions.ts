import { useCallback, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { EmailMessage, EmailAddress, EmailDraft } from './useEmail';

const db = supabase as unknown as { from: (t: string) => any };

export interface SendAttachment { filename: string; contentType: string; b64: string; }
export interface SendPayload {
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  html?: string;
  text?: string;
  inReplyTo?: string | null;
  references?: string[];
  attachments?: SendAttachment[];
}

export interface DraftPayload {
  id?: string | null;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  bodyHtml: string;
  inReplyTo?: string | null;
  replyMessageId?: string | null;
  attachments?: SendAttachment[];
}

// Queue email actions/sends as commands; the gateway executes them over IMAP/SMTP.
// Optimistic cache updates give an instant feel; Realtime reconciles within ~3s.
export function useEmailActions(channelId: string | null, folderId: string | null) {
  const { organization, user } = useAuth();
  const qc = useQueryClient();
  const orgId = organization?.id;

  /**
   * Mensagens com uma ação destrutiva a caminho (apagar, arquivar, spam, mover).
   *
   * O que se passava sem isto: apagar retirava a mensagem da lista na hora, mas
   * o gateway demora ~2 segundos a executar de facto. Qualquer releitura nesse
   * intervalo — e há várias, o tempo real dispara a cada mudança na caixa —
   * trazia a mensagem de volta, porque na base de dados ela ainda lá estava. A
   * mensagem sumia, voltava, e sumia outra vez.
   *
   * Pior: nesse vaivém dava para carregar outra vez, e a segunda ordem chegava
   * ao servidor de correio quando a mensagem já não existia — "mensagem
   * inexistente".
   *
   * Este conjunto é a memória do que já foi pedido. Sobrevive às releituras: a
   * mensagem fica escondida até desaparecer mesmo, e um segundo clique é
   * ignorado em vez de virar uma segunda ordem.
   */
  const [pendentes, setPendentes] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());

  const marcarPendente = (id: string) =>
    setPendentes((p) => (p.has(id) ? p : new Set(p).add(id)));

  /** Liberta ids: ou porque a mensagem já desapareceu, ou porque a ação falhou. */
  const libertar = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    ids.forEach(id => pendingRef.current.delete(id));
    setPendentes((p) => {
      let mudou = false;
      const n = new Set(p);
      for (const id of ids) if (n.delete(id)) mudou = true;
      return mudou ? n : p;
    });
  }, []);

  const queue = async (type: string, payload: Record<string, unknown>) => {
    if (!orgId || !channelId) throw new Error('Caixa não selecionada');
    const { error } = await db.from('email_commands').insert({
      organization_id: orgId,
      channel_id: channelId,
      type,
      payload,
      // Quem pediu a ação. A coluna já existia e nunca era preenchida: os 135
      // comandos em produção — incluindo 5 ENVIOS de email em nome da empresa —
      // tinham autor nulo. Não havia como saber quem tinha escrito o quê a
      // partir da morada da empresa.
      created_by: user?.id ?? null,
    });
    if (error) throw error;
  };

  const saveDraft = async (draft: DraftPayload): Promise<{ id: string }> => {
    if (!orgId || !channelId) throw new Error('Caixa não selecionada');
    const row = {
      organization_id: orgId,
      channel_id: channelId,
      author_id: user?.id ?? null,
      to_addresses: draft.to,
      cc_addresses: draft.cc || [],
      bcc_addresses: draft.bcc || [],
      subject: draft.subject || null,
      body_html: draft.bodyHtml || null,
      in_reply_to: draft.inReplyTo ?? null,
      reply_message_id: draft.replyMessageId ?? null,
      attachments: (draft.attachments || []) as unknown as Record<string, unknown>[],
      updated_at: new Date().toISOString(),
    };
    if (draft.id) {
      const { data, error } = await db.from('email_drafts').update(row).eq('id', draft.id).select('id').single();
      if (error) throw error;
      return data as { id: string };
    }
    const { data, error } = await db.from('email_drafts').insert(row).select('id').single();
    if (error) throw error;
    return data as { id: string };
  };

  const deleteDraft = async (draftId: string) => {
    const { error } = await db.from('email_drafts').delete().eq('id', draftId);
    if (error) throw error;
    qc.setQueryData(['email-drafts', channelId], (old: EmailDraft[] | undefined) =>
      Array.isArray(old) ? old.filter((d) => d.id !== draftId) : old);
  };

  const patchList = (messageId: string, patch: Partial<EmailMessage>) => {
    qc.setQueryData(['email-messages', folderId], (old: EmailMessage[] | undefined) =>
      Array.isArray(old) ? old.map((m) => (m.id === messageId ? { ...m, ...patch } : m)) : old);
  };
  const patchAll = (patch: Partial<EmailMessage>) => {
    qc.setQueryData(['email-messages', folderId], (old: EmailMessage[] | undefined) =>
      Array.isArray(old) ? old.map((m) => ({ ...m, ...patch })) : old);
  };
  const removeFromList = (messageId: string) => {
    qc.setQueryData(['email-messages', folderId], (old: EmailMessage[] | undefined) =>
      Array.isArray(old) ? old.filter((m) => m.id !== messageId) : old);
  };

  /**
   * Ações que tiram a mensagem da pasta. Todas passam por aqui para terem o
   * mesmo comportamento: um pedido por mensagem, e fica escondida até acabar.
   */
  const destrutiva = (tipo: string, id: string, extra: Record<string, unknown> = {}) => {
    // Segundo clique enquanto o primeiro está a caminho: não é uma segunda
    // ordem, é a mesma pessoa a duvidar que a primeira pegou.
    if (pendingRef.current.has(id)) return Promise.resolve();
    pendingRef.current.add(id);
    marcarPendente(id);
    removeFromList(id);
    return queue(tipo, { messageId: id, ...extra }).catch((e) => {
      // Se nem chegou a ser pedido, a mensagem volta já — esconder algo que
      // ninguém vai apagar seria mentir ao contrário.
      libertar([id]);
      qc.invalidateQueries({ queryKey: ['email-messages', folderId] });
      throw e;
    });
  };

  return {
    pendentes,
    libertar,
    setRead: (id: string, read: boolean) => { patchList(id, { seen: read }); return queue(read ? 'mark_read' : 'mark_unread', { messageId: id }); },
    setFlag: (id: string, on: boolean) => { patchList(id, { flagged: on }); return queue(on ? 'flag' : 'unflag', { messageId: id }); },
    archive: (id: string) => destrutiva('archive', id),
    spam: (id: string) => destrutiva('spam', id),
    trash: (id: string) => destrutiva('delete', id),
    move: (id: string, targetFolderId: string) => destrutiva('move', id, { targetFolderId }),
    markFolderRead: (targetFolderId: string) => { patchAll({ seen: true }); return queue('mark_folder_read', { folderId: targetFolderId }); },
    loadOlder: (targetFolderId: string, batch = 40) => queue('load_older', { folderId: targetFolderId, batch }),
    syncUnread: (targetFolderId: string) => queue('sync_unread', { folderId: targetFolderId }),
    fetchBody: async (messageId: string) => {
      if (!orgId || !channelId) throw new Error('Caixa não selecionada');
      const { error } = await supabase.functions.invoke('email-fetch-body', { body: { message_id: messageId } });
      if (error) {
        const detail = await error.context?.json?.().catch(() => null);
        throw new Error(detail?.error || 'Não foi possível carregar o conteúdo do email.');
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['email-message', messageId] }),
        qc.invalidateQueries({ queryKey: ['email-messages'] }),
        qc.invalidateQueries({ queryKey: ['email-command-failures', channelId] }),
      ]);
    },
    fetchAttachment: (attachmentId: string) => queue('fetch_attachment', { attachmentId }),
    send: (payload: SendPayload) => queue('send', payload as unknown as Record<string, unknown>),
    saveDraft,
    deleteDraft,
  };
}
