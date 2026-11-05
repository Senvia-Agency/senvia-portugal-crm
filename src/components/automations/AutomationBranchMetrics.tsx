import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAutomationBranchMetrics } from '@/hooks/useAutomationFlows';

export function AutomationBranchMetrics({ flowId }: { readonly flowId: string }) {
  const branches = useAutomationBranchMetrics(flowId);
  return <Card>
    <CardHeader>
      <CardTitle className="text-base">Resultados por caminho A/B</CardTitle>
      <CardDescription>Cada percurso é contado uma vez por divisão. Os resultados são separados por versão.</CardDescription>
    </CardHeader>
    <CardContent>
      {branches.isLoading && <p className="text-sm text-muted-foreground">A carregar caminhos…</p>}
      {branches.isError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar os caminhos.</p>}
      {branches.data?.length === 0 && <p className="text-sm text-muted-foreground">Ainda não existem percursos em divisões A/B.</p>}
      {!!branches.data?.length && <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Conversão por caminho e versão da automação</caption>
          <thead><tr className="border-b text-left text-muted-foreground">
            {['Versão', 'Caminho', 'Inscritos', 'Objetivo', 'Conversão'].map(label => <th key={label} className="py-2 pr-3 font-medium">{label}</th>)}
          </tr></thead>
          <tbody>{branches.data.map(branch => <tr key={`${branch.flow_version}:${branch.node_id}:${branch.branch_id}`} className="border-b last:border-0">
            <td className="py-3 pr-3 tabular-nums">{branch.flow_version}</td>
            <td className="py-3 pr-3">{branch.branch_label}</td>
            <td className="py-3 pr-3 tabular-nums">{branch.enrolled ?? 0}</td>
            <td className="py-3 pr-3 tabular-nums">{branch.converted ?? 0}</td>
            <td className="py-3 tabular-nums">{branch.enrolled ? Math.round((branch.converted ?? 0) / branch.enrolled * 100) : 0}%</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </CardContent>
  </Card>;
}
