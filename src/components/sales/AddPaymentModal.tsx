import { useState, useEffect } from "react";
import { format, parseISO } from "date-fns";
import { CalendarIcon, Loader2, Receipt, CreditCard, FileText, Paperclip } from "lucide-react";
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
import { useCreateSalePayment, useUpdateSalePayment } from "@/hooks/useSalePayments";
import { InvoiceUploader } from "./InvoiceUploader";
import type { SalePayment, PaymentMethod, PaymentRecordStatus } from "@/types/sales";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/types/sales";
import { BankAccountSelect } from "@/components/finance/BankAccountSelect";
import { useLanguage, dateLocale } from "@/i18n";

interface AddPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saleId: string;
  organizationId: string;
  saleTotal: number;
  remaining: number;
  payment?: SalePayment | null; // For editing
  onSuccess?: (amountPaid: number, paymentMethod: PaymentMethod | null) => void;
  onEditSuccess?: () => void;
  hasInvoiceXpress?: boolean;
}

export function AddPaymentModal({
  open,
  onOpenChange,
  saleId,
  organizationId,
  saleTotal,
  remaining,
  payment,
  onSuccess,
  onEditSuccess,
  hasInvoiceXpress = false,
}: AddPaymentModalProps) {
  const { t } = useLanguage();
  const createPayment = useCreateSalePayment();
  const updatePayment = useUpdateSalePayment();
  const isEditing = !!payment;

  // Form state
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState<Date>(new Date());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [status, setStatus] = useState<PaymentRecordStatus>("paid");
  const [invoiceReference, setInvoiceReference] = useState("");
  const [invoiceFileUrl, setInvoiceFileUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");

  // Reset form when modal opens/closes or payment changes
  useEffect(() => {
    if (open) {
      if (payment) {
        // Editing mode
        setAmount(String(payment.amount));
        setPaymentDate(parseISO(payment.payment_date));
        setPaymentMethod(payment.payment_method || "");
        setStatus(payment.status);
        setInvoiceReference(payment.invoice_reference || "");
        setInvoiceFileUrl(payment.invoice_file_url || null);
        setNotes(payment.notes || "");
        setBankAccountId((payment as any).bank_account_id || "");
      } else {
        // Creating mode - pre-fill with remaining amount
        setAmount(remaining > 0 ? String(remaining) : "");
        setPaymentDate(new Date());
        setPaymentMethod("");
        setStatus("pending");
        setInvoiceReference("");
        setInvoiceFileUrl(null);
        setNotes("");
        setBankAccountId("");
      }
    }
  }, [open, payment, remaining]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const amountValue = parseFloat(amount);
    if (!amountValue || amountValue <= 0) {
      return;
    }

    const data = {
      amount: amountValue,
      payment_date: format(paymentDate, 'yyyy-MM-dd'),
      payment_method: paymentMethod || null,
      invoice_reference: invoiceReference.trim() || null,
      invoice_file_url: invoiceFileUrl,
      status,
      notes: notes.trim() || null,
      bank_account_id: bankAccountId && bankAccountId !== 'none' ? bankAccountId : null,
    };

    if (isEditing && payment) {
      updatePayment.mutate(
        { paymentId: payment.id, saleId, updates: data },
        {
          onSuccess: () => {
            onEditSuccess?.();
            onOpenChange(false);
          },
        }
      );
    } else {
      createPayment.mutate(
        { ...data, sale_id: saleId, organization_id: organizationId },
        {
          onSuccess: () => {
            onSuccess?.(amountValue, paymentMethod || null);
            onOpenChange(false);
          },
        }
      );
    }
  };

  const isSubmitting = createPayment.isPending || updatePayment.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t("Editar Pagamento") : t("Adicionar Pagamento")}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Amount & Date */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                {t("Valor *")}
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  €
                </span>
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
              {remaining > 0 && !isEditing && (
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
                      : t("Selecionar...")
                    }
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

          {/* Payment Method */}
          <div className="space-y-2">
            <Label>{t("Método de Pagamento")}</Label>
            <Select 
              value={paymentMethod} 
              onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
            >
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

          {/* Status */}
          <div className="space-y-2">
              <Label>{t("Estado")}</Label>
              <RadioGroup
                value={status}
                onValueChange={(v) => setStatus(v as PaymentRecordStatus)}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="paid" id="paid" />
                  <Label htmlFor="paid" className="font-normal cursor-pointer">
                    {t("Pago")}
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="pending" id="pending" />
                  <Label htmlFor="pending" className="font-normal cursor-pointer">
                    {t("Agendado")}
                  </Label>
                </div>
              </RadioGroup>
            </div>

          {/* Invoice Reference - hidden when InvoiceXpress is active */}
          {!hasInvoiceXpress && (
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

          {/* Invoice File Upload - hidden when InvoiceXpress is active */}
          {!hasInvoiceXpress && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                {t("Anexar Fatura")}
              </Label>
              <InvoiceUploader
                value={invoiceFileUrl}
                onChange={setInvoiceFileUrl}
                organizationId={organizationId}
                disabled={isSubmitting}
              />
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              {t("Notas")}
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("Observações sobre este pagamento...")}
              rows={2}
            />
          </div>

          <BankAccountSelect value={bankAccountId} onChange={setBankAccountId} />

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t("Cancelar")}
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={isSubmitting || !amount}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("A guardar...")}
                </>
              ) : isEditing ? (
                t("Guardar Alterações")
              ) : (
                t("Adicionar Pagamento")
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
