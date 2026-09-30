import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import type { EmailTemplateCategoryRow } from '@/types/marketing';

/**
 * Categories are per organization and user-managed, replacing the five values
 * that used to be hardcoded in the frontend. Deleting one never touches the
 * templates that used it — they simply come back uncategorised.
 *
 * The table post-dates the generated Supabase types, so the client is cast.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = () => (supabase as any).from('email_template_categories');

export function useEmailTemplateCategories() {
  const { organization } = useAuth();
  const organizationId = organization?.id;

  return useQuery({
    queryKey: ['email-template-categories', organizationId],
    queryFn: async (): Promise<EmailTemplateCategoryRow[]> => {
      if (!organizationId) return [];

      const { data, error } = await table()
        .select('*')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) {
        console.error('Error fetching email template categories:', error);
        throw error;
      }

      return (data ?? []) as unknown as EmailTemplateCategoryRow[];
    },
    enabled: !!organizationId,
  });
}

/** A name already taken in this organization comes back as 23505. */
function isDuplicate(error: unknown): boolean {
  return (error as { code?: string })?.code === '23505';
}

export function useCreateEmailTemplateCategory() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: { name: string; color?: string }) => {
      if (!organization?.id) throw new Error('No organization');

      const { error } = await table().insert({
        organization_id: organization.id,
        name: data.name.trim(),
        color: data.color || '#6366f1',
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-template-categories'] });
      toast({ title: 'Categoria criada' });
    },
    onError: (error) => {
      console.error('Error creating email template category:', error);
      toast({
        title: isDuplicate(error) ? 'Nome já usado' : 'Erro ao criar categoria',
        description: isDuplicate(error)
          ? 'Já existe uma categoria com este nome.'
          : 'Não foi possível criar a categoria.',
        variant: 'destructive',
      });
    },
  });
}

export function useUpdateEmailTemplateCategory() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; color?: string }) => {
      const { error } = await table()
        .update({ ...data, name: data.name?.trim() })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-template-categories'] });
      toast({ title: 'Categoria atualizada' });
    },
    onError: (error) => {
      console.error('Error updating email template category:', error);
      toast({
        title: isDuplicate(error) ? 'Nome já usado' : 'Erro ao atualizar categoria',
        description: isDuplicate(error) ? 'Já existe uma categoria com este nome.' : undefined,
        variant: 'destructive',
      });
    },
  });
}

/**
 * Soft delete, like the expense categories: the row stays so any history that
 * pointed at it still resolves. Templates keep their `category_id` until the
 * row is really removed, so nothing disappears from under the user.
 */
export function useDeleteEmailTemplateCategory() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await table()
        .update({ is_active: false })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-template-categories'] });
      queryClient.invalidateQueries({ queryKey: ['email-templates'] });
      toast({ title: 'Categoria removida' });
    },
    onError: (error) => {
      console.error('Error deleting email template category:', error);
      toast({ title: 'Erro ao remover categoria', variant: 'destructive' });
    },
  });
}
