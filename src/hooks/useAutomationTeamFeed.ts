import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

export type AutomationTeamFeedPost = Tables<'organization_feed_posts'>;

export function useAutomationTeamFeed() {
  const { user, organization } = useAuth();
  const organizationId = organization?.id;
  return useQuery({
    queryKey: ['organization-feed-posts', user?.id, organizationId],
    enabled: !!user && !!organizationId,
    queryFn: async (): Promise<readonly AutomationTeamFeedPost[]> => {
      if (!user || !organizationId) return [];
      const { data, error } = await supabase.from('organization_feed_posts')
        .select('id,organization_id,title,body,source_flow_id,source_run_id,source_node_id,source_flow_name,author_id,created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
    staleTime: 30000,
  });
}
