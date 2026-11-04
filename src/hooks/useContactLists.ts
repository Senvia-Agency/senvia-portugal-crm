import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { tr } from '@/i18n';
import type { MarketingContact } from '@/types/marketing';

export interface ContactList {
  id: string;
  name: string;
  description: string | null;
  organization_id: string;
  is_dynamic: boolean | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
  member_count: number;
}

export interface ContactListMember {
  id: string;
  list_id: string;
  contact_id: string;
  added_at: string;
  contact?: MarketingContact;
}

export function useContactLists() {
  const { organization } = useAuth();
  const orgId = organization?.id;

  return useQuery({
    queryKey: ['contact-lists', orgId],
    queryFn: async () => {
      if (!orgId) return [];

      const { data: lists, error } = await supabase
        .from('client_lists')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Get member counts from marketing_list_members
      const { data: members, error: membersError } = await supabase
        .from('marketing_list_members' as any)
        .select('list_id');

      if (membersError) throw membersError;

      const countMap = new Map<string, number>();
      (members as any[])?.forEach((m: any) => {
        countMap.set(m.list_id, (countMap.get(m.list_id) || 0) + 1);
      });

      return lists.map(list => ({
        ...list,
        member_count: countMap.get(list.id) || 0,
      })) as ContactList[];
    },
    enabled: !!orgId,
  });
}

export function useContactListMembers(listId: string | null) {
  return useQuery({
    queryKey: ['contact-list-members', listId],
    queryFn: async () => {
      if (!listId) return [];

      const { data, error } = await supabase
        .from('marketing_list_members' as any)
        .select('*, contact:marketing_contacts(id, name, email, phone, company, source, subscribed, converted_to_lead)')
        .eq('list_id', listId)
        .order('added_at', { ascending: false });

      if (error) throw error;
      return data as unknown as ContactListMember[];
    },
    enabled: !!listId,
  });
}

export function useCreateContactList() {
  const { organization } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ name, description }: { name: string; description?: string }) => {
      const { data, error } = await supabase
        .from('client_lists')
        .insert({ name, description: description || null, organization_id: organization!.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact-lists'] });
      toast.success(tr('Lista criada com sucesso'));
    },
    onError: () => toast.error(tr('Erro ao criar lista')),
  });
}

export function useUpdateContactList() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, name, description }: { id: string; name: string; description?: string }) => {
      const { error } = await supabase
        .from('client_lists')
        .update({ name, description: description || null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact-lists'] });
      toast.success(tr('Lista atualizada'));
    },
    onError: () => toast.error(tr('Erro ao atualizar lista')),
  });
}

export function useDeleteContactList() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      // Delete marketing members first
      await supabase.from('marketing_list_members' as any).delete().eq('list_id', id);
      const { error } = await supabase.from('client_lists').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact-lists'] });
      toast.success(tr('Lista eliminada'));
    },
    onError: () => toast.error(tr('Erro ao eliminar lista')),
  });
}

export function useAddListMembers() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ listId, contactIds }: { listId: string; contactIds: string[] }) => {
      const rows = contactIds.map(contact_id => ({ list_id: listId, contact_id }));
      const { error } = await supabase
        .from('marketing_list_members' as any)
        .upsert(rows, { onConflict: 'list_id,contact_id', ignoreDuplicates: true });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact-list-members'] });
      qc.invalidateQueries({ queryKey: ['contact-lists'] });
      toast.success(tr('Contactos adicionados'));
    },
    onError: () => toast.error(tr('Erro ao adicionar contactos')),
  });
}

export function useRemoveListMember() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ listId, contactId }: { listId: string; contactId: string }) => {
      const { error } = await supabase
        .from('marketing_list_members' as any)
        .delete()
        .eq('list_id', listId)
        .eq('contact_id', contactId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact-list-members'] });
      qc.invalidateQueries({ queryKey: ['contact-lists'] });
      toast.success(tr('Contacto removido da lista'));
    },
    onError: () => toast.error(tr('Erro ao remover contacto')),
  });
}

export function useMarketingContacts() {
  const { organization } = useAuth();
  const orgId = organization?.id;

  return useQuery({
    queryKey: ['marketing-contacts', orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from('marketing_contacts' as any)
        .select('*')
        .eq('organization_id', orgId)
        .eq('subscribed', true)
        .order('name');
      if (error) throw error;
      return data as unknown as MarketingContact[];
    },
    enabled: !!orgId,
  });
}
