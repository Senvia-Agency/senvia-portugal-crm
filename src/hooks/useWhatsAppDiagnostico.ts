import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { tr } from '@/i18n';

/**
 * Diagnóstico da ligação de WhatsApp.
 *
 * PORQUE EXISTE
 *
 * Quando o WhatsApp não funciona, o CRM mostra a caixa como "Ligada" e não
 * chega mensagem nenhuma. É o pior sintoma possível: parece bem e está mal, e
 * as causas — seis, todas do lado da Meta — não se distinguem daqui.
 *
 * Isto pergunta as seis de uma vez ao Graph e devolve a resposta por palavras,
 * para que uma tentativa falhada custe um minuto em vez de uma tarde.
 *
 * Não altera nada: só lê. Pode correr-se as vezes que forem precisas.
 */

export interface Achado {
  passo: string;
  /** `null` = não foi possível verificar (não é o mesmo que estar mal). */
  ok: boolean | null;
  detalhe: string;
}

export interface CaixaDiagnostico {
  id: string;
  label: string | null;
  status: string | null;
  /**
   * 'whatsapp' | 'instagram' | 'facebook'.
   *
   * O diagnóstico passou a cobrir os três: o Instagram e o Messenger tinham
   * exatamente o mesmo sintoma — "ligada e calada" — e nenhuma forma de o
   * examinar sem ser a olho.
   */
  channel_type?: string;
  phone_number_id: string | null;
  waba_id: string | null;
  achados: Achado[];
}

export interface RelatorioDiagnostico {
  /** Verificações da app inteira — valem para todos os clientes. */
  achados: Achado[];
  /** Verificações caixa a caixa. */
  caixas: CaixaDiagnostico[];
}

export function useWhatsAppDiagnostico() {
  const { organization } = useAuth();

  return useMutation({
    mutationFn: async (): Promise<RelatorioDiagnostico> => {
      if (!organization?.id) throw new Error(tr('Organização não encontrada'));

      const { data, error } = await supabase.functions.invoke('meta-connect', {
        body: { action: 'whatsapp_diagnostico', organization_id: organization.id },
      });

      if (error) {
        // O corpo do erro traz a razão real; a mensagem do `FunctionsHttpError`
        // é sempre a mesma frase genérica e não serve para nada.
        let detalhe = '';
        try {
          const b = await (error as { context?: Response }).context?.json();
          detalhe = b?.error ?? '';
        } catch { /* corpo não era JSON */ }
        throw new Error(detalhe || (error as Error).message);
      }
      if ((data as { error?: string })?.error) {
        throw new Error((data as { error: string }).error);
      }

      return data as RelatorioDiagnostico;
    },
  });
}
