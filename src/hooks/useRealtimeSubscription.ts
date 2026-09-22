import { useEffect } from 'react';
import { useQueryClient, QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { SALE_FINANCE_QUERY_KEYS } from '@/lib/sale-finance-cache';

type TableName = 'leads' | 'proposals' | 'sales';

interface RealtimeConfig {
  table: TableName;
  queryKeys: string[][];
}

// How long to wait after the last realtime event before refetching. A bulk
// operation (e.g. importing thousands of leads) fires one event per row;
// debouncing collapses that burst into a single refetch instead of thousands.
const REALTIME_DEBOUNCE_MS = 400;

/**
 * Returns a debounced function that invalidates the given query keys.
 * Multiple calls within the debounce window result in a single invalidation.
 */
function createDebouncedInvalidator(queryClient: QueryClient, queryKeys: string[][]) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    queryKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
  };
  const trigger = () => {
    if (timer) return;
    timer = setTimeout(flush, REALTIME_DEBOUNCE_MS);
  };
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return { trigger, cancel };
}

/**
 * Hook to subscribe to Supabase Realtime changes and invalidate React Query cache
 */
export function useRealtimeSubscription(configs: RealtimeConfig[]) {
  const queryClient = useQueryClient();
  const { organization } = useAuth();

  useEffect(() => {
    if (!organization?.id) return;

    const leads = createDebouncedInvalidator(queryClient, [
      ['leads'],
      ['dashboard-stats'],
      ['lead-proposal-values'],
    ]);
    const proposals = createDebouncedInvalidator(queryClient, [
      ['proposals'],
      ['dashboard-stats'],
      ['lead-proposal-values'],
    ]);
    const sales = createDebouncedInvalidator(queryClient, [
      ['sales'],
      ['dashboard-stats'],
      ...SALE_FINANCE_QUERY_KEYS,
    ]);

    const channel = supabase
      .channel('db-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'leads',
          filter: `organization_id=eq.${organization.id}`,
        },
        leads.trigger
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'proposals',
          filter: `organization_id=eq.${organization.id}`,
        },
        proposals.trigger
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sales',
          filter: `organization_id=eq.${organization.id}`,
        },
        sales.trigger
      )
      .subscribe();

    return () => {
      leads.cancel();
      proposals.cancel();
      sales.cancel();
      supabase.removeChannel(channel);
    };
  }, [organization?.id, queryClient]);
}

/**
 * Hook specifically for leads realtime updates
 */
export function useLeadsRealtime() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();

  useEffect(() => {
    if (!organization?.id) return;

    const { trigger, cancel } = createDebouncedInvalidator(queryClient, [
      ['leads'],
      ['lead-proposal-values'],
    ]);

    const channel = supabase
      .channel('leads-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'leads',
          filter: `organization_id=eq.${organization.id}`,
        },
        trigger
      )
      .subscribe();

    return () => {
      cancel();
      supabase.removeChannel(channel);
    };
  }, [organization?.id, queryClient]);
}

/**
 * Hook specifically for proposals realtime updates
 */
export function useProposalsRealtime() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();

  useEffect(() => {
    if (!organization?.id) return;

    const { trigger, cancel } = createDebouncedInvalidator(queryClient, [
      ['proposals'],
      ['lead-proposal-values'],
    ]);

    const channel = supabase
      .channel('proposals-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'proposals',
          filter: `organization_id=eq.${organization.id}`,
        },
        trigger
      )
      .subscribe();

    return () => {
      cancel();
      supabase.removeChannel(channel);
    };
  }, [organization?.id, queryClient]);
}

/**
 * Hook specifically for sales realtime updates
 */
export function useSalesRealtime() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();

  useEffect(() => {
    if (!organization?.id) return;

    const { trigger, cancel } = createDebouncedInvalidator(queryClient, [
      ['sales'],
      ...SALE_FINANCE_QUERY_KEYS,
    ]);

    const channel = supabase
      .channel('sales-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sales',
          filter: `organization_id=eq.${organization.id}`,
        },
        trigger
      )
      .subscribe();

    return () => {
      cancel();
      supabase.removeChannel(channel);
    };
  }, [organization?.id, queryClient]);
}
