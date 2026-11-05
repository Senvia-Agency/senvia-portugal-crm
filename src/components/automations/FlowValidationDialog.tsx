import { AlertTriangle, CheckCircle2, CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { AutomationValidationIssue } from '@/lib/automation-validation';

export function FlowValidationDialog({ open, onOpenChange, issues, onSelectNode }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issues: readonly AutomationValidationIssue[];
  onSelectNode: (id: string) => void;
}) {
  const errors = issues.filter(issue => issue.severity === 'error').length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Verificar automação</DialogTitle>
          <DialogDescription>
            {errors ? `${errors} problema(s) precisam de correção antes de ativar.` : 'A configuração não tem problemas que impeçam a ativação.'}
          </DialogDescription>
        </DialogHeader>
        {issues.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-border p-4 text-sm">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
            Pronta para testar com um contacto antes de ativar.
          </div>
        ) : (
          <ul className="space-y-2">
            {issues.map((issue, index) => (
              <li key={`${issue.nodeId}-${index}`} className="flex items-start gap-3 rounded-lg border border-border p-3">
                {issue.severity === 'error' ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm">{issue.message}</p>
                  <p className="text-xs text-muted-foreground">{issue.severity === 'error' ? 'Impede a ativação' : 'Aviso: reveja este comportamento'}</p>
                </div>
                {issue.nodeId && <Button size="sm" variant="outline" onClick={() => { onSelectNode(issue.nodeId ?? ''); onOpenChange(false); }}>Ver passo</Button>}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
