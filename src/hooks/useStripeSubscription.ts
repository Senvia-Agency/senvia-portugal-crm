import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

interface SubscriptionStatus {
  subscribed: boolean;
  plan_id: string | null;
  product_id?: string | null;
  subscription_end: string | null;
  billing_exempt?: boolean;
  on_trial?: boolean;
  trial_ends_at?: string;
  trial_expired?: boolean;
  days_remaining?: number;
  payment_failed_at?: string | null;
  /** True when a paying customer is overdue but still inside the grace window — show the warning banner, NOT the blocker. */
  payment_overdue?: boolean;
  /** Filled the moment the org makes its first Stripe payment. Once set, this org is never treated as a trial again. */
  first_paid_at?: string | null;
  /** End of the current paid Stripe period. Display only ("next renewal"). */
  current_period_end?: string | null;
  /** True when a paying customer is past their grace window. The plan-renewal blocker is keyed off this. */
  plan_expired?: boolean;
  /** When access will be blocked (failure date + grace). Drives the countdown banner. */
  block_at?: string | null;
  /** Whole days left before the block. */
  days_until_block?: number | null;
  status?: string;
  /** Extra seats purchased beyond the base plan limit. */
  extra_seats?: number;
  /** Base user limit for the current plan. */
  plan_base_users?: number;
  /** Number of active members in the org. */
  active_members?: number;
  /** Total allowed users (base + extra_seats or max_users_override). */
  max_users?: number;
}

export function useStripeSubscription() {
  const { toast } = useToast();
  const { user, organization, needsOrgSelection } = useAuth();
  // Isolated to the checkout/portal redirects — the status itself is driven by
  // React Query below, so all consumers share a single fetch + auto re-check.
  const [isLoading, setIsLoading] = useState(false);

  const query = useQuery<SubscriptionStatus | null>({
    queryKey: ['stripe-subscription', organization?.id ?? null],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('check-subscription', { body: { organization_id: organization?.id } });
      if (error) throw error;
      return data as SubscriptionStatus;
    },
    enabled: !!user && !needsOrgSelection,
    staleTime: 1000 * 60,            // 1 min — avoid hammering on quick remounts
    refetchInterval: 1000 * 60 * 5,  // re-check every 5 min so a live session blocks without a reload
    refetchOnWindowFocus: true,      // re-check when the user comes back to the tab
  });

  // Kept for callers that want to force a refresh (e.g. after returning from
  // the Stripe checkout). Returns the freshest status.
  const checkSubscription = useCallback(async () => {
    const { data } = await query.refetch();
    return data ?? null;
  }, [query]);

  const createCheckout = useCallback(async (priceId: string) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { priceId, organization_id: organization?.id },
      });
      if (error) throw error;
      if (data?.url) {
        const isPWA = window.matchMedia('(display-mode: standalone)').matches;
        if (isPWA) {
          window.location.href = data.url;
        } else {
          window.open(data.url, '_blank');
        }
      }
    } catch (error) {
      console.error('Error creating checkout:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível iniciar o checkout. Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast, organization?.id]);

  const openCustomerPortal = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('customer-portal', { body: { organization_id: organization?.id } });
      if (error) throw error;
      if (data?.url) {
        const isPWA = window.matchMedia('(display-mode: standalone)').matches;
        if (isPWA) {
          window.location.href = data.url;
        } else {
          window.open(data.url, '_blank');
        }
      }
    } catch (error) {
      console.error('Error opening customer portal:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível abrir o portal de faturação.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast, organization?.id]);

  return {
    isLoading,
    subscriptionStatus: query.data ?? null,
    /** True once the first subscription check has resolved. */
    hasChecked: query.isFetched,
    checkSubscription,
    createCheckout,
    openCustomerPortal,
  };
}
