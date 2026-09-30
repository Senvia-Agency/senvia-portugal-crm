import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { EmailTemplate, EmailTemplateCategory } from '@/types/marketing';

interface CreateEmailTemplateData {
  name: string;
  subject: string;
  html_content: string;
  category?: EmailTemplateCategory;
  /** The user-managed category (email_template_categories). null = none. */
  category_id?: string | null;
  variables?: string[];
  is_active?: boolean;
  automation_enabled?: boolean;
  automation_trigger_type?: string | null;
  automation_trigger_config?: Record<string, string>;
  automation_delay_minutes?: number;
}

interface UpdateEmailTemplateData extends Partial<CreateEmailTemplateData> {
  id: string;
}

export function useEmailTemplates() {
  const { organization } = useAuth();
  const organizationId = organization?.id;

  return useQuery({
    queryKey: ['email-templates', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from('email_templates')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      return data.map(item => ({
        ...item,
        category: item.category as EmailTemplateCategory,
        variables: (item.variables as string[]) || [],
      })) as EmailTemplate[];
    },
    enabled: !!organizationId,
  });
}

export function useEmailTemplate(id: string | null) {
  const { organization } = useAuth();
  const organizationId = organization?.id;

  return useQuery({
    queryKey: ['email-template', id],
    queryFn: async () => {
      if (!id || !organizationId) return null;

      const { data, error } = await supabase
        .from('email_templates')
        .select('*')
        .eq('id', id)
        .eq('organization_id', organizationId)
        .single();

      if (error) throw error;
      
      return {
        ...data,
        category: data.category as EmailTemplateCategory,
        variables: (data.variables as string[]) || [],
      } as EmailTemplate;
    },
    enabled: !!id && !!organizationId,
  });
}

export function useCreateEmailTemplate() {
  const { organization, user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateEmailTemplateData) => {
      if (!organization?.id) throw new Error('Sem organização');

      const { data: template, error } = await supabase
        .from('email_templates')
        .insert({
          organization_id: organization.id,
          name: data.name,
          subject: data.subject,
          html_content: data.html_content,
          category: data.category || 'general',
          category_id: data.category_id ?? null,
          variables: data.variables || [],
          is_active: data.is_active ?? true,
          created_by: user?.id,
          automation_enabled: data.automation_enabled ?? false,
          automation_trigger_type: data.automation_trigger_type ?? null,
          automation_trigger_config: data.automation_trigger_config ?? {},
          automation_delay_minutes: data.automation_delay_minutes ?? 0,
        })
        .select()
        .single();

      if (error) throw error;
      return template;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-templates'] });
      toast.success('Template criado com sucesso');
    },
    onError: (error) => {
      console.error('Error creating template:', error);
      toast.error('Erro ao criar template');
    },
  });
}

export function useUpdateEmailTemplate() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateEmailTemplateData) => {
      if (!organization?.id) throw new Error('Sem organização');

      const updateData: Record<string, unknown> = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.subject !== undefined) updateData.subject = data.subject;
      if (data.html_content !== undefined) updateData.html_content = data.html_content;
      if (data.category !== undefined) updateData.category = data.category;
      if (data.category_id !== undefined) updateData.category_id = data.category_id;
      if (data.variables !== undefined) updateData.variables = data.variables;
      if (data.is_active !== undefined) updateData.is_active = data.is_active;
      if (data.automation_enabled !== undefined) updateData.automation_enabled = data.automation_enabled;
      if (data.automation_trigger_type !== undefined) updateData.automation_trigger_type = data.automation_trigger_type;
      if (data.automation_trigger_config !== undefined) updateData.automation_trigger_config = data.automation_trigger_config;
      if (data.automation_delay_minutes !== undefined) updateData.automation_delay_minutes = data.automation_delay_minutes;

      const { data: template, error } = await supabase
        .from('email_templates')
        .update(updateData)
        .eq('id', id)
        .eq('organization_id', organization.id)
        .select()
        .single();

      if (error) throw error;
      return template;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-templates'] });
      queryClient.invalidateQueries({ queryKey: ['email-template'] });
      toast.success('Template atualizado com sucesso');
    },
    onError: (error) => {
      console.error('Error updating template:', error);
      toast.error('Erro ao atualizar template');
    },
  });
}

export function useDeleteEmailTemplate() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!organization?.id) throw new Error('Sem organização');

      const { error } = await supabase
        .from('email_templates')
        .delete()
        .eq('id', id)
        .eq('organization_id', organization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-templates'] });
      toast.success('Template eliminado');
    },
    onError: (error) => {
      console.error('Error deleting template:', error);
      toast.error('Erro ao eliminar template');
    },
  });
}

export function useDuplicateEmailTemplate() {
  const { organization, user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (templateId: string) => {
      if (!organization?.id) throw new Error('Sem organização');

      const { data: original, error: fetchError } = await supabase
        .from('email_templates')
        .select('*')
        .eq('id', templateId)
        .single();

      if (fetchError) throw fetchError;

      const { data: duplicate, error: createError } = await supabase
        .from('email_templates')
        .insert({
          organization_id: organization.id,
          name: `${original.name} (cópia)`,
          subject: original.subject,
          html_content: original.html_content,
          category: original.category,
          variables: original.variables,
          is_active: false,
          created_by: user?.id,
          automation_enabled: false,
          automation_trigger_type: null,
          automation_trigger_config: {},
          automation_delay_minutes: 0,
        })
        .select()
        .single();

      if (createError) throw createError;
      return duplicate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-templates'] });
      toast.success('Template duplicado');
    },
    onError: (error) => {
      console.error('Error duplicating template:', error);
      toast.error('Erro ao duplicar template');
    },
  });
}
