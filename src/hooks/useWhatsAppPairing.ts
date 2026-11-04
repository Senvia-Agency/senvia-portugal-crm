import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { tr } from '@/i18n';

/**
 * Concluir o emparelhamento de Coexistence de um número já ligado.
 *
 * PORQUE É QUE ISTO EXISTE À PARTE DA LIGAÇÃO
 *
 * Ligar o WhatsApp tem dois lados, e o fluxo por redirect só faz um:
 *
 *   1. partilhar a conta com a app  → o redirect faz, e é o que cria a caixa
 *   2. REGISTAR o número            → só o assistente da Meta faz, e só quando
 *                                      lançado pelo SDK (exige session logging)
 *
 * Sem o passo 2 o número fica `DISCONNECTED`/`ON_PREMISE` e a Meta não entrega
 * nada: nem mensagens novas, nem os 180 dias de histórico. E as duas saídas por
 * API estão trancadas uma na outra — `/register` responde "not available for
 * SMB businesses", `smb_app_data` responde "(#133010) Account not registered".
 *
 * PORQUE É QUE O CÓDIGO É DEITADO FORA
 *
 * O SDK devolve um `code` para trocar por token. Essa troca falha SEMPRE aqui,
 * com `code=100 error_subcode=36008`, e nunca se percebeu porquê (há uma thread
 * na comunidade da Meta com o mesmo caso, por resolver). Foi isso que fez
 * abandonar o SDK.
 *
 * Só que nós não precisamos do token dele: já temos um, guardado no canal,
 * vindo do redirect. O SDK serve aqui só para CORRER O ASSISTENTE. Ignorando o
 * código, a única coisa que falhava deixa de estar no caminho.
 */

interface SessaoWhatsApp {
  waba_id?: string;
  phone_number_id?: string;
}

interface ResultadoPareamento {
  registado: boolean;
  estado: { status: string | null; platform_type: string | null; is_on_biz_app: boolean | null };
  sincronia: Array<{ tipo: string; ok: boolean; erro: string | null }>;
  mensagem: string;
}

declare global {
  interface Window {
    FB?: {
      init: (o: Record<string, unknown>) => void;
      login: (cb: (r: unknown) => void, o: Record<string, unknown>) => void;
    };
    fbAsyncInit?: () => void;
  }
}

function carregarSdk(appId: string, versao: string): Promise<void> {
  // Já carregado: volta a inicializar. O `versao` vem do servidor e pode ter
  // mudado desde que a página abriu; sem isto, quem tem o separador aberto
  // continua a lançar o assistente na versão velha.
  if (window.FB) {
    window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: versao });
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: versao });
      resolve();
    };
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/en_US/sdk.js';
    s.async = true;
    s.defer = true;
    s.crossOrigin = 'anonymous';
    s.onerror = () => reject(new Error(
      tr('Não foi possível carregar o SDK da Meta. Alguma extensão do browser pode estar a bloqueá-lo.'),
    ));
    document.body.appendChild(s);
  });
}

export function useWhatsAppPairing() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ phoneNumberId, wabaId }: { phoneNumberId?: string; wabaId?: string }) => {
      if (!organization?.id) throw new Error(tr('Organização não encontrada'));

      const { data: params, error: pErr } = await supabase.functions.invoke('meta-connect', {
        body: { action: 'whatsapp_params', organization_id: organization.id },
      });
      if (pErr) throw new Error((pErr as Error).message);
      const { app_id, config_id, graph_version, es_version, feature_type } = params as {
        app_id: string; config_id: string; graph_version: string;
        es_version?: string; feature_type?: string;
      };

      await carregarSdk(app_id, graph_version);

      // A sessão chega por `message`, em paralelo com o fim do assistente.
      // Ouve-se ANTES de abrir: a mensagem pode chegar primeiro.
      let sessao: SessaoWhatsApp = {};
      let ultimoEvento = '';
      const ouvir = (ev: MessageEvent) => {
        if (!String(ev.origin).endsWith('facebook.com')) return;
        try {
          const d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
          if (d?.type !== 'WA_EMBEDDED_SIGNUP') return;
          // Os ids tanto vêm dentro de `data` como no próprio objeto, conforme
          // a versão. Aceitam-se as duas formas.
          const c = (d.data ?? d) as SessaoWhatsApp & { event?: string };
          if (c?.event) ultimoEvento = String(c.event);
          if (c?.waba_id || c?.phone_number_id) sessao = { ...sessao, ...c };
        } catch { /* nem tudo o que a Meta envia é a sessão */ }
      };
      window.addEventListener('message', ouvir);

      try {
        await new Promise<void>((resolve, reject) => {
          window.FB!.login(
            () => {
              // Deliberadamente sem olhar para a resposta. O `code` que vem
              // aqui não serve para nada nesta app — ver o cabeçalho.
              resolve();
            },
            {
              config_id,
              response_type: 'code',
              override_default_response_type: true,
              // Os mesmos campos, pela mesma ordem, da app de referência da
              // Meta (`ClientDashboard.tsx`, `computeEsConfig`). O `version` é
              // o que escolhe a versão do Cadastro Incorporado; sem ele corre
              // uma variante antiga.
              extras: {
                sessionInfoVersion: '3',
                version: es_version ?? 'v3',
                featureType: feature_type ?? 'whatsapp_business_app_onboarding',
                features: null,
              },
            },
          );
          // O SDK não chama o callback se a janela for fechada à força.
          setTimeout(() => reject(new Error(
            tr('O assistente demorou demasiado. Se o completaste, carrega outra vez para confirmar.'),
          )), 10 * 60_000);
        });

        // A mensagem da sessão e o fim do assistente chegam por caminhos
        // diferentes, sem ordem garantida. Dá-se um instante à mensagem.
        for (let i = 0; i < 20 && !sessao.phone_number_id && !sessao.waba_id; i++) {
          await new Promise((r) => setTimeout(r, 150));
        }

        if (ultimoEvento === 'CANCEL') {
          throw new Error(tr('Ligação cancelada — o assistente foi fechado antes do fim.'));
        }

        // O servidor confirma o estado à Meta e pede a sincronização. Os ids do
        // assistente têm prioridade; os da caixa servem de rede.
        const { data, error } = await supabase.functions.invoke('meta-connect', {
          body: {
            action: 'whatsapp_pairing',
            organization_id: organization.id,
            phone_number_id: sessao.phone_number_id ?? phoneNumberId ?? null,
            waba_id: sessao.waba_id ?? wabaId ?? null,
          },
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
        return data as ResultadoPareamento;
      } finally {
        window.removeEventListener('message', ouvir);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messaging-channels', organization?.id] });
    },
  });
}
