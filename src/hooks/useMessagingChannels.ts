import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { isChannelEnabled } from '@/lib/constants';

export type ChannelStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface MessagingChannel {
  id: string;
  organization_id: string;
  channel_type: string;
  provider: string;
  label: string | null;
  evolution_instance: string | null;
  chatwoot_inbox_id: number | null;
  status: ChannelStatus;
  phone_number: string | null;
  // Collaborators who attend this caixa (empty = everyone). Drives inbox
  // visibility, auto-assignment and notifications.
  assigned_user_ids: string[];
  rotate_enabled: boolean;
  color: string | null;
  metadata: Record<string, unknown> | null;
  /**
   * Caixa desligada mas CONSERVADA.
   *
   * Substitui o que antes era um `delete` na linha — e como as conversas têm
   * `ON DELETE CASCADE` para cá, esse delete levava atrás todo o histórico de
   * mensagens do canal. Arquivada, a caixa não recebe nem envia, mas continua
   * na Caixa de Entrada e as conversas continuam legíveis. Tirar o acesso ao
   * que um cliente escreveu conta como apagá-lo.
   */
  archived_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// O WhatsApp por QR code (Evolution) voltou a 2026-09-30, com as funções
// whatsapp-connect / whatsapp-status / whatsapp-disconnect. Desta vez as
// mensagens vão para a Caixa de Entrada do CRM (as mesmas tabelas do Instagram
// e do Messenger), e o Chatwoot fica só como espelho. O OAuth do Instagram, a
// reparação de ligações e a limpeza de órfãos continuam fora.

/**
 * Caixa de WhatsApp ligada por QR code nesta versão da integração.
 *
 * A marca `native_inbox` é o que a separa das caixas da primeira integração
 * do Evolution, que continuam na base de dados a apontar para instâncias que
 * ninguém lê — essas ficam escondidas.
 */
export function isNativeEvolution(ch: Pick<MessagingChannel, 'provider' | 'metadata'>): boolean {
  return ch.provider === 'evolution'
    && (ch.metadata as { native_inbox?: unknown } | null)?.native_inbox === true;
}

/** As conversas desta caixa vivem nas tabelas do CRM (meta_conversations)? */
export function usesInboxTables(ch: Pick<MessagingChannel, 'provider' | 'metadata'>): boolean {
  return ch.provider === 'meta' || isNativeEvolution(ch);
}

/**
 * As caixas da organização — só as dos canais que o produto tem abertos.
 *
 * A filtragem é AQUI, e não em cada sítio que usa isto. Uma linha de um canal
 * fechado continua na base de dados (não se apaga nada), mas para o CRM é como
 * se não existisse: o que está desligado no produto não conta, não aparece e
 * não notifica.
 *
 * Antes cada consumidor filtrava por sua conta, e os que se esqueciam deixavam
 * o canal fechado aparecer à mesma — o contador dizia "4 ligadas" em cima de
 * três caixas, o painel mostrava alertas de WhatsApp, e as conversas por ler do
 * WhatsApp somavam no distintivo do menu. Uma sessão viva no Evolution é
 * problema do Evolution; não tem que se ver do lado de cá.
 */
export function useMessagingChannels() {
  const { organization } = useAuth();

  return useQuery({
    queryKey: ['messaging-channels', organization?.id],
    queryFn: async (): Promise<MessagingChannel[]> => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from('messaging_channels')
        // Colunas explícitas, e `metadata_public` em vez de `metadata`.
        //
        // O `metadata` cru tem as passwords de IMAP/SMTP e o token da Página; um
        // `select('*')` descarregava-os para o browser de qualquer membro da
        // organização. A coluna pública é o mesmo sem os segredos, e o Postgres
        // já recusa a crua a quem não é o servidor — mesmo que alguém volte a
        // escrever `*` aqui, não passa.
        .select(
          'id, organization_id, channel_type, provider, label, evolution_instance,'
          + ' chatwoot_inbox_id, status, phone_number, assigned_user_ids, rotate_enabled,'
          + ' color, archived_at, created_at, updated_at, metadata_public',
        )
        .eq('organization_id', organization.id)
        // Stable order: without it Postgres returns rows in physical/heap order,
        // which changes whenever a row is UPDATEd — making the cards jump around
        // every time a caixa is edited. created_at + id is deterministic.
        .order('created_at', { ascending: true, nullsFirst: true })
        .order('id', { ascending: true });
      if (error) throw error;
      return ((data || []) as unknown as Array<Record<string, unknown>>)
        .map(({ metadata_public, ...resto }) => ({
          ...resto,
          metadata: metadata_public ?? null,
        }) as MessagingChannel)
        .filter((c) => isChannelEnabled(c.channel_type))
        // As 12 caixas antigas do Evolution continuam na base de dados. Sem
        // isto reapareciam todas ao abrir o canal — presas em "connecting", a
        // contar para o total e a ressuscitar a confusão que se arrumou. As
        // ligadas por QR code agora têm a marca `native_inbox` e passam.
        .filter((c) => !(c.channel_type === 'whatsapp' && c.provider !== 'meta' && !isNativeEvolution(c)));
    },
    enabled: !!organization?.id,
  });
}

