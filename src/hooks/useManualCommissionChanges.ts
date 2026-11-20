import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { FormulaToken } from '@/lib/manual-commission';

/**
 * One change to a manual-commission sum, written by the database whenever a
 * sale is saved with a different sum (sale_manual_commission_changes). The
 * screen only reads it; nobody can write or delete it through the API.
 */
export interface ManualCommissionChange {
  id: string;
  sale_id: string;
  product_name: string;
  old_formula: FormulaToken[] | null;
  new_formula: FormulaToken[] | null;
  old_amount: number | null;
  new_amount: number | null;
  changed_by: string | null;
  /** Why it was corrected (update_sale_manual_commission). Null when entered on the sale itself. */
  reason: string | null;
  changed_at: string;
}

/** 42P01 / PGRST205: the table is not there yet (migration not applied). */
function isMissingTable(error: { code?: string } | null): boolean {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205');
}

export function useManualCommissionChanges(saleId?: string | null, enabled = true) {
  const { organization } = useAuth();
  return useQuery<ManualCommissionChange[]>({
    // 'sales' prefix: refreshed together with the sale after an edit.
    queryKey: ['sales', 'manual-commission-changes', saleId],
    queryFn: async () => {
      if (!saleId) return [];
      // Not in the generated types until the migration is applied.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('sale_manual_commission_changes')
        .select('id, sale_id, product_name, old_formula, new_formula, old_amount, new_amount, changed_by, reason, changed_at')
        .eq('sale_id', saleId)
        .order('changed_at', { ascending: false });
      if (isMissingTable(error)) return [];
      if (error) throw error;
      return (data || []) as ManualCommissionChange[];
    },
    enabled: enabled && !!organization?.id && !!saleId,
  });
}
