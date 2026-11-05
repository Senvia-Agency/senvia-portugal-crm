import { CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { AutomationActivationPreview } from '@/hooks/useAutomationActivationPreview';

export function ActivationPreviewDialog({ preview, onClose, onConfirm, busy }: {
  readonly preview: AutomationActivationPreview | null;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly busy: boolean;
}) {
  return <Dialog open={preview !== null} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Confirmar ativação</DialogTitle>
        <DialogDescription>Reveja o alcance da agenda antes de permitir novas entradas.</DialogDescription>
      </DialogHeader>
      {preview && <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4">
          <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p className="text-sm font-medium">{preview.truncated
            ? `${preview.count} candidatos encontrados nos ${preview.scanned} registos analisados. Pode haver mais.`
            : preview.count > 0 ? `Até ${preview.count} registos podem entrar a partir de agora.`
              : 'Nenhum registo atingiu a data ou o horário da agenda neste momento.'}</p>
        </div>
        <p className="text-sm text-muted-foreground">Esta prévia considera a data e o horário da agenda. Filtros de entrada, preferências do contacto e regras de reentrada podem reduzir o total. Novos registos podem tornar-se elegíveis depois desta consulta.</p>
        <p className="text-sm text-muted-foreground">Ao ativar, os registos elegíveis serão processados pela agenda nas próximas verificações.</p>
      </div>}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button>
        <Button disabled={busy} onClick={onConfirm}>Ativar automação</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
