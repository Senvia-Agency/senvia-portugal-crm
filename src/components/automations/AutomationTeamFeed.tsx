import { AlertCircle, RefreshCw, Rss, Workflow } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/format';
import type { AutomationTeamFeedPost } from '@/hooks/useAutomationTeamFeed';

export function AutomationTeamFeed({ posts, isLoading = false, isRefreshing = false, hasError = false, onRefresh }: {
  readonly posts: readonly AutomationTeamFeedPost[];
  readonly isLoading?: boolean;
  readonly isRefreshing?: boolean;
  readonly hasError?: boolean;
  readonly onRefresh: () => void;
}) {
  return <>
    <PageHeader icon={Rss} title="Feed da equipa" subtitle="Publicações das automações da sua organização."
      actions={<Button type="button" variant="outline" size="sm" disabled={isLoading || isRefreshing} onClick={onRefresh}>
        <RefreshCw aria-hidden="true" className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} />
        {isRefreshing ? 'A atualizar…' : 'Atualizar'}
      </Button>} />
    {hasError && <div role="alert" className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <p>Não foi possível carregar o feed. Tente atualizar.{posts.length > 0 && ' As publicações apresentadas podem estar desatualizadas.'}</p>
    </div>}
    {isLoading ? <div role="status" aria-label="A carregar publicações" className="space-y-4">
      {[0, 1, 2].map(index => <Skeleton key={index} className="h-40 w-full rounded-xl" />)}
    </div> : posts.length === 0 ? !hasError && <Card><EmptyState icon={Rss} title="Ainda não há publicações" description="As publicações criadas pelas automações aparecem aqui para toda a equipa." /></Card> : <>
      <p className="mb-3 text-xs text-muted-foreground">{posts.length === 100 ? '100 publicações mais recentes' : `${posts.length} ${posts.length === 1 ? 'publicação' : 'publicações'}`}</p>
      <ol aria-label="Publicações da equipa" className="space-y-4">
        {posts.map(post => <li key={post.id}>
          <Card className="p-4 sm:p-6"><article className="min-w-0">
            <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-2">
                <span className="rounded-md bg-primary/10 p-2 text-primary"><Workflow aria-hidden="true" className="h-4 w-4" /></span>
                <div className="min-w-0"><p className="text-xs text-muted-foreground">Automação</p><p className="break-words text-sm font-medium">{post.source_flow_name}</p></div>
              </div>
              <time dateTime={post.created_at} className="text-xs text-muted-foreground">{formatDateTime(post.created_at)}</time>
            </header>
            {post.title && <h2 className="mb-2 break-words text-base font-semibold">{post.title}</h2>}
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{post.body}</p>
          </article></Card>
        </li>)}
      </ol>
    </>}
  </>;
}
