import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { STATUS_LABELS, LeadStatus } from '@/types';
import { useLanguage } from '@/i18n';

interface LeadStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (status: LeadStatus) => void;
  isLoading?: boolean;
  leadName?: string;
  actionType: 'delete' | 'cancel';
}

export function LeadStatusDialog({
  open,
  onOpenChange,
  onConfirm,
  isLoading,
  leadName,
  actionType,
}: LeadStatusDialogProps) {
  const { t } = useLanguage();
  const [selectedStatus, setSelectedStatus] = useState<LeadStatus>('contacted');
  // Split around a marker so the lead name keeps its bold.
  const [leadBefore, leadAfter] = t('O lead {{name}} está associado a este evento.', { name: '\u0001' }).split('\u0001');

  const handleConfirm = () => {
    onConfirm(selectedStatus);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {actionType === 'delete' ? t('Eliminar evento') : t('Cancelar evento')}
          </DialogTitle>
          <DialogDescription>
            {leadName ? (
              <>
                {leadBefore}<strong>{leadName}</strong>{leadAfter}
                {' '}{t('Para que estado deseja mover o lead?')}
              </>
            ) : (
              t('Tem a certeza que pretende continuar?')
            )}
          </DialogDescription>
        </DialogHeader>

        {leadName && (
          <RadioGroup
            value={selectedStatus}
            onValueChange={(value) => setSelectedStatus(value as LeadStatus)}
            className="grid gap-3 py-4"
          >
            {(Object.entries(STATUS_LABELS) as [LeadStatus, string][]).map(([status, label]) => (
              <div key={status} className="flex items-center space-x-3">
                <RadioGroupItem value={status} id={status} />
                <Label htmlFor={status} className="cursor-pointer font-normal">
                  {t(label)}
                </Label>
              </div>
            ))}
          </RadioGroup>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            {t('Voltar')}
          </Button>
          <Button
            variant={actionType === 'delete' ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={isLoading}
          >
            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {actionType === 'delete' ? t('Eliminar') : t('Cancelar evento')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
