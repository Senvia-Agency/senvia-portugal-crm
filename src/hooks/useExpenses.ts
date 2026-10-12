import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import type { Expense, ExpenseCategory } from '@/types/expenses';
import type { RecurrenceSchedule } from '@/lib/expense-recurrence';

interface ExpenseWithCategory extends Expense {
  expense_categories: ExpenseCategory | null;
}

export function useExpenses() {
  const { organization } = useAuth();
  const organizationId = organization?.id;

  return useQuery({
    queryKey: ['expenses', organizationId],
    queryFn: async (): Promise<Expense[]> => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from('expenses')
        .select(`
          *,
          expense_categories (*)
        `)
        .eq('organization_id', organizationId)
        .order('expense_date', { ascending: false });

      if (error) {
        console.error('Error fetching expenses:', error);
        throw error;
      }

      return (data as ExpenseWithCategory[]).map((expense) => ({
        ...expense,
        category: expense.expense_categories || undefined,
      }));
    },
    enabled: !!organizationId,
  });
}

interface CreateExpenseData {
  category_id?: string | null;
  description: string;
  amount: number;
  expense_date: string;
  is_recurring?: boolean;
  /** How it repeats. On update: undefined leaves the saved schedule alone (a
   * pause keeps it), null removes it, a schedule replaces it. */
  recurrence?: RecurrenceSchedule | null;
  notes?: string | null;
  receipt_file_url?: string | null;
  bank_account_id?: string | null;
}

/** The schedule columns to save. The next date is the database's job: a
 * trigger works it out from these (expense_recurrence_next). */
function recurrenceColumns(isRecurring: boolean | undefined, schedule: RecurrenceSchedule | null | undefined) {
  if (!isRecurring || !schedule) {
    return { recurrence_frequency: null, recurrence_day: null, recurrence_month: null };
  }
  return {
    recurrence_frequency: schedule.frequency,
    recurrence_day: schedule.day,
    recurrence_month: schedule.frequency === 'yearly' ? schedule.month : null,
  };
}

export function useCreateExpense() {
  const { organization, session } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CreateExpenseData) => {
      if (!organization?.id) throw new Error('No organization');

      const { error } = await supabase.from('expenses').insert({
        organization_id: organization.id,
        category_id: data.category_id || null,
        description: data.description,
        amount: data.amount,
        expense_date: data.expense_date,
        is_recurring: data.is_recurring || false,
        notes: data.notes || null,
        receipt_file_url: data.receipt_file_url || null,
        created_by: session?.user?.id || null,
        bank_account_id: data.bank_account_id || null,
        ...recurrenceColumns(data.is_recurring, data.recurrence),
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expenses-stats'] });
      queryClient.invalidateQueries({ queryKey: ['finance-stats'] });
      toast({ title: 'Despesa registada com sucesso!' });
    },
    onError: (error) => {
      console.error('Error creating expense:', error);
      toast({
        title: 'Erro ao registar despesa',
        description: 'Não foi possível registar a despesa.',
        variant: 'destructive',
      });
    },
  });
}

interface UpdateExpenseData extends Partial<CreateExpenseData> {
  id: string;
}

export function useUpdateExpense() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, recurrence, ...data }: UpdateExpenseData) => {
      // Pausing or resuming only flips is_recurring and keeps the schedule;
      // the database moves the next date to match either way.
      const updates: TablesUpdate<'expenses'> = {
        ...data,
        ...(recurrence !== undefined ? recurrenceColumns(data.is_recurring ?? true, recurrence) : {}),
      };

      const { error } = await supabase
        .from('expenses')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expenses-stats'] });
      queryClient.invalidateQueries({ queryKey: ['finance-stats'] });
      toast({ title: 'Despesa atualizada!' });
    },
    onError: (error) => {
      console.error('Error updating expense:', error);
      toast({
        title: 'Erro ao atualizar despesa',
        variant: 'destructive',
      });
    },
  });
}

export function useDeleteExpense() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('expenses').delete().eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expenses-stats'] });
      queryClient.invalidateQueries({ queryKey: ['finance-stats'] });
      toast({ title: 'Despesa removida!' });
    },
    onError: (error) => {
      console.error('Error deleting expense:', error);
      toast({
        title: 'Erro ao remover despesa',
        variant: 'destructive',
      });
    },
  });
}
