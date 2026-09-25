import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { Plus, Pencil, Trash2, CreditCard, Receipt, AlertCircle, Ban, FileText, QrCode, Mail, Eye, RefreshCw, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
import { useSalePayments, useDeleteSalePayment, calculatePaymentSummary } from "@/hooks/useSalePayments";
import { useGenerateReceipt } from "@/hooks/useGenerateReceipt";
import { useCancelInvoice } from "@/hooks/useCancelInvoice";
import { useSaleItems } from "@/hooks/useSaleItems";
import { formatCurrency, billingPeriodLabel } from "@/lib/format";
import { AddPaymentModal } from "./AddPaymentModal";
import { ScheduleRemainingModal } from "./ScheduleRemainingModal";
import { PaymentTypeSelector } from "./PaymentTypeSelector";
import { InvoiceDraftModal } from "./InvoiceDraftModal";
import type { DraftSaleItem } from "./InvoiceDraftModal";
import { CancelInvoiceDialog } from "./CancelInvoiceDialog";
import type { SalePayment } from "@/types/sales";
import { PAYMENT_METHOD_LABELS } from "@/types/sales";
import { StatusBadge } from "@/components/ui/status-badge";
import { paymentRecordStatusBadge } from "@/lib/status-badge-maps";

import { toast } from "sonner";
import { openPdfInNewTab } from "@/lib/download";

import { SendInvoiceEmailModal } from "./SendInvoiceEmailModal";
import { InvoiceDetailsModal } from "./InvoiceDetailsModal";
import { EmailTemplateGate } from "@/components/marketing/EmailTemplateGate";
import { EMAIL_TEMPLATE_TRIGGERS } from "@/lib/email-template-triggers";
import { CreateCreditNoteModal } from "./CreateCreditNoteModal";
import { useSyncInvoice } from "@/hooks/useInvoiceDetails";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export interface SaleFiscalDocument {
  id: string;
  provider: string;
  document_type: string;
  invoicexpress_id: number | null;
  payment_id: string | null;
  reference: string | null;
}

export function useSaleFiscalDocuments(organizationId?: string, saleId?: string) {
  return useQuery({
    queryKey: ["invoices", organizationId, "sale", saleId],
    queryFn: async (): Promise<SaleFiscalDocument[]> => {
      const { data, error } = await (supabase as any).from("invoices")
        .select("id,provider,document_type,invoicexpress_id,payment_id,reference")
        .eq("organization_id", organizationId)
        .eq("sale_id", saleId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!organizationId && !!saleId,
  });
}

function paymentHasNoReversal(payment: SalePayment): boolean {
  const fiscalPayment = payment as SalePayment & {
    reversal_status?: string | null;
    reversed_amount?: number | null;
  };
  return (fiscalPayment.reversal_status ?? 'none') === 'none'
    && Number(fiscalPayment.reversed_amount ?? 0) === 0;
}

interface SalePaymentsListProps {
  saleId: string;
  organizationId: string;
  saleTotal: number;
  readonly?: boolean;
  hasInvoiceXpress?: boolean;
  invoicexpressId?: number | null;
  invoicexpressType?: string | null;
  invoiceReference?: string | null;
  invoiceQrCodeUrl?: string | null;
  invoicePdfUrl?: string | null;
  clientNif?: string | null;
  clientName?: string | null;
  clientEmail?: string | null;
  taxConfig?: { tax_value?: number; tax_exemption_reason?: string } | null;
  creditNoteId?: number | null;
  preventPaymentDeletion?: boolean;
}

export function SalePaymentsList({ 
  saleId, 
  organizationId,
  saleTotal, 
  readonly = false,
  hasInvoiceXpress = false,
  invoicexpressId,
  invoicexpressType,
  invoiceReference,
  invoiceQrCodeUrl,
  invoicePdfUrl,
  clientNif,
  clientName,
  clientEmail,
  taxConfig,
  creditNoteId,
  preventPaymentDeletion = false,
}: SalePaymentsListProps) {
  const { data: payments = [], isLoading } = useSalePayments(saleId);
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  const { data: fiscalDocuments = [], isLoading: fiscalDocumentsLoading } = useSaleFiscalDocuments(organizationId, saleId);
  const { data: saleItemsData = [] } = useSaleItems(saleId);
  const deletePayment = useDeleteSalePayment();

  // Build draft items for InvoiceDraftModal
  const draftSaleItems: DraftSaleItem[] = saleItemsData.map((item: any) => ({
    name: item.name,
    quantity: Number(item.quantity),
    unit_price: Number(item.unit_price),
    tax_value: item.product?.tax_value ?? null,
  }));
  const generateReceipt = useGenerateReceipt();
  const cancelInvoice = useCancelInvoice();
  
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPayment, setEditingPayment] = useState<SalePayment | null>(null);
  const [deletingPayment, setDeletingPayment] = useState<SalePayment | null>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  
  const [cancellingPayment, setCancellingPayment] = useState<SalePayment | null>(null);
  const [promptScheduleAfterEdit, setPromptScheduleAfterEdit] = useState(false);
  
  // Draft modal state - supports receipt (RC) only; invoice/invoice_receipt handled by parent
  const [draftMode, setDraftMode] = useState<"receipt" | null>(null);
  const [draftPayment, setDraftPayment] = useState<SalePayment | null>(null);
  
  // Email modal state
  const [emailModal, setEmailModal] = useState<{
    invoiceId?: string;
    documentId?: number | null;
    documentType: "invoice" | "invoice_receipt" | "receipt";
  } | null>(null);

  // Invoice details modal state
  const [detailsModal, setDetailsModal] = useState<{
    documentId: number;
    invoiceId?: string;
    provider?: string;
    documentType: "invoice" | "invoice_receipt" | "receipt";
    paymentId?: string;
  } | null>(null);

  // Credit note modal state
  const [creditNoteModal, setCreditNoteModal] = useState<{
    documentId: number;
    documentType: "invoice" | "invoice_receipt" | "receipt";
    reference: string;
    saleId?: string;
    paymentId?: string;
  } | null>(null);

  const syncInvoice = useSyncInvoice();

  const summary = calculatePaymentSummary(payments, saleTotal);

  const receiptDocument = (payment: SalePayment): SaleFiscalDocument | null => {
    const candidates = fiscalDocuments.filter((document) =>
      document.document_type === "receipt" && document.payment_id === payment.id);
    return candidates.find((document) => document.reference === payment.invoice_reference)
      || (candidates.length === 1 ? candidates[0] : null);
  };
  const supportsInvoiceXpressActions = (payment: SalePayment): boolean =>
    (organization?.billing_provider ?? "invoicexpress") === "invoicexpress"
    && receiptDocument(payment)?.provider === "invoicexpress";

  // After editing a payment, check if there's a gap and prompt to schedule
  useEffect(() => {
    if (promptScheduleAfterEdit) {
      if (summary.remainingToSchedule > 0) {
        setShowScheduleModal(true);
      }
      setPromptScheduleAfterEdit(false);
    }
  }, [promptScheduleAfterEdit, summary.remainingToSchedule]);

  const handlePdfView = async (path: string) => {
    try {
      await openPdfInNewTab(path);
    } catch {
      toast.error('Erro ao abrir PDF');
    }
  };

  const handleDelete = () => {
    if (!deletingPayment) return;
    
    deletePayment.mutate(
      { paymentId: deletingPayment.id, saleId },
      { onSuccess: () => setDeletingPayment(null) }
    );
  };

  // Can emit invoice: InvoiceXpress active, no existing invoice, client has NIF
  const canEmitInvoice = hasInvoiceXpress && !invoicexpressId && !!clientNif;
  // Has invoice: sale already has invoicexpress_id
  const hasInvoice = !!invoicexpressId;

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Pagamentos</span>
        </div>
        <div className="animate-pulse space-y-2">
          <div className="h-16 bg-muted/50 rounded-lg" />
          <div className="h-16 bg-muted/50 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Pagamentos</span>
            {payments.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {payments.length}
              </Badge>
            )}
          </div>
          {!readonly && summary.remainingToSchedule > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowTypeSelector(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Adicionar
            </Button>
          )}
        </div>


        {/* Payments List */}
        {payments.length > 0 ? (
          <div className="space-y-2">
            {payments.map((payment) => (
              <div
                key={payment.id}
                className="flex items-center gap-3 p-3 rounded-lg border bg-card"
              >
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">
                      {formatCurrency(Number(payment.amount))}
                    </span>
                    <StatusBadge {...paymentRecordStatusBadge(payment.status)} />
                    {payment.payment_method && (
                      <Badge variant="secondary" className="text-xs">
                        {PAYMENT_METHOD_LABELS[payment.payment_method]}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {format(new Date(payment.payment_date), "d MMM yyyy", { locale: pt })}
                    </span>
                    {/* Stripe bills in advance, so the charge date and the month
                        the subscription actually covers frequently differ. */}
                    {billingPeriodLabel(payment.billing_period_start, payment.billing_period_end) && (
                      <>
                        <span>•</span>
                        <span>Cobre {billingPeriodLabel(payment.billing_period_start, payment.billing_period_end)}</span>
                      </>
                    )}
                    {payment.invoice_reference && (
                      <>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Receipt className="h-3 w-3" />
                          {payment.invoice_reference}
                        </span>
                      </>
                    )}
                  </div>
                  {payment.notes && (
                    <p className="text-xs text-muted-foreground truncate">
                      {payment.notes}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {!readonly && payment.status !== 'paid' && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setEditingPayment(payment)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {!preventPaymentDeletion && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setDeletingPayment(payment)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </>
                  )}
                  {/* Generate Receipt (RC) button - only when sale already has FT */}
                  {hasInvoiceXpress && hasInvoice && invoicexpressType === 'FT' && payment.status === 'paid' && paymentHasNoReversal(payment) && !payment.invoice_reference && !readonly && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => {
                        setDraftPayment(payment);
                        setDraftMode("receipt");
                      }}
                    >
                      <Receipt className="h-3 w-3 mr-1" />
                      Emitir Recibo
                    </Button>
                  )}
                  {/* Buttons shown after receipt is issued (invoice_reference exists) */}
                  {payment.invoice_file_url && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handlePdfView(payment.invoice_file_url!)}
                      title="Ver PDF"
                    >
                       <FileDown className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {!payment.invoice_file_url && payment.invoice_reference && payment.invoicexpress_id && supportsInvoiceXpressActions(payment) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => syncInvoice.mutate({
                        documentId: payment.invoicexpress_id!,
                        documentType: 'receipt',
                        organizationId,
                        saleId,
                        paymentId: payment.id,
                      })}
                      disabled={syncInvoice.isPending}
                      title="Buscar PDF"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${syncInvoice.isPending ? 'animate-spin' : ''}`} />
                    </Button>
                  )}
                  {payment.qr_code_url && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => window.open(payment.qr_code_url!, '_blank')}
                      title="Ver QR Code"
                    >
                      <QrCode className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {payment.invoice_reference && payment.invoicexpress_id && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={fiscalDocumentsLoading || (organization?.billing_provider === 'vendus' && !receiptDocument(payment))}
                      onClick={() => {
                        const document = receiptDocument(payment);
                        setDetailsModal({
                          documentId: payment.invoicexpress_id!,
                          invoiceId: document?.id,
                          provider: document?.provider,
                          documentType: 'receipt',
                          paymentId: payment.id,
                        });
                      }}
                      title="Ver detalhes"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {payment.invoice_reference && (payment.invoicexpress_id || receiptDocument(payment)?.id) && !readonly && (
                    <>
                      <EmailTemplateGate triggerType={EMAIL_TEMPLATE_TRIGGERS.receipt} noticePosition="inline" className="shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setEmailModal({
                            invoiceId: receiptDocument(payment)?.id,
                            documentId: payment.invoicexpress_id,
                            documentType: 'receipt',
                          })}
                          title="Enviar por email"
                        >
                          <Mail className="h-3.5 w-3.5" />
                        </Button>
                      </EmailTemplateGate>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setCancellingPayment(payment)}
                        title="Anular recibo"
                      >
                        <Ban className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-6 rounded-lg border border-dashed text-center">
            <AlertCircle className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground mb-3">
              Nenhum pagamento registado
            </p>
            {!readonly && summary.remainingToSchedule > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowTypeSelector(true)}
              >
                <Plus className="h-4 w-4 mr-1" />
                Adicionar Pagamento
              </Button>
            )}
          </div>
        )}


      </div>

      {/* Type Selector */}
      <PaymentTypeSelector
        open={showTypeSelector}
        onOpenChange={setShowTypeSelector}
        remainingAmount={summary.remaining}
        onSelectTotal={() => {
          setShowTypeSelector(false);
          setShowAddModal(true);
        }}
        onSelectInstallments={() => {
          setShowTypeSelector(false);
          setShowScheduleModal(true);
        }}
      />

      {/* Add/Edit Modal */}
      <AddPaymentModal
        open={showAddModal || !!editingPayment}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddModal(false);
            setEditingPayment(null);
          }
        }}
        saleId={saleId}
        organizationId={organizationId}
        saleTotal={saleTotal}
        remaining={summary.remaining}
        payment={editingPayment}
        onEditSuccess={() => setPromptScheduleAfterEdit(true)}
        hasInvoiceXpress={hasInvoiceXpress}
        
      />

      {/* Schedule Remaining Modal */}
      <ScheduleRemainingModal
        open={showScheduleModal}
        onOpenChange={setShowScheduleModal}
        saleId={saleId}
        organizationId={organizationId}
        remainingAmount={Math.max(0, summary.remainingToSchedule)}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingPayment} onOpenChange={(open) => !open && setDeletingPayment(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar Pagamento</AlertDialogTitle>
            <AlertDialogDescription>
              Tem a certeza que deseja eliminar este pagamento de{" "}
              <strong>{deletingPayment && formatCurrency(Number(deletingPayment.amount))}</strong>?
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete} 
              className="bg-destructive hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Invoice Draft Modal - Receipt mode (RC - requires existing FT) */}
      <InvoiceDraftModal
        open={draftMode === "receipt" && !!draftPayment}
        onOpenChange={(open) => { 
          if (!open) { setDraftMode(null); setDraftPayment(null); }
        }}
        onConfirm={(_obs) => {
          // A receipt settles money already received. Keep this guard at the
          // action boundary as well as in the button visibility so stale UI
          // state can never submit a pending payment.
          if (!draftPayment || draftPayment.status !== 'paid' || !paymentHasNoReversal(draftPayment)) return;
          generateReceipt.mutate(
            { saleId, paymentId: draftPayment.id, organizationId },
            { onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: ["invoices", organizationId, "sale", saleId] });
              setDraftMode(null);
              setDraftPayment(null);
            } }
          );
        }}
        isLoading={generateReceipt.isPending}
        mode="receipt"
        clientName={clientName}
        clientNif={clientNif}
        amount={draftPayment ? Number(draftPayment.amount) : 0}
        paymentDate={draftPayment?.payment_date || new Date().toISOString()}
        paymentMethod={draftPayment?.payment_method}
        taxConfig={taxConfig}
        saleItems={draftSaleItems}
        saleTotal={saleTotal}
      />

      {/* Cancel Invoice/Receipt Dialog */}
      <CancelInvoiceDialog
        open={!!cancellingPayment}
        onOpenChange={(open) => !open && setCancellingPayment(null)}
        onConfirm={(reason) => {
          if (!cancellingPayment || !supportsInvoiceXpressActions(cancellingPayment)) return;
          const isSaleInvoice = cancellingPayment.id === '__sale__';
          const docType = isSaleInvoice ? 'invoice' : 'receipt';
          cancelInvoice.mutate(
            {
              ...(isSaleInvoice 
                ? { saleId } 
                : { paymentId: cancellingPayment.id }),
              organizationId,
              reason,
              invoicexpressId: cancellingPayment.invoicexpress_id!,
              documentType: docType,
            },
            { onSuccess: () => setCancellingPayment(null) }
          );
        }}
        isLoading={cancelInvoice.isPending}
        invoiceReference={cancellingPayment?.invoice_reference || ""}
      />

      {/* Send Invoice Email Modal */}
      {emailModal && (
        <SendInvoiceEmailModal
          open={!!emailModal}
          onOpenChange={(open) => !open && setEmailModal(null)}
          invoiceId={emailModal.invoiceId}
          documentId={emailModal.documentId}
          documentType={emailModal.documentType}
          organizationId={organizationId}
          clientEmail={clientEmail}
        />
      )}

      {/* Invoice Details Modal */}
      {detailsModal && (
        <InvoiceDetailsModal
          open={!!detailsModal}
          onOpenChange={(open) => !open && setDetailsModal(null)}
          documentId={detailsModal.documentId}
          invoiceId={detailsModal.invoiceId}
          provider={detailsModal.provider}
          documentType={detailsModal.documentType}
          organizationId={organizationId}
          saleId={saleId}
          paymentId={detailsModal.paymentId}
        />
      )}

      {/* Credit Note Modal */}
      {creditNoteModal && (
        <CreateCreditNoteModal
          open={!!creditNoteModal}
          onOpenChange={(open) => !open && setCreditNoteModal(null)}
          organizationId={organizationId}
          saleId={creditNoteModal.saleId}
          paymentId={creditNoteModal.paymentId}
          documentId={creditNoteModal.documentId}
          documentType={creditNoteModal.documentType}
          documentReference={creditNoteModal.reference}
        />
      )}
    </>
  );
}
