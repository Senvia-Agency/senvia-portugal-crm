import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { tr } from '@/i18n';
import { Form, FormSettings, DEFAULT_FORM_SETTINGS, migrateFormSettings } from '@/types';
import { Json } from '@/integrations/supabase/types';

// Transform database row to Form type
function transformForm(row: any): Form {
  return {
    id: row.id,
    organization_id: row.organization_id,
    name: row.name,
    slug: row.slug,
    form_settings: migrateFormSettings(row.form_settings || {}),
    is_default: row.is_default,
    is_active: row.is_active,
    msg_template_hot: row.msg_template_hot,
    msg_template_warm: row.msg_template_warm,
    msg_template_cold: row.msg_template_cold,
    ai_qualification_rules: row.ai_qualification_rules,
    meta_pixels: Array.isArray(row.meta_pixels) ? row.meta_pixels : [],
    assigned_to: row.assigned_to,
    assigned_user_ids: Array.isArray(row.assigned_user_ids) ? row.assigned_user_ids : [],
    rotate_enabled: row.rotate_enabled ?? false,
    notify_all_admins: row.notify_all_admins ?? true,
    target_stage: row.target_stage || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function useForms() {
  const { organization } = useAuth();

  return useQuery({
    queryKey: ['forms', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];

      const { data, error } = await supabase
        .from('forms')
        .select('*')
        .eq('organization_id', organization.id)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true });

      if (error) throw error;
      return (data || []).map(transformForm);
    },
    enabled: !!organization?.id,
  });
}

export function useForm(formId: string | null) {
  const { organization } = useAuth();

  return useQuery({
    queryKey: ['form', formId],
    queryFn: async () => {
      if (!formId || !organization?.id) return null;

      const { data, error } = await supabase
        .from('forms')
        .select('*')
        .eq('id', formId)
        .eq('organization_id', organization.id)
        .maybeSingle();

      if (error) throw error;
      return data ? transformForm(data) : null;
    },
    enabled: !!formId && !!organization?.id,
  });
}

interface CreateFormData {
  name: string;
  slug: string;
  form_settings?: FormSettings;
  is_default?: boolean;
  target_stage?: string | null;
}

export function useCreateForm() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateFormData) => {
      if (!organization?.id) throw new Error('No organization');

      // If this form is default, unset other defaults first
      if (data.is_default) {
        await supabase
          .from('forms')
          .update({ is_default: false })
          .eq('organization_id', organization.id);
      }

      const { data: newForm, error } = await supabase
        .from('forms')
        .insert({
          organization_id: organization.id,
          name: data.name,
          slug: data.slug,
          form_settings: (data.form_settings || DEFAULT_FORM_SETTINGS) as unknown as Json,
          is_default: data.is_default || false,
          is_active: true,
          target_stage: data.target_stage || null,
        })
        .select()
        .single();

      if (error) throw error;
      return transformForm(newForm);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forms'] });
      toast({
        title: tr('Formulário criado'),
        description: tr('O novo formulário foi criado com sucesso.'),
      });
    },
    onError: (error: any) => {
      console.error('Error creating form:', error);
      const message = error.message?.includes('unique_org_form_slug')
        ? tr('Já existe um formulário com este slug.')
        : tr('Não foi possível criar o formulário.');
      toast({
        title: tr('Erro'),
        description: message,
        variant: 'destructive',
      });
    },
  });
}

interface UpdateFormData {
  id: string;
  name?: string;
  slug?: string;
  form_settings?: FormSettings;
  is_default?: boolean;
  is_active?: boolean;
  msg_template_hot?: string | null;
  msg_template_warm?: string | null;
  msg_template_cold?: string | null;
  ai_qualification_rules?: string | null;
  meta_pixels?: any[];
  assigned_to?: string | null;
  assigned_user_ids?: string[];
  rotate_enabled?: boolean;
  notify_all_admins?: boolean;
  target_stage?: string | null;
}

