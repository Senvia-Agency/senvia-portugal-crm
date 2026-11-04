import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { tr } from '@/i18n';
import type { BankAccount, BankAccountTransaction } from '@/types/bank-accounts';

export function useBankAccounts() {
  const { organization } = useAuth();
  const orgId = organization?.id;

  return useQuery({
    queryKey: ['bank-accounts', orgId],
    queryFn: async (): Promise<BankAccount[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as BankAccount[];
    },
    enabled: !!orgId,
  });
}

export function useActiveBankAccounts() {
  const { organization } = useAuth();
  const orgId = organization?.id;

  return useQuery({
    queryKey: ['bank-accounts-active', orgId],
    queryFn: async (): Promise<BankAccount[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .order('name', { ascending: true });
      if (error) throw error;
      return data as BankAccount[];
    },
    enabled: !!orgId,
  });
}

interface CreateBankAccountData {
  name: string;
  bank_name?: string | null;
  iban?: string | null;
  holder_name?: string | null;
  initial_balance: number;
  is_default?: boolean;
}

export function useCreateBankAccount() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CreateBankAccountData) => {
      if (!organization?.id) throw new Error('No organization');

      // If setting as default, unset others first
      if (data.is_default) {
        await supabase
          .from('bank_accounts')
          .update({ is_default: false })
          .eq('organization_id', organization.id);
      }

      const { error } = await supabase.from('bank_accounts').insert({
        organization_id: organization.id,
        name: data.name,
        bank_name: data.bank_name || null,
        iban: data.iban || null,
        holder_name: data.holder_name || null,
        initial_balance: data.initial_balance,
        is_default: data.is_default || false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts-active'] });
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      toast({ title: tr('Conta corrente criada com sucesso!') });
    },
    onError: () => {
      toast({ title: tr('Erro ao criar conta corrente'), variant: 'destructive' });
    },
  });
}

interface UpdateBankAccountData extends Partial<CreateBankAccountData> {
  id: string;
  is_active?: boolean;
}

export function useUpdateBankAccount() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateBankAccountData) => {
      if (!organization?.id) throw new Error('No organization');

      if (data.is_default) {
        await supabase
          .from('bank_accounts')
          .update({ is_default: false })
          .eq('organization_id', organization.id);
      }

      const { error } = await supabase
        .from('bank_accounts')
        .update(data)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts-active'] });
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['bank-balance'] });
      toast({ title: tr('Conta corrente atualizada!') });
    },
    onError: () => {
      toast({ title: tr('Erro ao atualizar conta'), variant: 'destructive' });
    },
  });
}

export function useBankAccountTransactions(accountId: string | null) {
  const { organization } = useAuth();
  const orgId = organization?.id;

  return useQuery({
    queryKey: ['bank-transactions', accountId],
    queryFn: async (): Promise<BankAccountTransaction[]> => {
      if (!orgId || !accountId) return [];
      const { data, error } = await supabase
        .from('bank_account_transactions')
        .select('*')
        .eq('bank_account_id', accountId)
        .eq('organization_id', orgId)
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as BankAccountTransaction[];
    },
    enabled: !!orgId && !!accountId,
  });
}

export function useBankAccountBalance(accountId: string | null) {
  const { organization } = useAuth();
  const orgId = organization?.id;

  return useQuery({
    queryKey: ['bank-balance', accountId],
    queryFn: async (): Promise<number> => {
      if (!orgId || !accountId) return 0;
      const { data, error } = await supabase
        .from('bank_account_transactions')
        .select('amount')
        .eq('bank_account_id', accountId)
        .eq('organization_id', orgId);
      if (error) throw error;
      return (data || []).reduce((sum, t) => sum + Number(t.amount), 0);
    },
    enabled: !!orgId && !!accountId,
  });
}

interface CreateBankTransactionData {
  bank_account_id: string;
  amount: number;
  description: string;
  transaction_date: string;
}

export function useCreateBankTransaction() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CreateBankTransactionData) => {
      if (!organization?.id) throw new Error('No organization');

      // Get current balance for running_balance
      const { data: txns, error: balErr } = await supabase
        .from('bank_account_transactions')
        .select('amount')
        .eq('bank_account_id', data.bank_account_id)
        .eq('organization_id', organization.id);
      if (balErr) throw balErr;
      const currentBalance = (txns || []).reduce((sum, t) => sum + Number(t.amount), 0);

      const { error } = await supabase.from('bank_account_transactions').insert({
        organization_id: organization.id,
        bank_account_id: data.bank_account_id,
        type: 'adjustment',
        amount: data.amount,
        running_balance: currentBalance + data.amount,
        description: data.description,
        transaction_date: data.transaction_date,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['bank-balance'] });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts-active'] });
      toast({ title: tr('Receita registada com sucesso!') });
    },
    onError: () => {
      toast({ title: tr('Erro ao registar receita'), variant: 'destructive' });
    },
  });
}
