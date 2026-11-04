import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { OttoAvatar, type OttoExpression } from "./OttoAvatar";
import { useLanguage } from "@/i18n";

interface OttoModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  expression?: OttoExpression;
  onConfirm?: () => void;
  confirmText?: string;
  confirmDisabled?: boolean;
}

// Generic configuration modal with the Otto avatar in the corner "giving the
// face" to a step (paste an API key, fill company data, etc.). Used by autonomous
// onboarding steps where the user provides a value Otto then saves.
export function OttoModal({
  open, onClose, title, description, children, expression = "pointing",
  onConfirm, confirmText = "Guardar", confirmDisabled,
}: OttoModalProps) {
  const { t } = useLanguage();
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <OttoAvatar expression={expression} size="md" />
            <div className="min-w-0">
              <DialogTitle>{title}</DialogTitle>
              {description && <DialogDescription>{description}</DialogDescription>}
            </div>
          </div>
        </DialogHeader>

        <div className="py-2">{children}</div>

        {onConfirm && (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>{t("Cancelar")}</Button>
            <Button onClick={onConfirm} disabled={confirmDisabled}>{t(confirmText)}</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
