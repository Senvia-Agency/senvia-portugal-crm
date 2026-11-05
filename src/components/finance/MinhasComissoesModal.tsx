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
      {/* Full screen like every other dialog: the table and the three figures
          were cut off in the small one. */}
      <DialogContent variant="fullScreen" className="flex flex-col gap-0 p-0">
        <DialogHeader className="border-b px-4 py-4 md:px-6">
          <DialogTitle>{t("As Minhas Comissões")}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6">
          <div className="mx-auto max-w-6xl">
            <MinhasComissoesContent />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