interface WhatsappConnectResponse {
  success?: boolean;
  channel_id?: string;
  qr?: string | null;
  pairing_code?: string | null;
  already_connected?: boolean;
  error?: string;
}

interface WhatsappStatusResponse {
  status: ChannelStatus;
  phone_number: string | null;
  qr?: string | null;
}

/** O erro de uma edge function, com a frase que ela devolveu no corpo. */
async function invokeError(error: unknown): Promise<Error> {
  let detalhe = '';
  try {
    const b = await (error as { context?: Response }).context?.json();
    detalhe = b?.error ?? '';
  } catch { /* corpo não era JSON */ }
  return new Error(detalhe || (error as Error).message);
}

/**
 * Pede o QR code de uma caixa de WhatsApp. Sem `channelId` cria uma caixa
 * nova; com ele, volta a ligar essa. Idempotente — a janela do QR chama isto
 * ao abrir e sempre que o código está prestes a expirar.
 */
export function useWhatsappConnect() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars?: { channelId?: string; label?: string }): Promise<WhatsappConnectResponse> => {
      if (!organization?.id) throw new Error('Organização não encontrada');
      const { data, error } = await supabase.functions.invoke('whatsapp-connect', {
        body: { organization_id: organization.id, channel_id: vars?.channelId, label: vars?.label },
      });
      if (error) throw await invokeError(error);
      if ((data as WhatsappConnectResponse)?.error) throw new Error((data as WhatsappConnectResponse).error);
      return data as WhatsappConnectResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messaging-channels', organization?.id] });
    },
  });
}

/** Estado da ligação, consultado de 4 em 4 segundos enquanto a janela do QR está aberta. */
export function useWhatsappStatus(enabled: boolean, channelId?: string) {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  const prevStatusRef = useRef<ChannelStatus | null>(null);

  const query = useQuery({
    queryKey: ['whatsapp-status', organization?.id, channelId ?? null],
    queryFn: async (): Promise<WhatsappStatusResponse> => {
      if (!organization?.id || !channelId) return { status: 'disconnected', phone_number: null };
      const { data, error } = await supabase.functions.invoke('whatsapp-status', {
        body: { organization_id: organization.id, channel_id: channelId },
      });
      if (error) throw await invokeError(error);
      return data as WhatsappStatusResponse;
    },
    enabled: enabled && !!organization?.id && !!channelId,
    refetchInterval: enabled ? 4000 : false,
  });

  // A lista de caixas só se refresca quando o estado MUDA — invalidá-la a cada
  // consulta de 4 segundos fazia os cartões piscar.
  const status = query.data?.status;
  useEffect(() => {
    if (!status) return;
    if (prevStatusRef.current !== null && prevStatusRef.current !== status) {
      queryClient.invalidateQueries({ queryKey: ['messaging-channels', organization?.id] });
    }
    prevStatusRef.current = status;
  }, [status, organization?.id, queryClient]);

  return query;
}

