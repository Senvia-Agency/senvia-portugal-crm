import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { Json } from '@/integrations/supabase/types';
import {
  DEFAULT_MODULES,
  getPlanRank,
  isPlanSufficient,
} from '@/lib/plan-config';

export interface EnabledModules {
  proposals: boolean;
  calendar: boolean;
  sales: boolean;
  ecommerce: boolean;
  clients: boolean;
  marketing: boolean;
  finance: boolean;
  energy: boolean;
  prospects: boolean;
  inbox: boolean;
}

export function useModules() {
  const { organization } = useAuth();
  const organizationId = organization?.id;
  const queryClient = useQueryClient();

  const { data: modules, isLoading } = useQuery({
    queryKey: ['modules', organizationId],
    queryFn: async () => {
      if (!organizationId) return { ...DEFAULT_MODULES } as EnabledModules;

      const { data, error } = await supabase
        .from('organizations')
        .select('enabled_modules')
        .eq('id', organizationId)
        .single();

      if (error) {
        console.error('Error fetching modules:', error);
        return { ...DEFAULT_MODULES } as EnabledModules;
      }

      const enabledModules = data?.enabled_modules as Record<string, boolean> | null;

      // Merge DB overrides on top of defaults.
      const merged = {
        ...DEFAULT_MODULES,
        ...(enabledModules || {}),
      } as EnabledModules;

      // Enforce plan restrictions: modules gated by plan tier are force-disabled
      // when the org's plan doesn't reach the required rank. Trial orgs get elite
      // access (full rank).
      const planRank = getPlanRank(organization as any);
      for (const key of Object.keys(merged)) {
        if (!isPlanSufficient(planRank, key)) {
          (merged as any)[key] = false;
        }
      }

      merged.ecommerce = false;
      return merged;
    },
    enabled: !!organizationId,
  });

  const updateModuleMutation = useMutation({
    mutationFn: async ({ module, enabled }: { module: keyof EnabledModules; enabled: boolean }) => {
      if (!organizationId) throw new Error('No organization');

      const currentModules = modules || DEFAULT_MODULES;
      const newModules = { ...currentModules, [module]: enabled };

      const { error } = await supabase
        .from('organizations')
        .update({ enabled_modules: newModules as unknown as Json })
        .eq('id', organizationId);

      if (error) throw error;
      return newModules;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modules'] });
      toast.success('Módulo atualizado');
    },
    onError: (error) => {
      console.error('Error updating module:', error);
      toast.error('Erro ao atualizar módulo');
    },
  });

  const updateAllModulesMutation = useMutation({
    mutationFn: async (newModules: EnabledModules) => {
      if (!organizationId) throw new Error('No organization');

      const { error } = await supabase
        .from('organizations')
        .update({ enabled_modules: newModules as unknown as Json })
        .eq('id', organizationId);

      if (error) throw error;
      return newModules;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modules'] });
    },
    onError: (error) => {
      console.error('Error updating modules:', error);
    },
  });

  return {
    modules: modules || DEFAULT_MODULES,
    isLoading,
    updateModule: updateModuleMutation.mutate,
    updateAllModules: updateAllModulesMutation.mutateAsync,
    isUpdating: updateModuleMutation.isPending || updateAllModulesMutation.isPending,
  };
}
