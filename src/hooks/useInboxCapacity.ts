import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

const capacitySchema = z.object({ used: z.number().int().nonnegative(), limit: z.number().int().nonnegative().nullable(), remaining: z.number().int().nonnegative().nullable(), can_create: z.boolean() });

export const inboxCapacityQueryKey = (organizationId?: string) => ['inbox-capacity', organizationId] as const;

export function useInboxCapacity() {
  const { organization } = useAuth();
  return useQuery({
    queryKey: inboxCapacityQueryKey(organization?.id), enabled: Boolean(organization?.id),
    queryFn: async () => {
      if (!organization?.id) throw new Error('Organização não encontrada');
      const { data, error } = await supabase.rpc('get_inbox_capacity', { p_organization_id: organization.id });
      if (error) throw error;
      const value = capacitySchema.parse(data);
      return { used: value.used, limit: value.limit, remaining: value.remaining, canCreate: value.can_create, overLimit: value.limit !== null && value.used > value.limit };
    },
  });
}