/** Termina a sessão de WhatsApp de uma caixa sem a arquivar: fica pronta a ler outro QR. */
export function useLogoutChannel() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (channelId: string) => {
      if (!organization?.id) throw new Error('Organização não encontrada');
      const { data, error } = await supabase.functions.invoke('whatsapp-disconnect', {
        body: { organization_id: organization.id, channel_id: channelId, logout: true },
      });
      if (error) throw await invokeError(error);
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    },
    onSuccess: () => {
      toast.success('WhatsApp desligado', { description: 'Para voltar a ligar, lê um QR code novo nesta caixa.' });
      queryClient.invalidateQueries({ queryKey: ['messaging-channels', organization?.id] });
    },
    onError: (e) => {
      toast.error('Não foi possível desligar', { description: (e as Error).message });
    },
  });
}

// Update which collaborators attend a caixa (+ optional round-robin). Admin-gated
// by RLS. Empty list = everyone can see it.
export function useUpdateChannelAssignment() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { channelId: string; label?: string; assigned_user_ids?: string[]; rotate_enabled?: boolean; color?: string | null }) => {
      if (!organization?.id) throw new Error('Organização não encontrada');
      const patch: Record<string, unknown> = {};
      if (vars.label !== undefined) patch.label = vars.label;
      if (vars.assigned_user_ids !== undefined) patch.assigned_user_ids = vars.assigned_user_ids;
      if (vars.rotate_enabled !== undefined) patch.rotate_enabled = vars.rotate_enabled;
      if (vars.color !== undefined) patch.color = vars.color;
      // O `.select()` no fim é o que torna isto verificável. Sem ele, um UPDATE
      // que o RLS não deixe passar devolve SUCESSO com zero linhas alteradas: o
      // interruptor voltava atrás sozinho, a cor não pegava, e não havia erro
      // nenhum a dizer porquê. Quem só é colaborador não pode mexer nas caixas
      // (a política exige o papel de administrador) e ficava a olhar.
      const { data, error } = await supabase
        .from('messaging_channels')
        .update(patch)
        .eq('id', vars.channelId)
        .eq('organization_id', organization.id)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error(
          'Não foi possível guardar: só os administradores podem alterar as caixas.',
        );
      }
    },
    onError: (e) => {
      toast.error('Alteração não guardada', { description: (e as Error).message });
    },
    onSuccess: () => {
      // Cada campo desta janela guarda-se sozinho, mal se mexe nele. Sem uma
      // confirmação, mexer e não ver nada acontecer é indistinguível de estar
      // partido — e era exatamente essa a queixa.
      toast.success('Alteração guardada');
      queryClient.invalidateQueries({ queryKey: ['messaging-channels', organization?.id] });
      queryClient.invalidateQueries({ queryKey: ['email-channels', organization?.id] });
    },
  });
}

// One-time silent repair: re-wires Evolution → Chatwoot for all connected channels.
// Runs automatically on first Caixas page load after the wiring-bug deploy.
// Uses localStorage flag so it only fires once per browser.

// Toggle group messages for a WhatsApp channel. Updates metadata in DB and
// re-applies the setting to the Evolution Chatwoot integration immediately.
export function useUpdateChannelGroups() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { channelId: string; groupsEnabled: boolean }) => {
      if (!organization?.id) throw new Error('Organização não encontrada');
      const { data, error } = await supabase.functions.invoke('chatwoot-inbox', {
        body: { organization_id: organization.id, action: 'update_groups', channel_id: vars.channelId, groups_enabled: vars.groupsEnabled },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messaging-channels', organization?.id] });
    },
  });
}