export function useUpdateForm() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateFormData) => {
      if (!organization?.id) throw new Error('No organization');

      // If setting as default, unset others first
      if (data.is_default) {
        await supabase
          .from('forms')
          .update({ is_default: false })
          .eq('organization_id', organization.id)
          .neq('id', data.id);
      }

      const updateData: any = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.slug !== undefined) updateData.slug = data.slug;
      if (data.form_settings !== undefined) updateData.form_settings = data.form_settings as unknown as Json;
      if (data.is_default !== undefined) updateData.is_default = data.is_default;
      if (data.is_active !== undefined) updateData.is_active = data.is_active;
      if (data.msg_template_hot !== undefined) updateData.msg_template_hot = data.msg_template_hot;
      if (data.msg_template_warm !== undefined) updateData.msg_template_warm = data.msg_template_warm;
      if (data.msg_template_cold !== undefined) updateData.msg_template_cold = data.msg_template_cold;
      if (data.ai_qualification_rules !== undefined) updateData.ai_qualification_rules = data.ai_qualification_rules;
      if (data.meta_pixels !== undefined) updateData.meta_pixels = data.meta_pixels;
      if (data.assigned_to !== undefined) updateData.assigned_to = data.assigned_to;
      if (data.assigned_user_ids !== undefined) updateData.assigned_user_ids = data.assigned_user_ids;
      if (data.rotate_enabled !== undefined) updateData.rotate_enabled = data.rotate_enabled;
      if (data.notify_all_admins !== undefined) updateData.notify_all_admins = data.notify_all_admins;
      if (data.target_stage !== undefined) updateData.target_stage = data.target_stage;

      const { data: updatedForm, error } = await supabase
        .from('forms')
        .update(updateData)
        .eq('id', data.id)
        .eq('organization_id', organization.id)
        .select()
        .single();

      if (error) throw error;
      return transformForm(updatedForm);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forms'] });
      queryClient.invalidateQueries({ queryKey: ['form'] });
      toast({
        title: tr('Formulário atualizado'),
        description: tr('As alterações foram guardadas.'),
      });
    },
    onError: (error: any) => {
      console.error('Error updating form:', error);
      const message = error.message?.includes('unique_org_form_slug')
        ? tr('Já existe um formulário com este slug.')
        : tr('Não foi possível atualizar o formulário.');
      toast({
        title: tr('Erro'),
        description: message,
        variant: 'destructive',
      });
    },
  });
}

export function useDeleteForm() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (formId: string) => {
      if (!organization?.id) throw new Error('No organization');

      // Check if it's the default form
      const { data: form } = await supabase
        .from('forms')
        .select('is_default')
        .eq('id', formId)
        .single();

      if (form?.is_default) {
        throw new Error(tr('Não é possível eliminar o formulário principal.'));
      }

      const { error } = await supabase
        .from('forms')
        .delete()
        .eq('id', formId)
        .eq('organization_id', organization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forms'] });
      toast({
        title: tr('Formulário eliminado'),
        description: tr('O formulário foi eliminado com sucesso.'),
      });
    },
    onError: (error: any) => {
      console.error('Error deleting form:', error);
      toast({
        title: tr('Erro'),
        description: error.message || tr('Não foi possível eliminar o formulário.'),
        variant: 'destructive',
      });
    },
  });
}

export function useDuplicateForm() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (formId: string) => {
      if (!organization?.id) throw new Error('No organization');

      // Get the original form
      const { data: original, error: fetchError } = await supabase
        .from('forms')
        .select('*')
        .eq('id', formId)
        .single();

      if (fetchError) throw fetchError;

      // Generate unique slug
      const baseSlug = `${original.slug}-copia`;
      let slug = baseSlug;
      let counter = 1;
      
      while (true) {
        const { data: existing } = await supabase
          .from('forms')
          .select('id')
          .eq('organization_id', organization.id)
          .eq('slug', slug)
          .maybeSingle();
        
        if (!existing) break;
        slug = `${baseSlug}-${counter}`;
        counter++;
      }

      const { data: newForm, error } = await supabase
        .from('forms')
        .insert({
          organization_id: organization.id,
          name: `${original.name} (Cópia)`,
          slug,
          form_settings: original.form_settings,
          is_default: false,
          is_active: true,
          target_stage: original.target_stage || null,
          assigned_to: original.assigned_to || null,
          assigned_user_ids: original.assigned_user_ids || [],
          rotate_enabled: original.rotate_enabled ?? false,
          notify_all_admins: original.notify_all_admins ?? true,
          meta_pixels: original.meta_pixels || [],
          msg_template_hot: original.msg_template_hot || null,
          msg_template_warm: original.msg_template_warm || null,
          msg_template_cold: original.msg_template_cold || null,
          ai_qualification_rules: original.ai_qualification_rules || null,
        })
        .select()
        .single();

      if (error) throw error;
      return transformForm(newForm);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forms'] });
      toast({
        title: tr('Formulário duplicado'),
        description: tr('A cópia do formulário foi criada.'),
      });
    },
    onError: (error: any) => {
      console.error('Error duplicating form:', error);
      toast({
        title: tr('Erro'),
        description: tr('Não foi possível duplicar o formulário.'),
        variant: 'destructive',
      });
    },
  });
}
