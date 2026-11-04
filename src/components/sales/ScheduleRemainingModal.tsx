import { useState, useEffect } from "react";
import { format, addDays } from "date-fns";
import { CalendarIcon, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { useCreateSalePayment } from "@/hooks/useSalePayments";
import type { PaymentMethod } from "@/types/sales";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/types/sales";
import { useLanguage, dateLocale } from "@/i18n";
import { Trans } from "react-i18next";

// Divide um total em N parcelas (última absorve o arredondamento).
function evenSplit(total: number, n: number): number[] {
  const base = Math.floor((total / n) * 100) / 100;
  return Array.from({ length: n }, (_, i) =>
    i === n - 1 ? +(total - base * (n - 1)).toFixed(2) : base
  );
}

interface ScheduleRemainingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saleId: string;
  organizationId: string;
  remainingAmount: number;
  defaultPaymentMethod?: PaymentMethod | null;
}

export function ScheduleRemainingModal({
  open,
  onOpenChange,
  saleId,
  organizationId,
  remainingAmount,
  defaultPaymentMethod,
}: ScheduleRemainingModalProps) {
  const { t } = useLanguage();
  const createPayment = useCreateSalePayment();
  const [installmentCount, setInstallmentCount] = useState(1);
  const [dates, setDates] = useState<Date[]>(() =>
    Array.from({ length: 4 }, (_, i) => addDays(new Date(), (i + 1) * 30))
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">(
    defaultPaymentMethod || ""
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [amounts, setAmounts] = useState<number[]>(() => evenSplit(remainingAmount, installmentCount));

  // Reset para a divisão igualitária quando muda o nº de parcelas / valor / reabre.
  useEffect(() => {
    setAmounts(evenSplit(remainingAmount, installmentCount));
  }, [remainingAmount, installmentCount, open]);

  const updateAmount = (index: number, value: string) => {
    setAmounts((prev) => {
      const next = [...prev];
      next[index] = parseFloat(value) || 0;
      return next;
    });
  };

  const total = amounts.reduce((s, a) => s + (a || 0), 0);
  const diff = +(total - remainingAmount).toFixed(2);
  const hasInvalid = amounts.length === 0 || amounts.some((a) => !a || a <= 0);

  const updateDate = (index: number, date: Date) => {
    setDates((prev) => {
      const next = [...prev];
      next[index] = date;
      return next;
    });
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      for (let i = 0; i < installmentCount; i++) {
        await createPayment.mutateAsync({
          sale_id: saleId,
          organization_id: organizationId,
          amount: amounts[i],
          payment_date: format(dates[i], "yyyy-MM-dd"),
          payment_method: paymentMethod || null,
          status: "pending",
          notes: `Parcela ${i + 1}/${installmentCount}`,
        });
      }
      onOpenChange(false);
    } catch {
      // toast handled by hook
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Agendar Restante")}</DialogTitle>
          <DialogDescription>
            <Trans i18nKey="Restam <b>{{amount}}</b>. Como deseja dividir?" values={{ amount: formatCurrency(remainingAmount) }} components={{ b: <strong /> }} />
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Installment count selector */}
          <div className="space-y-2">
            <Label>{t("Número de parcelas")}</Label>
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((n) => (
                <Button
                  key={n}
                  type="button"
                  variant={installmentCount === n ? "default" : "outline"}
                  className="w-full"
                  onClick={() => setInstallmentCount(n)}
                >
                  {n}x
                </Button>
              ))}
            </div>
          </div>

          {/* Installment details */}
          <div className="space-y-3">
            {amounts.map((amount, i) => (
              <div
                key={i}
                className="flex items-center gap-2 p-3 rounded-lg border bg-card"
              >
                <span className="text-sm font-medium whitespace-nowrap">{t("Parcela")} {i + 1}</span>
                <div className="relative flex-1 min-w-0">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">€</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={amount}
                    onChange={(e) => updateAmount(i, e.target.value)}
                    className="h-8 pl-5 text-sm"
                  />
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "justify-start text-left font-normal min-w-[130px]",
                        !dates[i] && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                      {format(dates[i], "dd/MM/yyyy", { locale: dateLocale() })}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      mode="single"
                      selected={dates[i]}
                      onSelect={(d) => d && updateDate(i, d)}
                      locale={dateLocale()}
                      disabled={(d) => d < new Date()}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            ))}
          </div>

          {/* Total das parcelas vs restante */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("Total das parcelas")}</span>
            <span className={cn("font-semibold", diff !== 0 && "text-amber-600")}>
              {formatCurrency(total)}
              {diff !== 0 && (
                <span className="ml-1 text-xs font-normal">
                  ({t("{{diff}} vs restante", { diff: `${diff > 0 ? "+" : ""}${formatCurrency(diff)}` })})
                </span>
              )}
            </span>
          </div>

          {/* Payment method */}
          <div className="space-y-2">
            <Label>{t("Método de pagamento")}</Label>
            <Select
              value={paymentMethod}
              onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("Selecionar método...")} />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(PAYMENT_METHOD_LABELS[m])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t("Ignorar")}
            </Button>
            <Button
              className="flex-1"
              onClick={handleSubmit}
              disabled={isSubmitting || hasInvalid}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("A agendar...")}
                </>
              ) : (
                t(installmentCount > 1 ? "Agendar {{n}} Parcelas" : "Agendar {{n}} Parcela", { n: installmentCount })
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
