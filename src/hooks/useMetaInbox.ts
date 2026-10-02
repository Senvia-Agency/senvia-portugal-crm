import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

// As tabelas meta_* são mais recentes do que os tipos gerados do Supabase, por
// isso o cliente tipado não as conhece. Mesmo padrão já usado noutros hooks do
// projeto (ver useActivationProgress e org_onboarding_state). Os tipos das
// linhas estão declarados abaixo e são o contrato real.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * Conversas de Instagram e Messenger — lidas das NOSSAS tabelas.
 *
 * Estes canais não passam pelo Chatwoot: o webhook da Meta escreve em
 * meta_conversations / meta_messages e é daí que se lê. O email continua no
 * Chatwoot, por isso a Caixa de Entrada tem duas origens.
 */

export interface MetaConversation {
  id: string;
  channel_id: string;
  contact_ref: string;
  contact_name: string | null;
  contact_avatar_url: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
  status: string;
  window_expires_at: string | null;
}

export interface MetaMessage {
  id: string;
  conversation_id: string;
  external_id: string | null;
  direction: 'incoming' | 'outgoing';
  content: string | null;
  /**
   * `url` para o Instagram e o Messenger, que mandam o ficheiro pronto.
   *
   * No WhatsApp NÃO HÁ url: a Meta manda um `media_id` e o ficheiro só se
   * descarrega com o token da conta, por um endereço que expira em minutos. Por
   * isso vem `url: null` e um `media_id` — é o `meta-media` que o resolve.
   */
  attachments: Array<{
    type: string;
    url: string | null;
    media_id?: string | null;
    mime?: string | null;
    /** Document name, when the sender gave one (WhatsApp documents, automation files). */
    filename?: string | null;
    /** Bytes, when known. */
    size?: number | null;
  }>;
  /** Só o WhatsApp dá isto: sent | delivered | read | failed. */
  delivery_status: string | null;
  sent_by: string | null;
  reply_to_external_id: string | null;
  reaction: string | null;
  reaction_by: string | null;
  /** A pessoa retirou a mensagem do lado dela. */
  is_deleted: boolean | null;
  /** Quando a Meta diz que foi enviada — é por aqui que se ordena. */
  sent_at: string | null;
  created_at: string;
}

/**
 * Por ler, por caixa de Meta.
 *
 * Sem isto o contador do menu e o distintivo de cada caixa só contavam o
 * Chatwoot: chegava uma DM de Instagram e nada no CRM o dizia — nem a barra
 * lateral, nem o título do separador. Só se descobria abrindo a caixa.
 */
export function useMetaUnreadTotals() {
  const { organization } = useAuth();

  return useQuery({
    queryKey: ['meta-unread-totals', organization?.id],
    queryFn: async (): Promise<Record<string, number>> => {
      if (!organization?.id) return {};
      const { data, error } = await db
        .from('meta_conversations')
        .select('channel_id, unread_count')
        .eq('organization_id', organization.id)
        .gt('unread_count', 0);
      if (error) throw error;
      const totais: Record<string, number> = {};
      for (const linha of (data ?? []) as Array<{ channel_id: string; unread_count: number }>) {
        totais[linha.channel_id] = (totais[linha.channel_id] ?? 0) + (linha.unread_count ?? 0);
      }
      return totais;
    },
    enabled: !!organization?.id,
    refetchInterval: 30_000,
  });
}

/**
 * Conversas, mais recentes primeiro.
 *
 * Aceita uma caixa ou várias: com várias é a vista "Todas as conversas", que
 * junta o Instagram e o Messenger numa lista só. O email fica de fora porque
 * tem cliente próprio — pastas, rascunhos, anexos; não é uma lista de conversas.
 */
