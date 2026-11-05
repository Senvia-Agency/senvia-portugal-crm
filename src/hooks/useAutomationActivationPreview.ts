import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';

const activationPreview = z.object({
  count: z.number().int().nonnegative(),
  scanned: z.number().int().nonnegative(),
  truncated: z.boolean(),
  scope: z.literal('calendar_candidates'),
  as_of: z.string().datetime(),
});
export type AutomationActivationPreview = z.infer<typeof activationPreview>;
export function useAutomationActivationPreview() {
  return useMutation({
    mutationFn: async (flowId: string): Promise<AutomationActivationPreview> => {
      const { data, error } = await supabase.functions.invoke('automation-activation-preview', { body: { flow_id: flowId } });
      if (error) throw new Error('Não foi possível consultar quantos registos podem entrar. Tente novamente antes de ativar.');
      const result = activationPreview.safeParse(data);
      if (!result.success) throw new Error('A prévia devolveu uma resposta inválida. A automação continua sem ser ativada.');
      return result.data;
    },
  });
}
