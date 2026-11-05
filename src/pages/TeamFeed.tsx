import { useAuth } from '@/contexts/AuthContext';
import { AutomationTeamFeed } from '@/components/automations/AutomationTeamFeed';
import { useAutomationTeamFeed } from '@/hooks/useAutomationTeamFeed';

export default function TeamFeed() {
  const { organization } = useAuth();
  const feed = useAutomationTeamFeed();
  if (!organization) return <p className="p-6 text-sm text-muted-foreground">Selecione uma organização para consultar o feed da equipa.</p>;
  return <div className="mx-auto w-full max-w-4xl p-4 pb-20 md:p-6 md:pb-6 lg:p-8">
    <AutomationTeamFeed posts={feed.data ?? []} isLoading={feed.isLoading} isRefreshing={feed.isRefetching} hasError={feed.isError} onRefresh={() => { void feed.refetch(); }} />
  </div>;
}
