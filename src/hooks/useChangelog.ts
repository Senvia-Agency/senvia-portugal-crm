import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ChangelogEntry {
  id: string;
  title: string;
  content: string;
  version: string | null;
  image_url: string | null;
  published_at: string;
}

const SELECT = 'id, title, content, version, image_url, published_at';

// Version history for the "O que há de novo" page. Reuses app_announcements:
// entries with a `version` are release notes (the changelog); entries without
// one are maintenance notices and stay out of here. Inactive entries are
// internal drafts and must never appear on the public changelog.
export function useChangelog() {
  return useQuery({
    queryKey: ['changelog'],
    queryFn: async (): Promise<ChangelogEntry[]> => {
      const { data, error } = await (supabase as any)
        .from('app_announcements')
        .select(SELECT)
        .eq('is_active', true)
        .not('version', 'is', null)
        .order('published_at', { ascending: false });

      if (error) {
        console.error('Error fetching changelog:', error);
        return [];
      }
      return data || [];
    },
    staleTime: 10 * 60 * 1000,
  });
}

export function useChangelogEntry(id: string | undefined) {
  return useQuery({
    queryKey: ['changelog-entry', id],
    enabled: !!id,
    queryFn: async (): Promise<ChangelogEntry | null> => {
      const { data, error } = await (supabase as any)
        .from('app_announcements')
        .select(SELECT)
        .eq('id', id)
        .eq('is_active', true)
        .maybeSingle();

      if (error) {
        console.error('Error fetching changelog entry:', error);
        return null;
      }
      return data;
    },
  });
}
