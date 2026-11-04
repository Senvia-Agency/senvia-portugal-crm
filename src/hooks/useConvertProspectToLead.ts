import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { tr } from '@/i18n';
import type { MarketingContact } from '@/types/marketing';

interface ConvertOptions {
  contacts: MarketingContact[];
  assignedTo?: string | null;
}

export function useConvertProspectToLead() {
  const { organization } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ contacts, assignedTo }: ConvertOptions) => {
      if (!organization?.id) throw new Error(tr('Sem organização'));

      // Resolve round-robin if no assignedTo
      let resolvedAssignedTo = assignedTo || null;
      let salesSettings: any = {};
      let members: { user_id: string }[] = [];

      if (!resolvedAssignedTo) {
        const { data: org } = await supabase
          .from('organizations')
          .select('sales_settings')
          .eq('id', organization.id)
          .single();

        salesSettings = (org?.sales_settings as any) || {};
        if (salesSettings.auto_assign_leads) {
          let membersQuery = supabase
            .from('organization_members')
            .select('user_id')
            .eq('organization_id', organization.id)
            .eq('is_active', true);
          if (salesSettings.exclude_admins_from_assignment) {
            membersQuery = membersQuery.neq('role', 'admin');
          }
          const { data: m } = await membersQuery.order('joined_at', { ascending: true });
          members = m || [];
        }
      }

      let converted = 0;
      let skipped = 0;
      let rrIndex = salesSettings.round_robin_index || 0;

      for (const contact of contacts) {
        if ((contact as any).converted_to_lead) {
          skipped++;
          continue;
        }

        let finalAssignedTo = resolvedAssignedTo;
        if (!finalAssignedTo && salesSettings.auto_assign_leads && members.length > 0) {
          const safeIndex = rrIndex % members.length;
          finalAssignedTo = members[safeIndex].user_id;
          rrIndex = (safeIndex + 1) % members.length;
        }

        // Build custom_data from prospect fields
        const prospectCustomData: Record<string, unknown> = {};
        if ((contact as any).cpe) prospectCustomData.cpe = (contact as any).cpe;
        if ((contact as any).segment) prospectCustomData.segment = (contact as any).segment;
        if ((contact as any).metadata) prospectCustomData.metadata = (contact as any).metadata;

        const insertData: any = {
            name: contact.name,
            email: contact.email || '',
            phone: contact.phone || '',
            company_name: contact.company || undefined,
            company_nif: (contact as any).nif || undefined,
            consumo_anual: (contact as any).annual_consumption_kwh || undefined,
            source: 'prospect',
            organization_id: organization.id,
            assigned_to: finalAssignedTo || undefined,
            gdpr_consent: true,
            status: 'new',
          };
        if (Object.keys(prospectCustomData).length > 0) {
          insertData.custom_data = prospectCustomData;
        }

        const { error: leadError } = await supabase
          .from('leads')
          .insert(insertData);

        if (leadError) {
          console.error('Error converting contact:', leadError);
          continue;
        }

        await supabase
          .from('marketing_contacts' as any)
          .update({ converted_to_lead: true })
          .eq('id', contact.id);

        converted++;
      }

      // Persist final round-robin index
      if (!resolvedAssignedTo && salesSettings.auto_assign_leads && members.length > 0) {
        await supabase
          .from('organizations')
          .update({ sales_settings: { ...salesSettings, round_robin_index: rrIndex } })
          .eq('id', organization.id);
      }

      return { converted, skipped };
    },
    onSuccess: ({ converted, skipped }) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['marketing-contacts'] });
      qc.invalidateQueries({ queryKey: ['contact-list-members'] });
      const msg = skipped > 0
        ? tr('{{converted}} lead(s) criada(s), {{skipped}} já convertido(s)', { converted, skipped })
        : tr('{{converted}} lead(s) criada(s) com sucesso', { converted });
      toast.success(msg);
    },
    onError: () => toast.error(tr('Erro ao converter contactos em leads')),
  });
}
