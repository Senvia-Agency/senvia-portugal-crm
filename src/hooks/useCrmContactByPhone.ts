import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface CrmContactMatch {
  kind: 'client' | 'lead';
  id: string;
  name: string | null;
  email: string | null;
  /** Lead: pipeline stage key. Client: its status. */
  status: string | null;
  /** Lead's estimated value. */
  value: number | null;
  /** Client's code. */
  code: string | null;
}

/** The last 9 digits — "+351 912 345 678", "912345678" and "351912345678" are one number. */
export const phoneKey = (phone: string | null | undefined) => {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : null;
};

/**
 * The client — or, failing that, the lead — of this organization with this
 * phone. Phones are stored with and without the country code and with
 * spaces, so the database is asked for the nine digits in order and each hit
 * is confirmed by its key. A client wins over a lead: it is the further-along
 * record of the same person.
 */
export function useCrmContactByPhone(phone: string | null | undefined) {
  const { organization } = useAuth();
  const key = phoneKey(phone);

  return useQuery({
    queryKey: ['crm-contact-by-phone', organization?.id, key],
    enabled: !!organization?.id && !!key,
    staleTime: 60_000,
    queryFn: async (): Promise<CrmContactMatch | null> => {
      const pattern = `%${key!.split('').join('%')}%`;
      const [clients, leads] = await Promise.all([
        supabase.from('crm_clients').select('id, name, email, phone, status, code')
          .eq('organization_id', organization!.id).ilike('phone', pattern).limit(20),
        supabase.from('leads').select('id, name, email, phone, status, value')
          .eq('organization_id', organization!.id).ilike('phone', pattern)
          .order('created_at', { ascending: false }).limit(20),
      ]);
      if (clients.error) throw clients.error;
      if (leads.error) throw leads.error;

      const client = (clients.data ?? []).find((c) => phoneKey(c.phone) === key);
      if (client) {
        return {
          kind: 'client', id: client.id, name: client.name, email: client.email,
          status: client.status ?? null, value: null, code: client.code ?? null,
        };
      }
      const lead = (leads.data ?? []).find((l) => phoneKey(l.phone) === key);
      if (lead) {
        return {
          kind: 'lead', id: lead.id, name: lead.name, email: lead.email,
          status: lead.status ?? null, value: lead.value != null ? Number(lead.value) : null, code: null,
        };
      }
      return null;
    },
  });
}
