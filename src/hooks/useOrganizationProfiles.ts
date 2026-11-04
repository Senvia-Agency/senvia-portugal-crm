import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { tr } from '@/i18n';

// ── Action labels ──
export const ACTION_LABELS: Record<string, string> = {
  view: 'Ver',
  add: 'Adicionar',
  edit: 'Editar',
  delete: 'Eliminar',
  assign: 'Atribuir',
  export: 'Exportar',
  import: 'Importar',
  create: 'Criar',
  send: 'Enviar',
  issue: 'Emitir',
  cancel: 'Cancelar',
  submit: 'Submeter',
  approve: 'Aprovar',
  manage: 'Gerir',
};

// ── Schema definition ──
export interface SubareaSchema {
  label: string;
  actions: string[];
}

export interface ModuleSchema {
  label: string;
  subareas: Record<string, SubareaSchema>;
}

export const MODULE_SCHEMA: Record<string, ModuleSchema> = {
  leads: {
    label: 'Leads',
    subareas: {
      kanban: { label: 'Kanban / Lista', actions: ['view', 'add', 'edit', 'delete', 'assign'] },
      export: { label: 'Importar / Exportar', actions: ['export', 'import'] },
      imports: { label: 'Histórico de Importações', actions: ['view', 'delete'] },
    },
  },
  clients: {
    label: 'Clientes',
    subareas: {
      list: { label: 'Lista de Clientes', actions: ['view', 'add', 'edit', 'delete'] },
      communications: { label: 'Comunicações', actions: ['view', 'add'] },
      cpes: { label: 'CPEs', actions: ['view', 'add', 'edit', 'delete'] },
    },
  },
  proposals: {
    label: 'Propostas',
    subareas: {
      proposals: { label: 'Propostas', actions: ['view', 'create', 'edit', 'delete', 'send'] },
    },
  },
  sales: {
    label: 'Vendas',
    subareas: {
      sales: { label: 'Vendas', actions: ['view', 'create', 'edit', 'delete'] },
      payments: { label: 'Pagamentos', actions: ['view', 'add'] },
    },
  },
  finance: {
    label: 'Finanças',
    subareas: {
      summary: { label: 'Resumo', actions: ['view'] },
      invoices: { label: 'Faturas', actions: ['view', 'issue', 'cancel'] },
      expenses: { label: 'Despesas', actions: ['view', 'add', 'edit', 'delete'] },
      payments: { label: 'Pagamentos', actions: ['view'] },
      requests: { label: 'Pedidos Internos', actions: ['view', 'submit', 'approve'] },
      commissions: { label: 'Comissões', actions: ['view', 'manage'] },
    },
  },
  calendar: {
    label: 'Agenda',
    subareas: {
      events: { label: 'Eventos', actions: ['view', 'create', 'edit', 'delete'] },
    },
  },
  marketing: {
    label: 'Marketing',
    subareas: {
      templates: { label: 'Templates', actions: ['view', 'create', 'edit', 'delete', 'send'] },
      lists: { label: 'Listas', actions: ['view', 'create', 'edit', 'delete'] },
      campaigns: { label: 'Campanhas', actions: ['view', 'create', 'edit', 'delete', 'send'] },
      reports: { label: 'Relatórios', actions: ['view'] },
    },
  },
  inbox: {
    label: 'Caixa de Entrada',
    subareas: {
      tasks: { label: 'Tarefas', actions: ['view', 'create', 'edit'] },
      messages: { label: 'Mensagens', actions: ['view', 'send'] },
      email: { label: 'Email', actions: ['view', 'create', 'edit', 'send'] },
    },
  },
  prospects: {
    label: 'Prospects',
    subareas: {
      prospects: { label: 'Prospects', actions: ['view', 'import', 'assign'] },
    },
  },
  energy: {
    label: 'Portal Total Link',
    subareas: {
      portal: { label: 'Portal', actions: ['view'] },
    },
  },
  automations: {
    label: 'Automações',
    subareas: {
      flows: { label: 'Fluxos', actions: ['view', 'create', 'edit', 'delete', 'manage'] },
    },
  },
  ecommerce: {
    label: 'E-commerce',
    subareas: {
      products: { label: 'Produtos', actions: ['view', 'create', 'edit', 'delete'] },
      orders: { label: 'Pedidos', actions: ['view', 'edit'] },
      customers: { label: 'Clientes', actions: ['view', 'create', 'edit'] },
      inventory: { label: 'Inventário', actions: ['view', 'edit'] },
      discounts: { label: 'Descontos', actions: ['view', 'create', 'edit', 'delete'] },
    },
  },
  settings: {
    label: 'Definições',
    subareas: {
      general: { label: 'Geral', actions: ['view', 'edit'] },
      team: { label: 'Equipa', actions: ['view', 'manage'] },
      pipeline: { label: 'Pipeline', actions: ['view', 'edit'] },
      profiles: { label: 'Perfis', actions: ['view', 'manage'] },
      modules: { label: 'Módulos', actions: ['view', 'edit'] },
    },
  },
};