// Log out a channel's WhatsApp session WITHOUT deleting it — the instance stays so

/**
 * Liga uma conta de Instagram ou uma Página do Messenger via Facebook Login for
 * Business (edge function `meta-connect`).
 *
 * Abre o diálogo da Meta num popup e espera pelo postMessage do callback. O
 * popup é preciso porque a Meta recusa ser embebida em iframe, e sair da página
 * perderia o estado do CRM.
 */
/** Um número de WhatsApp entre os quais escolher. */
export interface OpcaoNumero {
  phone_number_id: string;
  waba_id: string;
  waba_name: string | null;
  display_phone_number: string | null;
  verified_name: string | null;
  quality_rating: string | null;
}

/**
 * Uma Página do Facebook entre as quais escolher.
 *
 * O Instagram e o Messenger ligavam a PRIMEIRA Página que a Meta devolvesse, e
 * quem tivesse três ficava com a errada e tinha de repetir a ligação até
 * calhar. É o mesmo erro que já tinha acontecido no WhatsApp — ali resolveu-se
 * a perguntar, aqui tinha ficado por resolver.
 */
export interface OpcaoPagina {
  page_id: string;
  page_name: string | null;
  ig_username: string | null;
}

/** Uma conta entre as quais escolher, seja qual for o canal. */
export type OpcaoConta = OpcaoNumero | OpcaoPagina;

/** Distingue as duas sem depender do canal declarado. */
export function ehPagina(o: OpcaoConta): o is OpcaoPagina {
  return 'page_id' in o;
}

/**
 * O que a ligação devolve.
 *
 * Pode acabar de duas maneiras: ligada, ou à espera de escolha. A segunda existe
 * porque uma autorização pode abranger VÁRIAS contas — e escolher a primeira
 * sozinho ligou a conta de um cliente à caixa da agência.
 */
export type MetaConnectResult =
  | { channel_type: string; label: string; ig_username?: string | null; needs_choice?: false }
  | { needs_choice: true; connect: string; pending_id: string; options: OpcaoConta[] };

