import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MinhasComissoesContent } from './MinhasComissoesContent';
import { useLanguage } from '@/i18n';

interface MinhasComissoesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MinhasComissoesModal({ open, onOpenChange }: MinhasComissoesModalProps) {
  const { t } = useLanguage();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("As Minhas Comissões")}</DialogTitle>
        </DialogHeader>
        <MinhasComissoesContent />
      </DialogContent>
    </Dialog>
  );
}
