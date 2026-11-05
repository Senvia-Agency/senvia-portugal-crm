import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { AutomationPreviewContact } from '@/lib/automation-preview-context';
export interface AutomationToolContact extends AutomationPreviewContact {
  readonly id: string;
  readonly subjectType: 'lead' | 'client';
}
export function useAutomationToolContacts(enabled: boolean, search = '') {
  const { organization } = useAuth();
  const organizationId = organization?.id;
  return useQuery({
    queryKey: ['automation-tool-contacts', organizationId, search.trim()], enabled: enabled && !!organizationId,
    queryFn: async (): Promise<readonly AutomationToolContact[]> => {
      if (!organizationId) return [];
      const [leads, clients] = await Promise.all([
        supabase.from('leads').select('id,name,email,phone,company_name,company_nif,source').eq('organization_id', organizationId).ilike('name', `%${search.trim()}%`).order('name').limit(100),
        supabase.from('crm_clients').select('id,name,email,phone,company,company_nif,nif,source').eq('organization_id', organizationId).ilike('name', `%${search.trim()}%`).order('name').limit(100),
      ]);
      if (leads.error) throw leads.error;
      if (clients.error) throw clients.error;
      return [
        ...(leads.data ?? []).map(contact => ({ id: contact.id, name: contact.name || 'Lead sem nome', email: contact.email, phone: contact.phone, company: contact.company_name, companyNif: contact.company_nif, source: contact.source, subjectType: 'lead' as const })),
        ...(clients.data ?? []).map(contact => ({ id: contact.id, name: contact.name || 'Cliente sem nome', email: contact.email, phone: contact.phone, company: contact.company, companyNif: contact.company_nif, nif: contact.nif, source: contact.source, subjectType: 'client' as const })),
      ];
    },
  });
}