/** Conclui uma ligação depois de escolhida a conta (número ou Página). */
export function useFinishMetaChoice() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      { pendingId, phoneNumberId, pageId }:
        { pendingId: string; phoneNumberId?: string; pageId?: string },
    ) => {
      if (!organization?.id) throw new Error('Organização não encontrada');
      const { data, error } = await supabase.functions.invoke('meta-connect', {
        body: {
          action: 'finish_choice',
          organization_id: organization.id,
          pending_id: pendingId,
          // Só um deles vai preenchido; o servidor sabe qual esperar pelo canal
          // que guardou com a escolha.
          phone_number_id: phoneNumberId,
          page_id: pageId,
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
      return data as { channel_type: string; label: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messaging-channels', organization?.id] });
    },
  });
}

export function useConnectMetaChannel() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ connect, label }: { connect: 'instagram' | 'messenger' | 'whatsapp'; label?: string }) => {
      if (!organization?.id) throw new Error('Organização não encontrada');

      const { data, error } = await supabase.functions.invoke('meta-connect', {
        body: {
          action: 'oauth_url', organization_id: organization.id, connect, label,
          // Para onde o popup volta no fim. Vai assinado dentro do `state`, e é
          // o que permite fechar a janela sozinha: a edge function não consegue
          // servir HTML que o browser corra (a Supabase impõe text/plain).
          origin: window.location.origin,
        },
      });
      if (error) {
        // O invoke() só entrega "Edge Function returned a non-2xx status code" e
        // deita fora o corpo — que é onde está o motivo real. Vale a pena ir
        // buscá-lo: a diferença entre "500" e "falta o FACEBOOK_LOGIN_CONFIG_ID"
        // é a diferença entre adivinhar e resolver.
        let detail = '';
        try {
          const body = await (error as { context?: Response }).context?.json();
          detail = body?.error ?? '';
        } catch { /* corpo não era JSON — fica a mensagem genérica */ }
        throw new Error(detail || (error as Error).message);
      }
      const url = (data as { url?: string; error?: string })?.url;
      if (!url) throw new Error((data as { error?: string })?.error || 'Não foi possível iniciar o login');

      const popup = window.open(url, 'meta-oauth', 'width=600,height=760');
      if (!popup) throw new Error('O browser bloqueou a janela. Permite popups para este site.');

      const before = new Date().toISOString();

      // A caixa é criada pela edge function no fim do assistente. É a única
      // fonte de verdade que não depende de vermos a janela.
      const wanted = connect === 'messenger' ? 'facebook'
        : connect === 'whatsapp' ? 'whatsapp' : 'instagram';
      const procurarCaixa = async () => {
        const { data: criada } = await supabase
          .from('messaging_channels')
          .select('channel_type, label, metadata_public')
          .eq('organization_id', organization.id)
          .eq('channel_type', wanted)
          // `updated_at` e não `created_at`: voltar a ligar um número que já
          // existia (ou reviver uma caixa arquivada) ATUALIZA a linha em vez de
          // criar outra — e por `created_at` a busca não encontrava nada, o que
          // dava "a ligação não chegou ao fim" depois de ter corrido bem.
          .gte('updated_at', before)
          .is('archived_at', null)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!criada) return null;
        return {
          channel_type: criada.channel_type,
          label: criada.label ?? '',
          ig_username: (criada.metadata_public as { ig_username?: string } | null)?.ig_username ?? null,
        } as MetaConnectResult;
      };

      /**
       * A outra maneira de acabar: a autorização abrange várias contas e ficou
       * uma escolha à espera.
       *
       * Sem isto, o caminho de recurso só sabia procurar uma caixa CRIADA — e
       * uma ligação que para à espera de escolha não cria nenhuma. No WhatsApp,
       * onde o browser corta a referência à janela por causa do COOP, isso
       * significava autorizar tudo, ter três números para escolher, e o CRM
       * dizer ao fim de oito minutos que a ligação não chegou ao fim.
       */
      const procurarEscolha = async (): Promise<MetaConnectResult | null> => {
        const { data } = await supabase.functions.invoke('meta-connect', {
          body: { action: 'pending_choice', organization_id: organization.id },
        });
        const p = (data as { pending?: { pending_id: string; connect: string; options: OpcaoConta[] } | null })?.pending;
        if (!p) return null;
        return {
          needs_choice: true,
          connect: p.connect,
          pending_id: p.pending_id,
          options: p.options,
        };
      };

      const result = await new Promise<MetaConnectResult | null>(
        (resolve, reject) => {
          // O popup acaba em /oauth/meta, no NOSSO domínio, e é de lá que vem o
          // postMessage — na edge function nunca corria, porque a Supabase serve
          // tudo como text/plain e o browser mostrava o código em vez de o
          // executar.
          //
          // `popup.closed` só é de confiar enquanto a janela for nossa. O
          // assistente do WhatsApp vive em business.facebook.com, que define
          // Cross-Origin-Opener-Policy: o browser corta-nos a referência e
          // `closed` passa a dar true DE IMEDIATO, com o assistente aberto à
          // frente da pessoa. Era isto que fazia aparecer "a janela foi fechada
          // antes do fim" antes sequer de haver alguma coisa para fechar.
          // Ninguém desiste em dois segundos: se `closed` aparecer aí, não foi
          // uma pessoa — foi o browser, e a partir daí só os dados contam.
          const inicio = Date.now();
          let cortada = false;
          const timer = setInterval(async () => {
            const decorrido = Date.now() - inicio;
            if (popup.closed && !cortada) {
              if (decorrido < 2500) cortada = true;
              else { cleanup(); resolve(null); return; }
            }
            if (!cortada) return;
            const caixa = await procurarCaixa();
            if (caixa) { cleanup(); resolve(caixa); return; }
            // Nada criado — mas pode estar uma escolha à espera.
            const escolha = await procurarEscolha();
            if (escolha) { cleanup(); resolve(escolha); return; }
            // Sem referência à janela não há como distinguir "ainda a preencher"
            // de "desistiu". Espera-se o tempo de um assistente com verificação
            // por SMS e desiste-se com uma mensagem honesta.
            if (decorrido > 8 * 60_000) { cleanup(); resolve(null); }
          }, 1500);
          const onMessage = (event: MessageEvent) => {
            if (event.data?.type !== 'meta-oauth') return;
            cleanup();
            if (event.data.error) reject(new Error(String(event.data.error)));
            else resolve(event.data);
          };
          const cleanup = () => {
            clearInterval(timer);
            window.removeEventListener('message', onMessage);
          };
          window.addEventListener('message', onMessage);
        },
      );

      // Pode vir "ligado" ou "escolhe qual" — quem chama decide o que mostrar.
      if (result) return result;

      // Última verificação antes de desistir: a janela pode ter-se fechado
      // depois de a caixa ficar criada (ou de a escolha ficar à espera), e a
      // mensagem perder-se pelo caminho.
      const criada = await procurarCaixa() ?? await procurarEscolha();
      if (!criada) throw new Error('Ligação não concluída — o assistente da Meta não chegou ao fim.');
      return criada;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messaging-channels', organization?.id] });
    },
  });
}