const EXPLICIT_GRANT_SUBAREAS: ReadonlySet<string> = new Set([
  'marketing.lists',
  'marketing.campaigns',
  'marketing.reports',
  'inbox.tasks',
  'inbox.messages',
  'inbox.email',
  'prospects.prospects',
  'energy.portal',
  'automations.flows',
]);

export function requiresExplicitProfileGrant(moduleKey: string, subarea: string): boolean {
  return EXPLICIT_GRANT_SUBAREAS.has(`${moduleKey}.${subarea}`);
}

// ── Types ──
export type SubareaPermissions = Record<string, boolean>;
export interface ModulePermission {
  subareas: Record<string, SubareaPermissions>;
}
export type GranularPermissions = Record<string, ModulePermission>;

// Legacy flat format for backward compat
export interface LegacyModulePermission {
  view: boolean;
  edit: boolean;
  delete: boolean;
}
export type LegacyModulePermissions = Record<string, LegacyModulePermission>;

// Union: can be either format from DB
export type ModulePermissions = GranularPermissions;

export type DataScope = 'own' | 'team' | 'all';

export const DATA_SCOPE_LABELS: Record<DataScope, string> = {
  own: 'Próprio',
  team: 'Equipa',
  all: 'Tudo',
};

export const DATA_SCOPE_DESCRIPTIONS: Record<DataScope, string> = {
  own: 'Vê apenas os seus dados',
  team: 'Vê os seus + dados da equipa',
  all: 'Vê todos os dados da organização',
};

export interface ProfileDashboardWidget {
  type: string;
  is_visible: boolean;
}

export interface OrganizationProfile {
  id: string;
  organization_id: string;
  name: string;
  base_role: 'admin' | 'viewer' | 'salesperson';
  module_permissions: GranularPermissions;
  data_scope: DataScope;
  is_default: boolean;
  dashboard_widgets: ProfileDashboardWidget[] | null;
  created_at: string;
}

// ── Conversion from legacy ──
function isLegacyFormat(perms: any): boolean {
  if (!perms || typeof perms !== 'object') return false;
  const firstKey = Object.keys(perms)[0];
  if (!firstKey) return false;
  const val = perms[firstKey];
  return val && typeof val === 'object' && 'view' in val && !('subareas' in val);
}

export function convertLegacyToGranular(legacy: any): GranularPermissions {
  if (!legacy || typeof legacy !== 'object') return buildAllPermissions(true);
  if (!isLegacyFormat(legacy)) return legacy as GranularPermissions;

  const result: GranularPermissions = {};
  for (const [moduleKey, schema] of Object.entries(MODULE_SCHEMA)) {
    const old = legacy[moduleKey] as LegacyModulePermission | undefined;
    const canView = old?.view ?? false;
    const canEdit = old?.edit ?? false;
    const canDelete = old?.delete ?? false;

    const subareas: Record<string, SubareaPermissions> = {};
    for (const [subKey, subSchema] of Object.entries(schema.subareas)) {
      const actions: SubareaPermissions = {};
      for (const action of subSchema.actions) {
        if (requiresExplicitProfileGrant(moduleKey, subKey)) actions[action] = false;
        else if (action === 'view') actions[action] = canView;
        else if (action === 'delete') actions[action] = canDelete;
        else actions[action] = canEdit;
      }
      subareas[subKey] = actions;
    }
    result[moduleKey] = { subareas };
  }
  return result;
}

// ── Build helpers ──
export function buildAllPermissions(value: boolean): GranularPermissions {
  const result: GranularPermissions = {};
  for (const [moduleKey, schema] of Object.entries(MODULE_SCHEMA)) {
    const subareas: Record<string, SubareaPermissions> = {};
    for (const [subKey, subSchema] of Object.entries(schema.subareas)) {
      const actions: SubareaPermissions = {};
      for (const action of subSchema.actions) {
        actions[action] = value;
      }
      subareas[subKey] = actions;
    }
    result[moduleKey] = { subareas };
  }
  return result;
}

