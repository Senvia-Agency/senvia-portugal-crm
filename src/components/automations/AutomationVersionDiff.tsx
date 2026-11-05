import { GitCompareArrows } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { compareAutomationVersions } from '@/lib/automation-editor-tools';
import { getNodeLabel } from '@/lib/automation-nodes';
export function AutomationVersionDiff({ before, after, beforeVersion, afterVersion }: {
  readonly before: unknown; readonly after: unknown; readonly beforeVersion: number; readonly afterVersion: number;
}) {
  const changes = compareAutomationVersions(before, after, getNodeLabel);
  return <Dialog>
    <DialogTrigger asChild><Button type="button" variant="outline" size="sm"><GitCompareArrows className="mr-2 h-3.5 w-3.5" />Comparar com atual</Button></DialogTrigger>
    <DialogContent className="flex max-h-[85dvh] max-w-3xl flex-col overflow-hidden">
      <DialogHeader><DialogTitle>Comparar versões</DialogTitle><DialogDescription>Versão {beforeVersion} → versão {afterVersion}. A comparação mostra regras, passos e ligações; mover um passo no desenho não altera a execução.</DialogDescription></DialogHeader>
      <div className="min-h-0 space-y-3 overflow-y-auto">
        {!changes.length && <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">As regras e os passos destas versões são iguais.</p>}
        {changes.map((change, index) => <section key={`${change.section}-${change.label}-${index}`} className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">{change.section}</p><h3 className="mt-1 text-sm font-semibold">{change.label}</h3>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2"><div className="min-w-0 rounded-md bg-muted/40 p-3"><dt className="text-xs text-muted-foreground">Versão {beforeVersion}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{change.before}</dd></div><div className="min-w-0 rounded-md border border-primary/20 bg-primary/5 p-3"><dt className="text-xs text-muted-foreground">Versão {afterVersion}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{change.after}</dd></div></dl>
        </section>)}
      </div>
    </DialogContent>
  </Dialog>;
}
