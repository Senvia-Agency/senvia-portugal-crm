import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { automaticReceiptState } from '@/lib/fiscal-automation';

// The fiscal ledger columns (processing/email state) are newer than the generated types.
const db = supabase as unknown as { from: (table: string) => any };

export interface AutomaticReceiptJob {
  id: string;
  payment_id: string;
  processing_status: string;
  processing_last_error: string | null;
  reference: string | null;
  email_status: string;
  email_last_error: string | null;
}

/** Automatic receipts (non-recurring sales) of these payments, by payment id. */
export function useAutomaticReceipts(paymentIds: readonly string[]) {
  const { organization } = useAuth();
  const ids = [...new Set(paymentIds)].sort();
  return useQuery({
    queryKey: ['automatic-receipts', organization?.id, ids.join(',')],
    enabled: !!organization?.id && ids.length > 0,
    queryFn: async (): Promise<Map<string, AutomaticReceiptJob>> => {
      const jobs = new Map<string, AutomaticReceiptJob>();
      for (let start = 0; start < ids.length; start += 150) {
        const { data, error } = await db.from('invoices')
          .select('id, payment_id, processing_status, processing_last_error, reference, email_status, email_last_error, created_at')
          .eq('organization_id', organization!.id)
          .in('payment_id', ids.slice(start, start + 150))
          .eq('fiscal_snapshot->>origin', 'automatic_sale_receipt')
          .order('created_at', { ascending: false });
        if (error) throw error;
        // The newest job of a payment is the one that counts.
        for (const job of (data ?? []) as AutomaticReceiptJob[]) if (!jobs.has(job.payment_id)) jobs.set(job.payment_id, job);
      }
      return jobs;
    },
    // While a receipt is on its way, check again every 30 seconds.
    refetchInterval: (query) => {
      const jobs = query.state.data as Map<string, AutomaticReceiptJob> | undefined;
      const moving = [...(jobs?.values() ?? [])].some((job) => {
        const state = automaticReceiptState(job.processing_status);
        return state === 'queued' || state === 'processing' || state === 'retry'
          || (state === 'issued' && ['pending', 'processing', 'retry'].includes(job.email_status));
      });
      return moving ? 30_000 : false;
    },
  });
}
