import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { EnabledModules } from "@/hooks/useModules";

interface OttoModuleDefinition {
  readonly key: string;
  readonly label: string;
  readonly route: `/${string}`;
  readonly permissionModule: string;
  readonly description: string;
  readonly active: boolean;
  readonly availabilityKey?: keyof EnabledModules;
  readonly requiresPortalAccess?: boolean;
}

export const OTTO_MODULES = [
  {
    key: "clients", label: "Clientes", route: "/clients", permissionModule: "clients", active: true,
    availabilityKey: "clients", description: "Criar e atualizar clientes, notas e dados suportados.",
  },
  {
    key: "leads", label: "Leads", route: "/leads", permissionModule: "leads", active: true,
    availabilityKey: "leads", description: "Criar, atualizar, atribuir e arquivar leads através das operações suportadas.",
  },
  {
    key: "sales", label: "Vendas", route: "/sales", permissionModule: "sales", active: true,
    availabilityKey: "sales", description: "Criar e atualizar vendas, estados e pagamentos suportados.",
  },
  {
    key: "proposals", label: "Propostas", route: "/proposals", permissionModule: "proposals", active: true,
    availabilityKey: "proposals", description: "Criar e atualizar propostas e os respetivos produtos suportados.",
  },
  {
    key: "finance", label: "Financeiro", route: "/financeiro", permissionModule: "finance", active: true,
    availabilityKey: "finance", description: "Executar operações financeiras suportadas, com confirmação quando exigida.",
  },
  {
    key: "calendar", label: "Agenda", route: "/calendar", permissionModule: "calendar", active: true,
    availabilityKey: "calendar", description: "Criar, atualizar e remover eventos suportados da agenda.",
  },
  {
    key: "marketing", label: "Marketing", route: "/marketing", permissionModule: "marketing", active: true,
    availabilityKey: "marketing", description: "Gerir listas, templates e campanhas através das operações suportadas.",
  },
  {
    key: "inbox", label: "Caixa de Entrada", route: "/inbox", permissionModule: "inbox", active: true,
    availabilityKey: "inbox", description: "Gerir tarefas e preparar ou enviar mensagens suportadas.",
  },
  {
    key: "prospects", label: "Prospects", route: "/prospects", permissionModule: "prospects", active: true,
    availabilityKey: "prospects", description: "Importar, atualizar e atribuir prospects através das operações suportadas.",
  },
  {
    key: "portal_total_link", label: "Portal Total Link", route: "/portal-total-link", permissionModule: "energy", active: true,
    availabilityKey: "energy", requiresPortalAccess: true, description: "Executar operações suportadas no Portal Total Link desta organização.",
  },
  {
    key: "automations", label: "Automações", route: "/automacoes", permissionModule: "automations", active: true,
    availabilityKey: "automations", description: "Criar e gerir fluxos suportados sem ativação automática.",
  },
  {
    key: "settings", label: "Definições", route: "/settings", permissionModule: "settings", active: true,
    description: "Alterar apenas definições seguras e explicitamente suportadas.",
  },
  {
    key: "support", label: "Suporte", route: "/settings", permissionModule: "settings", active: true,
    description: "Criar e atualizar pedidos de suporte através das operações suportadas.",
  },
] as const satisfies readonly OttoModuleDefinition[];

export type OttoModule = (typeof OTTO_MODULES)[number];
export type OttoModuleKey = OttoModule["key"];
export type OttoWriteGrant = Database["public"]["Tables"]["otto_write_grants"]["Row"];
export type OttoWriteGrantHistory = Database["public"]["Tables"]["otto_write_grant_history"]["Row"];

interface OttoWriteGrantBundle {
  readonly grants: readonly OttoWriteGrant[];
  readonly history: readonly OttoWriteGrantHistory[];
}

export interface OttoWriteGrantChange {
  readonly moduleKey: OttoModuleKey;
  readonly isGranted: boolean;
}

interface UseOttoWriteGrantsOptions {
  readonly enabled?: boolean;
}

export function useOttoWriteGrants(options: UseOttoWriteGrantsOptions = {}) {
  const { organization } = useAuth();
  const organizationId = organization?.id;
  const queryClient = useQueryClient();
  const queryKey = ["otto-write-grants", organizationId] as const;
  const grantsQuery = useQuery({
    queryKey,
    enabled: (options.enabled ?? true) && Boolean(organizationId),
    queryFn: async (): Promise<OttoWriteGrantBundle> => {
      if (!organizationId) throw new Error("Organização não encontrada.");
      const [grantsResult, historyResult] = await Promise.all([
        supabase
          .from("otto_write_grants")
          .select("organization_id,module_key,is_granted,granted_by,granted_at,revoked_by,revoked_at,updated_at")
          .eq("organization_id", organizationId),
        supabase
          .from("otto_write_grant_history")
          .select("id,organization_id,module_key,action,changed_by,changed_at")
          .eq("organization_id", organizationId)
          .order("changed_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(50),
      ]);
      if (grantsResult.error) throw grantsResult.error;
      if (historyResult.error) throw historyResult.error;
      return {
        grants: grantsResult.data ?? [],
        history: historyResult.data ?? [],
      };
    },
  });

  const mutation = useMutation({
    mutationFn: async ({ moduleKey, isGranted }: OttoWriteGrantChange): Promise<OttoWriteGrant> => {
      if (!organizationId) throw new Error("Organização não encontrada.");
      const { data, error } = await supabase.rpc("set_otto_write_grant", {
        _org_id: organizationId,
        _module_key: moduleKey,
        _is_granted: isGranted,
      });
      if (error) throw error;
      if (!data) throw new Error("A alteração não devolveu o novo estado da autorização.");
      return data;
    },
    onSuccess: (updatedGrant) => {
      queryClient.setQueryData<OttoWriteGrantBundle>(queryKey, (current) => {
        if (!current) return current;
        const exists = current.grants.some((grant) => grant.module_key === updatedGrant.module_key);
        const grants = exists
          ? current.grants.map((grant) => grant.module_key === updatedGrant.module_key ? updatedGrant : grant)
          : [...current.grants, updatedGrant];
        return { ...current, grants };
      });
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    grants: grantsQuery.data?.grants ?? [],
    history: grantsQuery.data?.history ?? [],
    isLoading: grantsQuery.isLoading,
    error: grantsQuery.error,
    refetch: grantsQuery.refetch,
    setGrant: mutation.mutate,
    isUpdating: mutation.isPending,
    mutationError: mutation.error,
  };
}
