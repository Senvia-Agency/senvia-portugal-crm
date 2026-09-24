import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface InvoiceRow {
  id: string;
  organization_id: string;
  invoicexpress_id: number | null;
  provider: string;
  reference: string | null;
  document_type: string;
  status: string | null;
  client_name: string | null;
  total: number;
  date: string | null;
  due_date: string | null;
  sale_id: string | null;
  payment_id: string | null;
  pdf_path: string | null;
  raw_data: any;
  created_at: string;
  updated_at: string;
  credit_note_reference: string | null;
}

export function useInvoices() {
  const { organization } = useAuth();
  const organizationId = organization?.id;

  return useQuery({
    queryKey: ['invoices', organizationId],
    queryFn: async (): Promise<InvoiceRow[]> => {
      if (!organizationId) return [];

      const { data, error } = await (supabase as any)
        .from('invoices')
        .select('*')
        .eq('organization_id', organizationId)
        .order('date', { ascending: false });

      if (error) {
        console.error('Error fetching invoices:', error);
        throw error;
      }

      const invoices = (data || []).map((row: any) => ({
        id: row.id,
        organization_id: row.organization_id,
        invoicexpress_id: row.invoicexpress_id,
        provider: row.provider || row.raw_data?.source || 'invoicexpress',
        reference: row.reference,
        document_type: row.document_type || 'invoice',
        status: row.status,
        client_name: row.client_name,
        total: Number(row.total || 0),
        date: row.date,
        due_date: row.due_date,
        sale_id: row.sale_id,
        payment_id: row.payment_id,
        pdf_path: row.pdf_path,
        raw_data: row.raw_data,
        created_at: row.created_at,
        updated_at: row.updated_at,
        credit_note_reference: null as string | null,
      }));

      // Fetch credit notes that reference these invoices
      const ixIds = invoices
        .filter((invoice: InvoiceRow) => invoice.provider === 'invoicexpress')
        .map((invoice: InvoiceRow) => invoice.invoicexpress_id)
        .filter((id): id is number => id != null);
      if (ixIds.length > 0) {
        const { data: cnData } = await (supabase as any)
          .from('credit_notes')
          .select('related_invoice_id, reference')
          .eq('organization_id', organizationId)
          .in('related_invoice_id', ixIds);

        if (cnData && cnData.length > 0) {
          const cnMap = new Map<number, string>();
          for (const cn of cnData) {
            if (cn.related_invoice_id && cn.reference) {
              cnMap.set(cn.related_invoice_id, cn.reference);
            }
          }
          for (const inv of invoices) {
            if (inv.provider === 'invoicexpress' && inv.invoicexpress_id != null) {
              inv.credit_note_reference = cnMap.get(inv.invoicexpress_id) || null;
            }
          }
        }
      }

      return invoices;
    },
    enabled: !!organizationId,
  });
}

export function useSyncInvoices() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const res = await supabase.functions.invoke('sync-invoices', {
        body: { organization_id: organization!.id },
      });

      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);
      return res.data as { total: number; matched: number; not_matched: number; failed?: number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['all-payments'] });
    },
    onError: (error: Error) => {
      // Suppress toast for unconfigured credentials
      if (error.message?.includes('não configuradas') || error.message?.includes('not configured')) return;
      toast({
        title: 'Erro na sincronização',
        description: error.message || 'Não foi possível sincronizar faturas.',
        variant: 'destructive',
      });
    },
  });
}