/**
 * Arquiva uma caixa que não é de email (Instagram, Messenger, WhatsApp).
 *
 * PORQUE É QUE ISTO DEIXOU DE APAGAR
 *
 * Isto fazia `delete` na linha do canal. Como `meta_conversations.channel_id` é
 * `ON DELETE CASCADE` — e `meta_messages` cascateia a seguir —, cada clique em
 * "Remover" levava atrás TODAS as conversas e mensagens daquele canal. Sem
 * aviso, sem retorno, e num sítio onde se carrega a sério: entre duas
 * tentativas falhadas de ligar o WhatsApp, remover a caixa parece o passo
 * natural.
 *
 * Arquivar faz o que "remover" tinha de querer dizer: a caixa desliga-se da
 * Meta (subscrição cancelada, token apagado), sai dos índices que impediam
 * voltar a ligar o mesmo número, deixa de contar para o limite do plano — e o
 * histórico fica onde está, legível. O que os clientes escreveram não é nosso
 * para apagar.
 *
 * Quem arquiva é a edge function: é lá que está o token que ainda é preciso
 * para avisar a Meta, e o arquivo e o cancelamento têm de acontecer juntos.
 * Uma caixa ligada por QR code arquiva-se pela whatsapp-disconnect, que
 * termina a sessão e apaga a instância no Evolution.
 */
export function useArchiveChannel() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (channel: Pick<MessagingChannel, 'id' | 'provider' | 'metadata'>) => {
      if (!organization?.id) throw new Error('Organização não encontrada');

      const { data, error } = isNativeEvolution(channel)
        ? await supabase.functions.invoke('whatsapp-disconnect', {
          body: { organization_id: organization.id, channel_id: channel.id },
        })
        : await supabase.functions.invoke('meta-connect', {
          body: { action: 'disconnect', organization_id: organization.id, channel_id: channel.id },
        });
      if (error) {
        let detalhe = '';
        try {
          const b = await (error as { context?: Response }).context?.json();
          detalhe = b?.error ?? '';
        } catch { /* corpo não era JSON */ }
        throw new Error(detalhe || (error as Error).message);
      }
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    },
    onSuccess: () => {
      toast.success('Caixa arquivada', {
        description: 'Deixa de receber e de enviar. As conversas continuam na Caixa de Entrada.',
      });
      queryClient.invalidateQueries({ queryKey: ['messaging-channels', organization?.id] });
    },
    onError: (e) => {
      toast.error('Não foi possível arquivar', { description: (e as Error).message });
    },
  });
}
