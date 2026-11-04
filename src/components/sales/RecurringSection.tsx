import { useState } from "react";
import { format, differenceInDays, isPast, isToday } from "date-fns";
import { RefreshCw, XCircle, AlertTriangle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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
import { formatCurrency } from "@/lib/format";
import { useRenewSale, useCancelRecurrence } from "@/hooks/useRecurringSales";
import { useSalePayments } from "@/hooks/useSalePayments";
import { RECURRING_STATUS_LABELS, RECURRING_STATUS_COLORS, type RecurringStatus } from "@/types/sales";
import { useLanguage, dateLocale } from "@/i18n";

interface RecurringSectionProps {
  saleId: string;
  organizationId: string;
  recurringValue: number;
  recurringStatus: RecurringStatus | null;
  nextRenewalDate: string | null;
  lastRenewalDate: string | null;
}

export function RecurringSection({
  saleId,
  organizationId,
  recurringValue,
  recurringStatus,
  nextRenewalDate,
  lastRenewalDate,
}: RecurringSectionProps) {
  const { t } = useLanguage();
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const renewSale = useRenewSale();
  const cancelRecurrence = useCancelRecurrence();
  const { data: payments = [] } = useSalePayments(saleId);

  // Filter renewal payments
  const renewalPayments = payments.filter(p => p.notes?.includes('Renovação'));

  const handleRenew = () => {
    renewSale.mutate({
      saleId,
      organizationId,
      amount: recurringValue,
    });
  };

  const handleCancel = () => {
    cancelRecurrence.mutate(saleId, {
      onSuccess: () => setShowCancelConfirm(false),
    });
  };

  // Calculate days until renewal
  const daysUntilRenewal = nextRenewalDate 
    ? differenceInDays(new Date(nextRenewalDate), new Date())
    : null;
  
  const isOverdue = nextRenewalDate && isPast(new Date(nextRenewalDate)) && !isToday(new Date(nextRenewalDate));
  const isDueToday = nextRenewalDate && isToday(new Date(nextRenewalDate));
  const isDueSoon = daysUntilRenewal !== null && daysUntilRenewal > 0 && daysUntilRenewal <= 7;

  if (recurringStatus === 'cancelled') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-muted-foreground" />
          <Label className="text-muted-foreground">{t("Recorrência")}</Label>
        </div>
        <div className="p-4 rounded-lg border bg-muted/30">
          <div className="flex items-center gap-2">
            <Badge className={RECURRING_STATUS_COLORS.cancelled}>
              {RECURRING_STATUS_LABELS.cancelled}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {t("Esta recorrência foi cancelada")}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-primary" />
          <Label className="text-muted-foreground">{t("Recorrência")}</Label>
        </div>
        
        <div className="p-4 rounded-lg border bg-muted/30 space-y-4">
          {/* Status and value */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">{t("Valor Mensal")}</p>
              <p className="text-lg font-semibold">{formatCurrency(recurringValue)}{t("/mês")}</p>
            </div>
            <Badge className={RECURRING_STATUS_COLORS[recurringStatus || 'active']}>
              {t(RECURRING_STATUS_LABELS[recurringStatus || 'active'])}
            </Badge>
          </div>

          {/* Next renewal date with alert */}
          {nextRenewalDate && (
            <div className={`flex items-center gap-2 p-2 rounded-md ${
              isOverdue ? 'bg-red-500/10' : 
              isDueToday ? 'bg-amber-500/10' : 
              isDueSoon ? 'bg-amber-500/5' : ''
            }`}>
              {isOverdue ? (
                <AlertTriangle className="h-4 w-4 text-red-500" />
              ) : isDueToday ? (
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              ) : isDueSoon ? (
                <RefreshCw className="h-4 w-4 text-amber-500" />
              ) : (
                <CheckCircle className="h-4 w-4 text-green-500" />
              )}
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">{t("Próxima Renovação")}</p>
                <p className={`text-sm font-medium ${
                  isOverdue ? 'text-red-500' : 
                  isDueToday ? 'text-amber-500' : ''
                }`}>
                  {format(new Date(nextRenewalDate), t("d 'de' MMMM yyyy"), { locale: dateLocale() })}
                  {isOverdue && ` ${t("(vencida há {{n}} dias)", { n: Math.abs(daysUntilRenewal!) })}`}
                  {isDueToday && ` ${t("(vence hoje)")}`}
                  {isDueSoon && ` ${t("(em {{n}} dias)", { n: daysUntilRenewal })}`}
                </p>
              </div>
            </div>
          )}

          {/* Last renewal */}
          {lastRenewalDate && (
            <div>
              <p className="text-xs text-muted-foreground">{t("Última Renovação")}</p>
              <p className="text-sm">
                {format(new Date(lastRenewalDate), t("d 'de' MMMM yyyy"), { locale: dateLocale() })}
              </p>
            </div>
          )}

          {/* Renewal history */}
          {renewalPayments.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">{t("Histórico de Renovações")}</p>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {renewalPayments.slice(0, 5).map((payment) => (
                  <div key={payment.id} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {format(new Date(payment.payment_date), "dd/MM/yyyy", { locale: dateLocale() })}
                    </span>
                    <span className="font-medium">{formatCurrency(payment.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-2">
            <Button
              onClick={handleRenew}
              disabled={renewSale.isPending}
              className="flex-1"
              size="sm"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${renewSale.isPending ? 'animate-spin' : ''}`} />
              {t("Renovar Agora")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowCancelConfirm(true)}
              className="flex-1 text-destructive hover:text-destructive"
              size="sm"
            >
              <XCircle className="h-4 w-4 mr-2" />
              {t("Cancelar")}
            </Button>
          </div>
        </div>
      </div>

      {/* Cancel confirmation */}
      <AlertDialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Cancelar Recorrência?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Ao cancelar a recorrência, esta venda deixará de gerar alertas de renovação e não será mais cobrada mensalmente ao cliente.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Voltar")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              className="bg-destructive hover:bg-destructive/90"
            >
              {t("Cancelar Recorrência")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
