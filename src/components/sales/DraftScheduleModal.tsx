import { useState, useEffect } from "react";
import { format, addDays } from "date-fns";
import { CalendarIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
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
import type { PaymentMethod } from "@/types/sales";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/types/sales";
import type { DraftPayment } from "./AddDraftPaymentModal";
import { useLanguage, dateLocale } from "@/i18n";
import { Trans } from "react-i18next";

// Divide um total em N parcelas (última absorve o arredondamento).
function evenSplit(total: number, n: number): number[] {
  const base = Math.floor((total / n) * 100) / 100;
  return Array.from({ length: n }, (_, i) =>
    i === n - 1 ? +(total - base * (n - 1)).toFixed(2) : base
  );
}

interface DraftScheduleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  remainingAmount: number;
  onAdd: (payments: DraftPayment[]) => void;
}

export function DraftScheduleModal({
  open,
  onOpenChange,
  remainingAmount,
  onAdd,
}: DraftScheduleModalProps) {
  const { t } = useLanguage();
  const [installmentCount, setInstallmentCount] = useState(2);
  const [dates, setDates] = useState<Date[]>(() =>
    Array.from({ length: 4 }, (_, i) => addDays(new Date(), (i + 1) * 30))
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");

  const [amounts, setAmounts] = useState<number[]>(() => evenSplit(remainingAmount, installmentCount));

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

  const handleSubmit = () => {
    const payments: DraftPayment[] = amounts.map((amount, i) => ({
      id: crypto.randomUUID(),
      amount,
      payment_date: format(dates[i], "yyyy-MM-dd"),
      payment_method: paymentMethod || null,
      status: "pending" as const,
      invoice_reference: null,
      notes: `Parcela ${i + 1}/${installmentCount}`,
    }));
    onAdd(payments);
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Pagamento Parcelado")}</AlertDialogTitle>
          <AlertDialogDescription>
            <Trans i18nKey="Dividir <b>{{amount}}</b> em parcelas." values={{ amount: formatCurrency(remainingAmount) }} components={{ b: <strong /> }} />
          </AlertDialogDescription>
        </AlertDialogHeader>

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
            >
              {t("Cancelar")}
            </Button>
            <Button
              className="flex-1"
              onClick={handleSubmit}
              disabled={hasInvalid}
            >
              {t(installmentCount > 1 ? "Adicionar {{n}} Parcelas" : "Adicionar {{n}} Parcela", { n: installmentCount })}
            </Button>
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
