import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export function useNativeTaskSuggestions(conversationId: string | undefined, latestMessageId: string | undefined, enabled: boolean) {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['native-task-suggestions', organization?.id, conversationId, latestMessageId],
    enabled: enabled && !!organization?.id && !!conversationId && !!latestMessageId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('inbox-task-suggestions', {
        body: { conversation_id: conversationId },
      });
      if (error) throw new Error('Não foi possível analisar esta conversa. Tenta novamente.');
      const payload: unknown = data;
      if (!payload || typeof payload !== 'object' || !('ok' in payload) || payload.ok !== true) {
        throw new Error('Não foi possível analisar esta conversa. Tenta novamente.');
      }
      await queryClient.invalidateQueries({ queryKey: ['inbox-tasks', organization?.id] });
      return { analyzed: 'analyzed' in payload && typeof payload.analyzed === 'number' ? payload.analyzed : 0,
        suggested: 'suggested' in payload && typeof payload.suggested === 'number' ? payload.suggested : 0 };
    },
  });
}