export function useMetaConversations(channelId: string | string[] | null) {
  const { organization } = useAuth();
  const ids = channelId == null ? [] : (Array.isArray(channelId) ? channelId : [channelId]);
  // A chave tem de ser estável: com um array por ordem diferente, o React Query
  // via duas consultas distintas e recarregava a lista sem razão.
  const chave = [...ids].sort().join(',');

  return useQuery({
    queryKey: ['meta-conversations', organization?.id, chave],
    queryFn: async (): Promise<MetaConversation[]> => {
      if (!organization?.id || ids.length === 0) return [];
      const { data, error } = await db
        .from('meta_conversations')
        .select('id, channel_id, contact_ref, contact_name, contact_avatar_url, last_message, last_message_at, unread_count, status, window_expires_at')
        .eq('organization_id', organization.id)
        .in('channel_id', ids)
        .order('last_message_at', { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data || []) as MetaConversation[];
    },
    enabled: !!organization?.id && ids.length > 0,
    // As mensagens chegam por webhook, não por ação do utilizador — sem
    // sondagem a conversa só apareceria ao recarregar a página.
    refetchInterval: 15_000,
  });
}

/**
 * Fotos de contacto que faltam (WhatsApp por QR): pede-as ao servidor, que as
 * vai buscar ao WhatsApp. Cada conversa é pedida uma vez por sessão do browser,
 * tenha ou não foto — quem a tem escondida não deve gerar um pedido a cada
 * atualização da lista. O webhook volta a tentar quando a pessoa escrever.
 */
const avataresPedidos = new Set<string>();

export function useFillContactAvatars(conversations: MetaConversation[]) {
  const queryClient = useQueryClient();
  const semFoto = conversations
    .filter((c) => !c.contact_avatar_url && !avataresPedidos.has(c.id))
    .map((c) => c.id)
    .slice(0, 20);
  const chave = semFoto.join(',');

  useEffect(() => {
    if (!chave) return;
    const ids = chave.split(',');
    ids.forEach((id) => avataresPedidos.add(id));
    // Sem cancelamento: a lista muda (e o efeito limpa) antes da resposta, e
    // recarregar as conversas depois de sair da página não faz mal nenhum.
    supabase.functions.invoke('meta-media', { body: { action: 'avatars', conversation_ids: ids } })
      .then(({ data, error }) => {
        if (error) return;
        if (Object.keys((data as { updated?: Record<string, string> })?.updated ?? {}).length) {
          void queryClient.invalidateQueries({ queryKey: ['meta-conversations'] });
        }
      });
  }, [chave, queryClient]);
}

/** Quantas mensagens se leem de uma vez. */
export const META_PAGINA = 200;

/**
 * Mensagens de uma conversa, por ordem cronológica.
 *
 * Lê-se do FIM para o princípio e inverte-se. Parece um pormenor e não é: o
 * PostgREST corta em 1000 linhas, e por ordem crescente o que ele guardava eram
 * as 1000 MAIS ANTIGAS. Uma conversa com mais do que isso congelava — as
 * mensagens novas ficavam guardadas na base de dados e nunca mais apareciam, sem
 * erro nenhum. O agente via uma conversa parada e o envio parecia não fazer nada.
 */
export function useMetaMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ['meta-messages', conversationId],
    queryFn: async (): Promise<MetaMessage[]> => {
      if (!conversationId) return [];
      const { data, error } = await db
        .from('meta_messages')
        .select('id, conversation_id, external_id, direction, content, attachments, delivery_status, sent_by, reply_to_external_id, reaction, reaction_by, is_deleted, sent_at, created_at')
        .eq('conversation_id', conversationId)
        .order('sent_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(META_PAGINA);
      if (error) throw error;
      return ((data || []) as MetaMessage[]).slice().reverse();
    },
    enabled: !!conversationId,
    refetchInterval: 10_000,
  });
}

/**
 * Um ficheiro recebido pelo WhatsApp, pronto a mostrar.
 *
 * PORQUE É QUE NÃO CHEGA UM `<img src>`
 *
 * O WhatsApp não manda o ficheiro no webhook — manda um id. O endereço real só
 * se obtém com o token da conta, e expira em minutos; e o token não pode chegar
 * ao browser. Por isso o download é feito pela função `meta-media` e o que
 * chega aqui são os bytes, que viram um endereço local.
 *
 * Sem isto, toda a fotografia que um cliente enviasse aparecia na conversa como
 * a palavra "[image]".
 *
 * O endereço local é largado ao sair: sem `revokeObjectURL`, cada conversa
 * aberta deixava os ficheiros presos à memória do separador até o fechar.
 */
