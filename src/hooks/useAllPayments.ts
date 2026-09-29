import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { PaymentWithSale } from '@/types/finance';
import type { PaymentMethod, PaymentRecordStatus } from '@/types/sales';

export function useAllPayments() {
  const { organization } = useAuth();
  const organizationId = organization?.id;

  return useQuery({
    queryKey: ['all-payments', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from('sale_payments')
        .select(`
          *,
          sales:sale_id!inner (
            id,
            code,
            status,
            total_value,
            gross_value,
            invoice_reference,
            invoicexpress_id,
            invoicexpress_type,
            credit_note_id,
            credit_note_reference,
            invoice_pdf_url,
            leads:lead_id (name),
            crm_clients:client_id (name, email, nif)
          )
        `)
        .eq('organization_id', organizationId)
        .order('payment_date', { ascending: false });

      if (error) {
        console.error('Error fetching payments:', error);
        throw error;
      }

      return (data || []).map((payment): PaymentWithSale => {
        const fiscalPayment = payment as unknown as {
          reversal_status?: string | null;
          reversed_amount?: number | null;
        };
        return ({
        id: payment.id,
        organization_id: payment.organization_id,
        sale_id: payment.sale_id,
        amount: Number(payment.amount),
        payment_date: payment.payment_date,
        payment_method: payment.payment_method as PaymentMethod | null,
        invoice_reference: payment.invoice_reference,
        invoice_file_url: payment.invoice_file_url,
        invoicexpress_id: (payment as any).invoicexpress_id || null,
        credit_note_id: (payment as any).credit_note_id || null,
        credit_note_reference: (payment as any).credit_note_reference || null,
        status: payment.status as PaymentRecordStatus,
        reversal_status: fiscalPayment.reversal_status ?? 'none',
        reversed_amount: Number(fiscalPayment.reversed_amount ?? 0),
        notes: payment.notes,
        billing_period_start: (payment as any).billing_period_start ?? null,
        billing_period_end: (payment as any).billing_period_end ?? null,
        created_at: payment.created_at,
        updated_at: payment.updated_at,
        sale: {
          id: payment.sales?.id || '',
          code: payment.sales?.code || '',
          total_value: Number(payment.sales?.total_value || 0),
          gross_value: payment.sales?.gross_value == null
            ? null
            : Number(payment.sales.gross_value),
          invoice_reference: (payment.sales as any)?.invoice_reference || null,
          invoicexpress_id: (payment.sales as any)?.invoicexpress_id || null,
          invoicexpress_type: (payment.sales as any)?.invoicexpress_type || null,
          credit_note_id: (payment.sales as any)?.credit_note_id || null,
          credit_note_reference: (payment.sales as any)?.credit_note_reference || null,
          invoice_pdf_url: (payment.sales as any)?.invoice_pdf_url || null,
        },
        client_name: payment.sales?.crm_clients?.name || null,
        lead_name: payment.sales?.leads?.name || null,
        client_email: (payment.sales?.crm_clients as any)?.email || null,
        client_nif: (payment.sales?.crm_clients as any)?.nif || null,
        });
      });
    },
    enabled: !!organizationId,
  });
}