export function buildDefaultPermissions(role: string): GranularPermissions {
  if (role === 'admin') return buildAllPermissions(true);
  if (role === 'viewer') {
    const result: GranularPermissions = {};
    for (const [moduleKey, schema] of Object.entries(MODULE_SCHEMA)) {
      if (moduleKey === 'settings') {
        const subareas: Record<string, SubareaPermissions> = {};
        for (const [subKey, subSchema] of Object.entries(schema.subareas)) {
          const actions: SubareaPermissions = {};
          for (const action of subSchema.actions) actions[action] = false;
          subareas[subKey] = actions;
        }
        result[moduleKey] = { subareas };
        continue;
      }
      const subareas: Record<string, SubareaPermissions> = {};
      for (const [subKey, subSchema] of Object.entries(schema.subareas)) {
        const actions: SubareaPermissions = {};
        for (const action of subSchema.actions) {
          actions[action] = !requiresExplicitProfileGrant(moduleKey, subKey) && action === 'view';
        }
        subareas[subKey] = actions;
      }
      result[moduleKey] = { subareas };
    }
    return result;
  }
  // salesperson
  const result: GranularPermissions = {};
  for (const [moduleKey, schema] of Object.entries(MODULE_SCHEMA)) {
    const subareas: Record<string, SubareaPermissions> = {};
    for (const [subKey, subSchema] of Object.entries(schema.subareas)) {
      const actions: SubareaPermissions = {};
      for (const action of subSchema.actions) {
        if (requiresExplicitProfileGrant(moduleKey, subKey)) {
          actions[action] = false;
        } else if (['finance', 'marketing', 'ecommerce', 'settings'].includes(moduleKey)) {
          actions[action] = false;
        } else if (action === 'delete') {
          actions[action] = false;
        } else {
          actions[action] = true;
        }
      }
      subareas[subKey] = actions;
    }
    result[moduleKey] = { subareas };
  }
  return result;
}

// ── Legacy compat exports ──
export const MODULE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(MODULE_SCHEMA).map(([k, v]) => [k, v.label])
);

// ── Hook ──
export function useOrganizationProfiles() {
  const { organization } = useAuth();
  const organizationId = organization?.id;
  const queryClient = useQueryClient();

  const { data: profiles, isLoading } = useQuery({
    queryKey: ['organization-profiles', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from('organization_profiles')
        .select('*')
        .eq('organization_id', organizationId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []).map((d: any) => ({
        ...d,
        module_permissions: convertLegacyToGranular(d.module_permissions),
      })) as OrganizationProfile[];
    },
    enabled: !!organizationId,
  });

  const createProfile = useMutation({
    mutationFn: async (profile: { name: string; base_role: string; module_permissions: GranularPermissions; data_scope?: DataScope; dashboard_widgets?: ProfileDashboardWidget[] | null }) => {
      if (!organizationId) throw new Error('No organization');
      const { error } = await supabase
        .from('organization_profiles')
        .insert([{
          organization_id: organizationId,
          name: profile.name,
          base_role: profile.base_role,
          module_permissions: profile.module_permissions as any,
          data_scope: profile.data_scope || 'own',
          dashboard_widgets: profile.dashboard_widgets ?? null,
        }] as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-profiles', organizationId] });
      toast.success(tr('Perfil criado com sucesso'));
    },
    onError: () => toast.error(tr('Erro ao criar perfil')),
  });

  const updateProfile = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; name?: string; base_role?: string; module_permissions?: GranularPermissions; data_scope?: DataScope; dashboard_widgets?: ProfileDashboardWidget[] | null }) => {
      const updateData: any = {};
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.base_role !== undefined) updateData.base_role = updates.base_role;
      if (updates.module_permissions !== undefined) updateData.module_permissions = updates.module_permissions;
      if (updates.data_scope !== undefined) updateData.data_scope = updates.data_scope;
      if (updates.dashboard_widgets !== undefined) updateData.dashboard_widgets = updates.dashboard_widgets;
      
      const { error } = await supabase
        .from('organization_profiles')
        .update(updateData)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-profiles', organizationId] });
      toast.success(tr('Perfil atualizado'));
    },
    onError: () => toast.error(tr('Erro ao atualizar perfil')),
  });

  const deleteProfile = useMutation({
    mutationFn: async (id: string) => {
      const { data: members } = await supabase
        .from('organization_members')
        .select('id')
        .eq('profile_id', id)
        .limit(1);
      
      if (members && members.length > 0) {
        throw new Error(tr('Este perfil está em uso por colaboradores da equipa'));
      }

      const { error } = await supabase
        .from('organization_profiles')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-profiles', organizationId] });
      toast.success(tr('Perfil eliminado'));
    },
    onError: (error: Error) => toast.error(error.message || tr('Erro ao eliminar perfil')),
  });

  return {
    profiles: profiles || [],
    isLoading,
    createProfile,
    updateProfile,
    deleteProfile,
  };
}
