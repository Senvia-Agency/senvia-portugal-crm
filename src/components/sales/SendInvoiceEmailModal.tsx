import { useState, useEffect } from "react";
import { Mail, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSendInvoiceEmail } from "@/hooks/useSendInvoiceEmail";
import { EmailTemplateGate } from "@/components/marketing/EmailTemplateGate";
import { getFiscalEmailTrigger } from "@/lib/email-template-triggers";
import { useLanguage } from "@/i18n";

interface SendInvoiceEmailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId?: string | null;
  documentId?: number | null;
  documentType: "invoice" | "invoice_receipt" | "receipt" | "credit_note";
  organizationId: string;
  clientEmail?: string | null;
}

export function SendInvoiceEmailModal({
  open,
  onOpenChange,
  invoiceId,
  documentId,
  documentType,
  organizationId,
  clientEmail,
}: SendInvoiceEmailModalProps) {
  const { t } = useLanguage();
  const docLabel = {
    invoice: "Fatura",
    invoice_receipt: "Fatura-Recibo",
    receipt: "Recibo",
    credit_note: "Nota de Crédito",
  }[documentType];

  const [email, setEmail] = useState("");

  const sendEmail = useSendInvoiceEmail();

  useEffect(() => {
    if (open) {
      setEmail(clientEmail || "");
    }
  }, [open, clientEmail]);

  const handleSubmit = () => {
    if (!email) return;
    sendEmail.mutate(
      { invoiceId, documentId, documentType, organizationId, email },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            {t("Enviar {{document}} por email", { document: t(docLabel) })}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("Email do destinatário")}</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("email@exemplo.com")}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancelar")}
          </Button>
          <EmailTemplateGate triggerType={getFiscalEmailTrigger(documentType)}>
            <Button onClick={handleSubmit} disabled={!email || sendEmail.isPending}>
              {sendEmail.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Mail className="h-4 w-4 mr-1" />
              )}
              {t("Enviar")}
            </Button>
          </EmailTemplateGate>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
