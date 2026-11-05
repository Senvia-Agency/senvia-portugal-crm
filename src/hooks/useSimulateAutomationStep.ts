import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
const simulationSchema = z.object({ simulation: z.literal(true), status: z.literal('simulated'), node_type: z.string(), detail: z.record(z.unknown()).optional(), variables: z.record(z.unknown()).optional() });
export type AutomationStepSimulation = z.infer<typeof simulationSchema>;
interface StepSimulationInput {
  readonly flow_id: string;
  readonly node_id: string;
  readonly subject_type: string;
  readonly subject_id: string;
}
export function useSimulateAutomationStep() {
  return useMutation({
    mutationFn: async (input: StepSimulationInput): Promise<AutomationStepSimulation> => {
      const { data, error } = await supabase.functions.invoke('automation-engine', { body: { action: 'step_test', ...input } });
      if (error) throw error;
      if (typeof data?.error === 'string') throw new Error(data.error);
      return simulationSchema.parse(data);
    },
  });
}
