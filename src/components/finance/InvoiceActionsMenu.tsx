import { useState } from "react";
import { MoreHorizontal, Eye, RefreshCw, Mail, Ban, FileText, Loader2, FileDown, MessageCircleMore } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSyncInvoice } from "@/hooks/useInvoiceDetails";
import { useCancelInvoice } from "@/hooks/useCancelInvoice";
import { CancelInvoiceDialog } from "@/components/sales/CancelInvoiceDialog";
import { SendInvoiceEmailModal } from "@/components/sales/SendInvoiceEmailModal";
import { InvoiceDetailsModal } from "@/components/sales/InvoiceDetailsModal";
import { CreateCreditNoteModal } from "@/components/sales/CreateCreditNoteModal";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { openPdfInNewTab } from "@/lib/download";
import { useAuth } from "@/contexts/AuthContext";
import { useEmailTemplateRequirement } from "@/hooks/useEmailTemplateRequirement";
import { EMAIL_TEMPLATE_TRIGGER_LABELS, getFiscalEmailTrigger } from "@/lib/email-template-triggers";

interface InvoiceActionItem {
  id: string;
  invoiceId?: string | null;
  provider?: string | null;
  invoicexpressId: number | null;
  invoiceReference: string;
  invoiceFileUrl: string | null;
  documentType: "invoice" | "invoice_receipt" | "receipt";
  saleId: string;
  paymentId?: string;
  clientEmail?: string | null;
  organizationId: string;
  creditNoteId?: number | null;
}

interface InvoiceActionsMenuProps {
  invoice: InvoiceActionItem;
}

export function InvoiceActionsMenu({ invoice }: InvoiceActionsMenuProps) {
  const { organization } = useAuth();
  const [showDetails, setShowDetails] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [showCreditNote, setShowCreditNote] = useState(false);
  const [viewing, setViewing] = useState(false);
  
  const syncInvoice = useSyncInvoice();
  const cancelInvoice = useCancelInvoice();

  const hasDocument = !!(invoice.invoiceId || invoice.invoicexpressId);
  const canSendFiscalEmail = !!(invoice.invoiceId || invoice.invoicexpressId);
  const emailTrigger = getFiscalEmailTrigger(invoice.documentType);
  const emailTemplate = useEmailTemplateRequirement(emailTrigger);
  const emailTemplateMessage = `Configure um template de email ativo com o gatilho «${EMAIL_TEMPLATE_TRIGGER_LABELS[emailTrigger]}» em Marketing → Templates antes de enviar.`;
  const supportsProviderActions = organization?.billing_provider !== 'vendus'
    && invoice.provider !== 'vendus' && !!invoice.invoicexpressId;
  const hasLocalPdf = !!invoice.invoiceFileUrl;

  const handleView = async () => {
    if (!invoice.invoiceFileUrl) return;
    setViewing(true);
    try {
      await openPdfInNewTab(invoice.invoiceFileUrl);
    } catch {
      toast.error("Erro ao abrir PDF");
    } finally {
      setViewing(false);
    }
  };

  const handleSync = () => {
    if (!supportsProviderActions || !invoice.invoicexpressId) return;
    syncInvoice.mutate({
      documentId: invoice.invoicexpressId,
      documentType: invoice.documentType,
      organizationId: invoice.organizationId,
      saleId: invoice.saleId,
      paymentId: invoice.paymentId,
    });
  };

  const handleCancelConfirm = (reason: string) => {
    if (!supportsProviderActions || !invoice.invoicexpressId) return;
    const isSaleLevel = !invoice.paymentId;
    cancelInvoice.mutate(
      {
        ...(isSaleLevel ? { saleId: invoice.saleId } : { paymentId: invoice.paymentId }),
        organizationId: invoice.organizationId,
        reason,
        invoicexpressId: invoice.invoicexpressId,
        documentType: invoice.documentType,
      },
      { onSuccess: () => setShowCancel(false) }
    );
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {hasDocument && (
            <DropdownMenuItem onClick={() => setShowDetails(true)}>
              <Eye className="h-4 w-4 mr-2" />
              Ver Detalhes
            </DropdownMenuItem>
          )}

          {hasLocalPdf ? (
            <DropdownMenuItem onClick={handleView} disabled={viewing}>
              {viewing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
              Ver PDF
            </DropdownMenuItem>
          ) : supportsProviderActions ? (
            <DropdownMenuItem onClick={handleSync} disabled={syncInvoice.isPending}>
              <RefreshCw className={`h-4 w-4 mr-2 ${syncInvoice.isPending ? 'animate-spin' : ''}`} />
              Sincronizar PDF
            </DropdownMenuItem>
          ) : null}

          {canSendFiscalEmail && (
            <DropdownMenuItem
              aria-disabled={emailTemplate.isLoading || !emailTemplate.isConfigured}
              className={!emailTemplate.isLoading && !emailTemplate.isConfigured ? 'opacity-50' : undefined}
              onSelect={(event) => {
                if (emailTemplate.isLoading || !emailTemplate.isConfigured) {
                  event.preventDefault();
                  return;
                }
                setShowEmail(true);
              }}
            >
              <Mail className="h-4 w-4 mr-2" />
              Enviar por Email
              {!emailTemplate.isLoading && !emailTemplate.isConfigured && (
                <span className="ml-auto" title={emailTemplateMessage} aria-label={emailTemplateMessage}>
                  <MessageCircleMore className="h-4 w-4 text-muted-foreground" />
                </span>
              )}
            </DropdownMenuItem>
          )}

          {supportsProviderActions && (
            <>
              <DropdownMenuSeparator />
              {!invoice.creditNoteId && (
                <DropdownMenuItem onClick={() => setShowCreditNote(true)}>
                  <FileText className="h-4 w-4 mr-2" />
                  Nota de Crédito
                </DropdownMenuItem>
              )}
              <DropdownMenuItem 
                onClick={() => setShowCancel(true)}
                className="text-destructive focus:text-destructive"
              >
                <Ban className="h-4 w-4 mr-2" />
                Anular Documento
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Modals */}
      {showDetails && hasDocument && (
        <InvoiceDetailsModal
          open={showDetails}
          onOpenChange={setShowDetails}
          documentId={invoice.invoicexpressId}
          invoiceId={invoice.invoiceId}
          provider={invoice.provider}
          documentType={invoice.documentType}
          organizationId={invoice.organizationId}
          saleId={invoice.saleId}
          paymentId={invoice.paymentId}
        />
      )}

      <CancelInvoiceDialog
        open={showCancel && supportsProviderActions}
        onOpenChange={setShowCancel}
        onConfirm={handleCancelConfirm}
        isLoading={cancelInvoice.isPending}
        invoiceReference={invoice.invoiceReference}
      />

      {showEmail && canSendFiscalEmail && (
        <SendInvoiceEmailModal
          open={showEmail}
          onOpenChange={setShowEmail}
          documentId={invoice.invoicexpressId}
          documentType={invoice.documentType}
          organizationId={invoice.organizationId}
          reference={invoice.invoiceReference}
          clientEmail={invoice.clientEmail}
          invoiceId={invoice.invoiceId}
        />
      )}

      {showCreditNote && supportsProviderActions && invoice.invoicexpressId && (
        <CreateCreditNoteModal
          open={showCreditNote}
          onOpenChange={setShowCreditNote}
          organizationId={invoice.organizationId}
          saleId={invoice.saleId}
          paymentId={invoice.paymentId}
          documentId={invoice.invoicexpressId}
          documentType={invoice.documentType}
          documentReference={invoice.invoiceReference}
        />
      )}
    </>
  );
}
