import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/i18n";
import { Trans } from "react-i18next";

interface CancelInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  isLoading: boolean;
  invoiceReference: string;
  createsCreditNote?: boolean;
}

export function CancelInvoiceDialog({
  open,
  onOpenChange,
  onConfirm,
  isLoading,
  invoiceReference,
  createsCreditNote = false,
}: CancelInvoiceDialogProps) {
  const { t } = useLanguage();
  const [reason, setReason] = useState("");

  const handleConfirm = () => {
    if (reason.trim()) {
      onConfirm(reason.trim());
    }
  };

  const handleOpenChange = (value: boolean) => {
    if (!value) setReason("");
    onOpenChange(value);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{createsCreditNote ? t("Emitir Nota de Crédito") : t("Anular Fatura")}</AlertDialogTitle>
          <AlertDialogDescription>
            {createsCreditNote ? (
              <Trans i18nKey="O KeyInvoice vai emitir uma nota de crédito para a fatura <b>{{reference}}</b>. O documento fiscal original continuará no histórico. Esta operação não pode ser desfeita." values={{ reference: invoiceReference }} components={{ b: <strong /> }} />
            ) : (
              <Trans i18nKey="Tem a certeza que deseja anular a fatura <b>{{reference}}</b>? Esta ação será refletida no sistema de faturação e não pode ser desfeita." values={{ reference: invoiceReference }} components={{ b: <strong /> }} />
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="cancel-reason">{createsCreditNote ? t("Motivo da nota de crédito *") : t("Motivo de anulação *")}</Label>
          <Textarea
            id="cancel-reason"
            placeholder={createsCreditNote ? t("Indique o motivo da nota de crédito...") : t("Indique o motivo da anulação...")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>{t("Cancelar")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={!reason.trim() || isLoading}
            className="bg-destructive hover:bg-destructive/90"
          >
            {isLoading ? (createsCreditNote ? t("A emitir...") : t("A anular...")) : (createsCreditNote ? t("Emitir Nota de Crédito") : t("Anular Fatura"))}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