export function useMetaMedia(messageId: string, mediaId: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!mediaId) return;
    let vivo = true;
    let criado: string | null = null;

    (async () => {
      try {
        // `functions.invoke` NÃO SERVE AQUI.
        //
        // Ele olha para o Content-Type da resposta e, para tudo o que não seja
        // JSON ou `application/octet-stream`, faz `res.text()` — o que estraga
        // silenciosamente qualquer imagem, áudio ou PDF. Com `fetch` direto o
        // blob chega intacto E com o tipo certo, que é o que faz o `<img>`
        // saber o que está a mostrar.
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Sessão expirada. Recarrega a página.');

        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-media`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ message_id: messageId, media_id: mediaId }),
          },
        );

        if (!res.ok) {
          const corpo = await res.json().catch(() => ({}));
          throw new Error(corpo?.error || `Não foi possível abrir o ficheiro (${res.status})`);
        }

        const blob = await res.blob();
        if (!vivo) return;
        criado = URL.createObjectURL(blob);
        setUrl(criado);
      } catch (e) {
        if (vivo) setErro((e as Error).message || 'Não foi possível abrir o ficheiro.');
      }
    })();

    return () => {
      vivo = false;
      if (criado) URL.revokeObjectURL(criado);
    };
  }, [messageId, mediaId]);

  return { url, erro, aCarregar: !url && !erro && !!mediaId };
}

/** Um modelo aprovado pela Meta, tal como ela o devolve. */
export interface WhatsAppTemplate {
  id: string;
  meta_id: string;
  name: string;
  language: string;
  category: string | null;
  status: string;
  components: Array<{
    type: string;
    format?: string;
    text?: string;
    buttons?: Array<{ text?: string }>;
  }>;
}

/**
 * Os modelos aprovados de uma caixa de WhatsApp.
 *
 * São a ÚNICA forma de escrever a alguém passadas as 24 horas sobre a última
 * mensagem dela. Até aqui a tabela existia e nunca era preenchida por nada, e o
 * compositor limitava-se a dizer que não dava — a conversa era um beco.
 */
export function useWhatsAppTemplates(channelId: string | null, ativo = true) {
  return useQuery({
    queryKey: ['whatsapp-templates', channelId],
    queryFn: async (): Promise<WhatsAppTemplate[]> => {
      if (!channelId) return [];
      const { data, error } = await db
        .from('whatsapp_templates')
        .select('id, meta_id, name, language, category, status, components')
        .eq('channel_id', channelId)
        .eq('status', 'APPROVED')
        .order('name', { ascending: true });
      if (error) throw error;
      return (data || []) as WhatsAppTemplate[];
    },
    enabled: !!channelId && ativo,
  });
}

/** Vai buscar à Meta a lista de modelos desta caixa e guarda-a. */
export function useSyncWhatsAppTemplates() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();

  return useMutation({
    mutationFn: async (channelId: string) => {
      if (!organization?.id) throw new Error('Organização não encontrada');
      const { data, error } = await supabase.functions.invoke('meta-connect', {
        body: {
          action: 'whatsapp_templates_sync',
          organization_id: organization.id,
          channel_id: channelId,
        },
      });
      if (error) throw new Error(await detalheDoErro(error));
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data as { total: number; aprovados: number };
    },
    onSuccess: (_d, channelId) => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-templates', channelId] });
    },
  });
}

/** Envia um modelo — a mensagem que a Meta aceita fora da janela das 24h. */
export function useSendWhatsAppTemplate() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();

  return useMutation({
    mutationFn: async (vars: {
      conversationId: string;
      name: string;
      language: string;
      variables: { header?: string[]; body?: string[] };
      /** O corpo já com as variáveis preenchidas — é o que fica na conversa. */
      preview: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('meta-send', {
        body: {
          conversation_id: vars.conversationId,
          action: 'send_template',
          template: {
            name: vars.name,
            language: vars.language,
            variables: vars.variables,
            preview: vars.preview,
          },
        },
      });
      if (error) throw new Error(await detalheDoErro(error));
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['meta-messages', vars.conversationId] });
      queryClient.invalidateQueries({ queryKey: ['meta-conversations', organization?.id] });
    },
  });
}

/**
 * O motivo real por trás de um erro do `invoke`.
 *
 * O cliente da Supabase deita fora o corpo da resposta e entrega sempre a mesma
 * frase genérica — que é onde estava, por exemplo, "o modelo não está
 * aprovado". Sem isto, o utilizador lê "non-2xx status code".
 */
async function detalheDoErro(error: unknown): Promise<string> {
  try {
    const body = await (error as { context?: Response }).context?.json();
    if (body?.error) return String(body.error);
  } catch { /* corpo não era JSON */ }
  return (error as Error).message;
}

/** Responder. O envio é feito na edge function: o token da Página nunca vem ao browser. */
export function useSendMetaMessage() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();

  return useMutation({
    mutationFn: async ({ conversationId, text, replyToMid }: { conversationId: string; text: string; replyToMid?: string | null }) => {
      const { data, error } = await supabase.functions.invoke('meta-send', {
        body: { conversation_id: conversationId, text, reply_to_mid: replyToMid ?? undefined },
      });
      if (error) {
        // O invoke() deita fora o corpo do erro, que é onde está o motivo — por
        // exemplo a janela de 24h ter expirado, que o utilizador precisa de ler.
        let detail = '';
        try {
          const body = await (error as { context?: Response }).context?.json();
          detail = body?.error ?? '';
        } catch { /* corpo não era JSON */ }
        throw new Error(detail || (error as Error).message);
      }
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['meta-messages', vars.conversationId] });
      queryClient.invalidateQueries({ queryKey: ['meta-conversations', organization?.id] });
    },
  });
}

/**
 * Marca como lida.
 *
 * Desconta o que foi visto em vez de escrever zero: uma mensagem que chegasse
 * entre a leitura e a escrita tinha o incremento deitado fora, e a conversa
 * ficava a dizer "lida" com uma mensagem por ler lá dentro.
 */
export function useMarkMetaRead() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();

  return useMutation({
    mutationFn: async ({ conversationId, seen }: { conversationId: string; seen: number }) => {
      const { error } = await db.rpc('mark_meta_read', {
        _conversation_id: conversationId,
        _seen: seen,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meta-conversations', organization?.id] });
    },
  });
}

/**
 * Ações que não são mensagens: reagir, tirar a reação, "a escrever…" e "visto".
 *
 * Todas passam pela mesma edge function — é lá que está o token da Página, e é
 * lá que se sabe se a janela de 24h ainda está aberta.
 */
export function useMetaAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: {
      conversationId: string;
      action: 'react' | 'unreact' | 'typing_on' | 'typing_off' | 'mark_seen';
      messageExternalId?: string | null;
      reaction?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('meta-send', {
        body: {
          conversation_id: vars.conversationId,
          action: vars.action,
          message_external_id: vars.messageExternalId,
          reaction: vars.reaction,
        },
      });
      if (error) {
        let detail = '';
        try {
          const body = await (error as { context?: Response }).context?.json();
          detail = body?.error ?? '';
        } catch { /* corpo não era JSON */ }
        throw new Error(detail || (error as Error).message);
      }
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data;
    },
    onSuccess: (_d, vars) => {
      // "A escrever" e "visto" não mudam nada do nosso lado — recarregar seria
      // trabalho a troco de nada, e a cada tecla premida.
      if (vars.action === 'react' || vars.action === 'unreact') {
        queryClient.invalidateQueries({ queryKey: ['meta-messages', vars.conversationId] });
      }
    },
  });
}

/**
 * Envia um ficheiro. Sobe primeiro para o nosso armazenamento e manda o
 * endereço à Meta — ela vai buscá-lo, por isso tem de ser público.
 *
 * Limites da Meta, verificados antes de subir para não gastar a subida em vão:
 * imagens 8 MB (PNG/JPEG), áudio/vídeo/PDF 25 MB.
 */
export function useSendMetaAttachment() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();

  return useMutation({
    mutationFn: async ({ conversationId, file }: { conversationId: string; file: File }) => {
      const ehImagem = file.type.startsWith('image/');
      const tipo = ehImagem ? 'image'
        : file.type.startsWith('video/') ? 'video'
        : file.type.startsWith('audio/') ? 'audio'
        : 'file';

      const limite = ehImagem ? 8 * 1024 * 1024 : 25 * 1024 * 1024;
      if (file.size > limite) {
        throw new Error(
          `O Instagram aceita no máximo ${ehImagem ? '8' : '25'} MB para este tipo de ficheiro.`,
        );
      }

      // Sem organização não há caminho válido — e o erro que vinha da política
      // do balde não dizia isso a ninguém.
      if (!organization?.id) throw new Error('Organização não encontrada. Recarrega a página.');

      // A ORGANIZAÇÃO TEM DE SER A PRIMEIRA PASTA. A política do balde faz
      // `is_org_member(auth.uid(), (storage.foldername(name))[1]::uuid)`, ou
      // seja converte o primeiro segmento para UUID. Começar por `meta/` fazia
      // o Postgres rebentar com «invalid input syntax for type uuid: "meta"» —
      // uma mensagem que não tem nada que ver com o que o utilizador fez.
      const caminho = `${organization.id}/meta/${conversationId}/${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`;
      const { error: upErr } = await supabase.storage
        .from('automation-media')
        .upload(caminho, file, { contentType: file.type, upsert: false });
      if (upErr) throw new Error(`Falha ao carregar o ficheiro: ${upErr.message}`);

      const { data: pub } = supabase.storage.from('automation-media').getPublicUrl(caminho);

      // Se o envio falhar, o ficheiro sai. O caso comum é a janela de 24h ter
      // fechado: o agente escolhia um anexo, levava com o aviso, e o ficheiro
      // ficava público para sempre num contentor que ninguém limpa.
      const apagarFicheiro = async () => {
        await supabase.storage.from('automation-media').remove([caminho])
          .then(() => {}, () => { /* melhor esforço */ });
      };

      const { data, error } = await supabase.functions.invoke('meta-send', {
        body: {
          conversation_id: conversationId,
          attachment_url: pub.publicUrl,
          attachment_type: tipo,
        },
      });
      if (error) {
        let detail = '';
        try {
          const body = await (error as { context?: Response }).context?.json();
          detail = body?.error ?? '';
        } catch { /* corpo não era JSON */ }
        await apagarFicheiro();
        throw new Error(detail || (error as Error).message);
      }
      if ((data as { error?: string })?.error) {
        await apagarFicheiro();
        throw new Error((data as { error: string }).error);
      }
      return data;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['meta-messages', vars.conversationId] });
      queryClient.invalidateQueries({ queryKey: ['meta-conversations', organization?.id] });
    },
  });
}
