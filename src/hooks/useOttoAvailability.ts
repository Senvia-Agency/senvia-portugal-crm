import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export function useOttoAvailability() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ module, enabled }: { module: "leads" | "automations"; enabled: boolean }) => {
      if (!organization?.id) throw new Error("Organização não encontrada.");
      const { data, error } = await supabase.from("organizations")
        .select("enabled_modules").eq("id", organization.id).single();
      if (error) throw error;
      const stored = data.enabled_modules;
      const current = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
      const updated = await supabase.from("organizations")
        .update({ enabled_modules: { ...current, [module]: enabled } }).eq("id", organization.id)
        .select("enabled_modules").maybeSingle();
      if (updated.error) throw updated.error;
      if (!updated.data) throw new Error("A disponibilidade não foi alterada. Verifique as permissões da organização.");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["modules", organization?.id] }),
  });
}
