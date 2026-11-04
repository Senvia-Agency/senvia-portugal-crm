import { CheckCircle2, CalendarClock } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { formatCurrency } from "@/lib/format";
import { useLanguage } from "@/i18n";

interface PaymentTypeSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  remainingAmount: number;
  onSelectTotal: () => void;
  onSelectInstallments: () => void;
}

export function PaymentTypeSelector({
  open,
  onOpenChange,
  remainingAmount,
  onSelectTotal,
  onSelectInstallments,
}: PaymentTypeSelectorProps) {
  const { t } = useLanguage();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-sm sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Tipo de Pagamento")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("Como deseja registar o pagamento?")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          {/* Total */}
          <button
            type="button"
            onClick={onSelectTotal}
            className="flex flex-col items-center gap-3 p-5 rounded-xl border border-border bg-card hover:border-primary hover:bg-accent/50 transition-all text-center cursor-pointer group"
          >
            <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <CheckCircle2 className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold">{t("Pronto Pagamento")}</p>
              <p className="text-xs text-muted-foreground">
                {formatCurrency(remainingAmount)}
              </p>
            </div>
          </button>

          {/* Parcelado */}
          <button
            type="button"
            onClick={onSelectInstallments}
            className="flex flex-col items-center gap-3 p-5 rounded-xl border border-border bg-card hover:border-primary hover:bg-accent/50 transition-all text-center cursor-pointer group"
          >
            <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <CalendarClock className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold">{t("Agendar Pagamento")}</p>
              <p className="text-xs text-muted-foreground">
                {t("Agendar em parcelas")}
              </p>
            </div>
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
