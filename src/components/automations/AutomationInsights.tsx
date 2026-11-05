import { AutomationVersionDiff } from './AutomationVersionDiff';
import { BulkRetryControl } from './BulkRetryControl';
import { History, RotateCcw, Target } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAutomationMetrics, useAutomationVersions, useRestoreAutomationVersion } from '@/hooks/useAutomationFlows';
import { AutomationBranchMetrics } from './AutomationBranchMetrics';
import type { AutomationFlow } from '@/types/automations';
import { formatDateTime } from '@/lib/format';

export function AutomationInsights({ flowId, currentVersion, onRestored, disabled = false }: {
  readonly flowId: string;
  readonly currentVersion: number;
  readonly onRestored?: (flow: AutomationFlow) => void;
  readonly disabled?: boolean;
}) {
  const metrics = useAutomationMetrics(flowId);
  const versions = useAutomationVersions(flowId);
  const restore = useRestoreAutomationVersion();
  const currentSnapshot = versions.data?.find(version => version.version === currentVersion)?.snapshot;
  const data = metrics.data;
  const converted = data?.converted ?? 0;
  const enrolled = data?.enrolled ?? 0;
  const conversion = enrolled ? Math.round(converted / enrolled * 100) : 0;
  return <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 md:p-6">
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Target className="h-4 w-4 text-primary" />Resultados da automação</CardTitle><CardDescription>Percursos desta automação e objetivos de saída atingidos.</CardDescription></CardHeader>
      <CardContent>
        {metrics.isLoading ? <p className="text-sm text-muted-foreground">A carregar resultados…</p> : metrics.isError ? <p role="alert" className="text-sm text-destructive">Não foi possível carregar os resultados.</p> : <>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {[
              ['Inscritos', enrolled], ['Ativos', data?.active ?? 0],
              ['Concluídos', data?.completed ?? 0], ['Falhados', data?.failed ?? 0],
              ['Objetivo atingido', converted], ['Conversão', `${conversion}%`],
            ].map(([label, value]) => <div key={label} className="rounded-lg border p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd></div>)}
          </dl>
          {data?.average_goal_seconds != null && <p className="mt-4 text-sm text-muted-foreground">Tempo médio até concluir com objetivo atingido: {Math.round(data.average_goal_seconds / 60)} minutos.</p>}
        </>}
        <BulkRetryControl flowId={flowId} failed={data?.failed ?? 0} disabled={disabled} />
      </CardContent>
    </Card>
    <AutomationBranchMetrics flowId={flowId} />
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4 text-primary" />Histórico de versões</CardTitle><CardDescription>Repor uma versão cria um rascunho para revisão. Os percursos em curso conservam a sua versão.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {versions.isLoading && <p className="text-sm text-muted-foreground">A carregar versões…</p>}
        {versions.isError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar o histórico.</p>}
        {versions.data?.length === 0 && <p className="text-sm text-muted-foreground">Ainda não existem versões guardadas.</p>}
        {versions.data?.map(version => <div key={version.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <div><p className="text-sm font-medium">Versão {version.version}{version.version === currentVersion ? ' · atual' : ''}</p><p className="text-xs text-muted-foreground">{formatDateTime(version.created_at)}</p></div>
          <div className="flex flex-wrap gap-2">{currentSnapshot && version.version !== currentVersion && <AutomationVersionDiff before={version.snapshot} after={currentSnapshot} beforeVersion={version.version} afterVersion={currentVersion} />}<Button type="button" variant="outline" size="sm" disabled={disabled || restore.isPending || version.version === currentVersion} onClick={() => restore.mutate({ flowId, snapshot: version.snapshot }, { onSuccess: onRestored })}><RotateCcw className="mr-2 h-3.5 w-3.5" />Repor como rascunho</Button></div>
        </div>)}
        {restore.isError && <p role="alert" className="text-sm text-destructive">Não foi possível repor esta versão.</p>}
      </CardContent>
    </Card>
  </div>;
}
