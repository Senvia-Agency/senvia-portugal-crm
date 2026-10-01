import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import type { AutomationFolder } from '@/types/automations';

interface CreateAutomationFolderData {
  name: string;
}

interface UpdateAutomationFolderData {
  id: string;
  name: string;
}

function normalizedName(name: string): string {
  return name.trim();
}

export function useAutomationFolders() {
  const { organization } = useAuth();
  const organizationId = organization?.id;

  return useQuery({
    queryKey: ['automation-folders', organizationId],
    queryFn: async (): Promise<AutomationFolder[]> => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from('automation_folders')
        .select('*')
        .eq('organization_id', organizationId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });
}

export function useCreateAutomationFolder() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ name }: CreateAutomationFolderData): Promise<AutomationFolder> => {
      if (!organization?.id) throw new Error('Sem organização');
      const folderName = normalizedName(name);
      if (!folderName) throw new Error('Indique o nome da pasta');

      const { count, error: countError } = await supabase
        .from('automation_folders')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organization.id);
      if (countError) throw countError;

      const { data, error } = await supabase
        .from('automation_folders')
        .insert({ organization_id: organization.id, name: folderName, position: count ?? 0 })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-folders'] });
      toast.success('Pasta criada');
    },
    onError: (error) => {
      toast.error('Não foi possível criar a pasta', {
        description: error instanceof Error ? error.message : undefined,
      });
    },
  });
}

export function useUpdateAutomationFolder() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, name }: UpdateAutomationFolderData): Promise<AutomationFolder> => {
      if (!organization?.id) throw new Error('Sem organização');
      const folderName = normalizedName(name);
      if (!folderName) throw new Error('Indique o nome da pasta');

      const { data, error } = await supabase
        .from('automation_folders')
        .update({ name: folderName })
        .eq('id', id)
        .eq('organization_id', organization.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-folders'] });
      toast.success('Pasta atualizada');
    },
    onError: (error) => {
      toast.error('Não foi possível atualizar a pasta', {
        description: error instanceof Error ? error.message : undefined,
      });
    },
  });
}

export function useDeleteAutomationFolder() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      if (!organization?.id) throw new Error('Sem organização');
      const { error } = await supabase
        .from('automation_folders')
        .delete()
        .eq('id', id)
        .eq('organization_id', organization.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-folders'] });
      queryClient.invalidateQueries({ queryKey: ['automation-flows'] });
      toast.success('Pasta eliminada; as automações ficaram sem pasta');
    },
    onError: (error) => {
      toast.error('Não foi possível eliminar a pasta', {
        description: error instanceof Error ? error.message : undefined,
      });
    },
  });
}
