import { useState } from 'react';
import { AlertTriangle, ChevronRight, FlaskConical, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { getNodeDefinition, getNodeStyle, humanizeNodeType } from '@/lib/automation-nodes';
import { useAuth } from '@/contexts/AuthContext';
import { useTestAutomationFlow } from '@/hooks/useAutomationFlows';
import type { AutomationGraph } from '@/types/automations';

const DEFAULT_TEST_NAME = 'Contacto de teste';

interface TestFlowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flowId: string;
  /** Shown on the right, so the person sees what is about to run before running it. */
  graph: AutomationGraph;
  entryNodeId: string | null;
  /** Called once the engine accepted the run — the editor jumps to Atividade. */
  onStarted: () => void;
}

/**
 * Runs the flow for real against contact details the user types. Deliberately
 * blunt about it: the engine sends genuine WhatsApp messages and emails, so the
 * copy pushes the user towards their own contacts.
 *
 * The typed values survive closing the dialog — testing is usually done a few
 * times in a row against the same phone number.
 */
export function TestFlowDialog({ open, onOpenChange, flowId, graph, entryNodeId, onStarted }: TestFlowDialogProps) {
  const { user } = useAuth();
  const testFlow = useTestAutomationFlow();

  const [name, setName] = useState(DEFAULT_TEST_NAME);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(() => user?.email ?? '');

  const steps = orderedSteps(graph, entryNodeId);
  const needsPhone = graph.nodes.some((n) => n.type === 'send_whatsapp' || n.type === 'wait_reply');
  const needsEmail = graph.nodes.some((n) => n.type === 'send_email');

  const handleRun = async () => {
    if (!phone.trim() && !email.trim()) {
      toast.error('Indique um telefone ou um email', {
        description: 'O fluxo precisa de saber para onde enviar as mensagens.',
      });
      return;
    }

    try {
      await testFlow.mutateAsync({
        flow_id: flowId,
        name: name.trim() || DEFAULT_TEST_NAME,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      });
    } catch {
      // The mutation already raised a destructive toast with the engine's reason.
      return;
    }

    onOpenChange(false);
    onStarted();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="flex flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-14 sm:px-6">
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            Testar automação
          </DialogTitle>
          <DialogDescription>
            O fluxo corre a sério, com os dados que indicares. Usa os teus próprios contactos.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground">Para quem corre o teste</h3>
              <p className="mt-1 text-xs text-muted-foreground">Basta um dos dois contactos. O teste corre mesmo com a automação em rascunho e não conta para as regras de reentrada.</p>

              <div className="mt-4 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="test-name">Nome</Label>
                  <Input
                    id="test-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={DEFAULT_TEST_NAME}
                    autoFocus
                    onFocus={(e) => e.target.select()}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="test-phone">Telefone {needsPhone && <span className="text-xs font-normal text-muted-foreground">· este fluxo envia WhatsApp</span>}</Label>
                  <Input
                    id="test-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+351 912 345 678"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="test-email">Email {needsEmail && <span className="text-xs font-normal text-muted-foreground">· este fluxo envia email</span>}</Label>
                  <Input
                    id="test-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="eu@empresa.pt"
                  />
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground">O que vai acontecer</h3>
              <p className="mt-1 text-xs text-muted-foreground">Os passos correm por esta ordem. As esperas são respeitadas: um passo de "esperar 2 dias" só continua daqui a 2 dias.</p>

              <ol className="mt-4 space-y-1.5">
                {steps.map((step, index) => {
                  const definition = getNodeDefinition(step.type);
                  const style = getNodeStyle(step.type);
                  const Icon = definition?.icon ?? ChevronRight;
                  return (
                    <li key={step.id} className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2">
                      <span className="w-5 text-right text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
                      <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-2', style.bg, style.ring)}>
                        <Icon className={cn('h-3.5 w-3.5', style.icon)} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                        {definition?.label ?? humanizeNodeType(step.type)}
                      </span>
                    </li>
                  );
                })}
              </ol>

              <div className="mt-4 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p className="text-xs text-foreground">
                  As mensagens são enviadas a sério para o telefone e o email acima. O percurso fica marcado como teste no separador Atividade.
                </p>
              </div>
            </section>
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t px-4 py-3 sm:px-6">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={testFlow.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleRun} disabled={testFlow.isPending}>
            {testFlow.isPending
              ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              : <FlaskConical className="mr-1.5 h-4 w-4" />}
            Correr teste
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Nodes from the entry outwards, breadth first, so the list reads as the flow runs. */
function orderedSteps(graph: AutomationGraph, entryNodeId: string | null) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const start = entryNodeId && byId.has(entryNodeId) ? entryNodeId : graph.nodes[0]?.id;
  if (!start) return [];
  const seen = new Set<string>([start]);
  const queue = [start];
  const out: typeof graph.nodes = [];
  while (queue.length) {
    const id = queue.shift() as string;
    const node = byId.get(id);
    if (!node) continue;
    out.push(node);
    for (const edge of graph.edges.filter((e) => e.source === id)) {
      if (!seen.has(edge.target)) { seen.add(edge.target); queue.push(edge.target); }
    }
  }
  // Steps not reachable from the entry still exist on the canvas — list them last.
  for (const node of graph.nodes) if (!seen.has(node.id)) out.push(node);
  return out;
}
