import { useState, useEffect } from "react";
import { format } from "date-fns";
import { CalendarIcon, CreditCard, Receipt, FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import type { PaymentMethod, PaymentRecordStatus } from "@/types/sales";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/types/sales";
import { useLanguage, dateLocale } from "@/i18n";

export interface DraftPayment {
  id: string;
  amount: number;
  payment_date: string;
  payment_method: PaymentMethod | null;
  status: PaymentRecordStatus;
  invoice_reference: string | null;
  notes: string | null;
}

interface AddDraftPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saleTotal: number;
  remaining: number;
  onAdd: (payment: DraftPayment) => void;
  hideInvoiceReference?: boolean;
}

export function AddDraftPaymentModal({
  open,
  onOpenChange,
  saleTotal,
  remaining,
  onAdd,
  hideInvoiceReference,
}: AddDraftPaymentModalProps) {
  const { t } = useLanguage();
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState<Date>(new Date());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [status, setStatus] = useState<PaymentRecordStatus>("paid");
  const [invoiceReference, setInvoiceReference] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setAmount(remaining > 0 ? String(remaining) : "");
      setPaymentDate(new Date());
      setPaymentMethod("");
      setStatus("pending");
      setInvoiceReference("");
      setNotes("");
    }
  }, [open, remaining]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amountValue = parseFloat(amount);
    if (!amountValue || amountValue <= 0) return;

    onAdd({
      id: crypto.randomUUID(),
      amount: amountValue,
      payment_date: format(paymentDate, 'yyyy-MM-dd'),
      payment_method: paymentMethod || null,
      status,
      invoice_reference: invoiceReference.trim() || null,
      notes: notes.trim() || null,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Adicionar Pagamento")}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                {t("Valor *")}
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">€</span>
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0.01"
                  required
                  className="pl-8"
                />
              </div>
              {remaining > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("Em falta:")} {formatCurrency(remaining)}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                {t("Data *")}
              </Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !paymentDate && "text-muted-foreground"
                    )}
                  >
                    {paymentDate
                      ? format(paymentDate, "dd/MM/yyyy", { locale: dateLocale() })
                      : t("Selecionar...")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={paymentDate}
                    onSelect={(date) => date && setPaymentDate(date)}
                    locale={dateLocale()}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("Método de Pagamento")}</Label>
            <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
              <SelectTrigger>
                <SelectValue placeholder={t("Selecionar método...")} />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((method) => (
                  <SelectItem key={method} value={method}>
                    {t(PAYMENT_METHOD_LABELS[method])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
              <Label>{t("Estado")}</Label>
              <RadioGroup
                value={status}
                onValueChange={(v) => setStatus(v as PaymentRecordStatus)}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="paid" id="draft-paid" />
                  <Label htmlFor="draft-paid" className="font-normal cursor-pointer">{t("Pago")}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="pending" id="draft-pending" />
                  <Label htmlFor="draft-pending" className="font-normal cursor-pointer">{t("Agendado")}</Label>
                </div>
              </RadioGroup>
            </div>

          {hideInvoiceReference ? (
            <p className="text-xs text-muted-foreground bg-muted/50 rounded-md p-3">
              <Receipt className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
              {t("A fatura pode ser emitida após criar a venda.")}
            </p>
          ) : (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-muted-foreground" />
                {t("Referência da Fatura")}
              </Label>
              <Input
                value={invoiceReference}
                onChange={(e) => setInvoiceReference(e.target.value)}
                placeholder={t("FT 2024/0001")}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              {t("Notas")}
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("Observações...")}
              rows={2}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              {t("Cancelar")}
            </Button>
            <Button type="submit" className="flex-1" disabled={!amount}>
              {t("Adicionar")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
