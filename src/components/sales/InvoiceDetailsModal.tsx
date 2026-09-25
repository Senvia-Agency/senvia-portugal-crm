import { useState } from "react";
import { Mail, FileText, Ban, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useInvoiceDetails, type InvoiceDetailsData } from "@/hooks/useInvoiceDetails";
import { formatCurrency } from "@/lib/format";
import { SendInvoiceEmailModal } from "./SendInvoiceEmailModal";
import { CreateCreditNoteModal } from "./CreateCreditNoteModal";
import { CancelInvoiceDialog } from "./CancelInvoiceDialog";
import { useCancelInvoice } from "@/hooks/useCancelInvoice";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { openPdfInNewTab } from "@/lib/download";
import { useAuth } from "@/contexts/AuthContext";
import { EmailTemplateGate } from "@/components/marketing/EmailTemplateGate";
import { getFiscalEmailTrigger } from "@/lib/email-template-triggers";

interface InvoiceDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId?: number | null;
  invoiceId?: string | null;
  provider?: string | null;
  documentType: "invoice" | "invoice_receipt" | "receipt" | "credit_note";
  organizationId: string;
  saleId?: string;
  paymentId?: string;
  creditNoteId?: number | null;
  initialDetails?: Partial<InvoiceDetailsData>;
}

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  draft: { label: "Rascunho", className: "bg-muted text-muted-foreground" },
  final: { label: "Finalizada", className: "bg-green-500/20 text-green-500 border-green-500/30" },
  settled: { label: "Liquidada", className: "bg-blue-500/20 text-blue-500 border-blue-500/30" },
  cancelled: { label: "Anulada", className: "bg-red-500/20 text-red-500 border-red-500/30" },
  canceled: { label: "Anulada", className: "bg-red-500/20 text-red-500 border-red-500/30" },
  second_copy: { label: "2ª Via", className: "bg-amber-500/20 text-amber-500 border-amber-500/30" },
  sent: { label: "Enviada", className: "bg-purple-500/20 text-purple-500 border-purple-500/30" },
};

const TYPE_LABELS: Record<string, string> = {
  invoice: "Fatura",
  invoice_receipt: "Fatura-Recibo",
  receipt: "Recibo",
  credit_note: "Nota de Crédito",
};

export function InvoiceDetailsModal({
  open,
  onOpenChange,
  documentId,
  invoiceId,
  provider,
  documentType,
  organizationId,
  saleId,
  paymentId,
  creditNoteId,
  initialDetails,
}: InvoiceDetailsModalProps) {
  const { organization } = useAuth();
  const { data: details, isLoading, error } = useInvoiceDetails(
    { documentId, invoiceId, documentType, organizationId },
    open,
    initialDetails,
  );
  const cancelInvoice = useCancelInvoice();

  const [emailOpen, setEmailOpen] = useState(false);
  const [creditNoteOpen, setCreditNoteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [viewingPdf, setViewingPdf] = useState(false);

  const handleViewPdf = async () => {
    setViewingPdf(true);
    try {
      let pdfUrl = details?.pdf_signed_url || null;
      let pdfPath = details?.pdf_url || null;

      if (!pdfUrl && !pdfPath) {
        const response = await supabase.functions.invoke("get-invoice-details", {
          body: {
            ...(invoiceId ? { invoice_id: invoiceId } : { document_id: documentId }),
            document_type: documentType,
            organization_id: organizationId,
            include_pdf: true,
          },
        });
        if (response.error) throw new Error(response.error.message || "Erro ao obter PDF");
        if (response.data?.error) throw new Error(response.data.error);
        pdfUrl = response.data?.pdf_signed_url || null;
        pdfPath = response.data?.pdf_url || null;
      }

      if (pdfUrl) window.open(pdfUrl, '_blank');
      else if (pdfPath) await openPdfInNewTab(pdfPath);
      else toast.error("PDF não disponível");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao abrir PDF");
    }
    finally { setViewingPdf(false); }
  };

  const handleCancel = (reason: string) => {
    if (documentId == null || provider === 'vendus' || details?.source === 'vendus') return;
    cancelInvoice.mutate(
      { invoiceId: invoiceId || undefined, invoicexpressId: documentId, documentType, organizationId, reason, saleId, paymentId },
      { onSuccess: () => setCancelOpen(false) }
    );
  };

  const statusInfo = details ? STATUS_MAP[details.status] || { label: details.status, className: "bg-muted text-muted-foreground" } : null;
  const ref = details?.sequence_number || '';
  const isCancelled = details?.status === 'cancelled' || details?.status === 'canceled';
  const isVendus = provider === 'vendus' || details?.source === 'vendus';
  const isKeyInvoice = provider === 'keyinvoice' || details?.source === 'keyinvoice';
  const supportsProviderActions = organization?.billing_provider !== 'vendus'
    && !isVendus && documentId != null;
  const canSendFiscalEmail = documentId != null || !!invoiceId;
  const typeLabel = documentType === 'receipt' && isVendus
    ? 'Recibo (RG)'
    : TYPE_LABELS[documentType] || 'Documento';

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent className="max-w-2xl max-h-[95dvh] p-0 gap-0">
          <DialogHeader className="px-6 py-4 border-b border-border/50">
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <span>{typeLabel} n.º {ref}</span>
              {isVendus && <Badge variant="outline">Vendus</Badge>}
              {statusInfo && (
                <Badge variant="outline" className={statusInfo.className}>
                  {isKeyInvoice && isCancelled ? 'Com nota de crédito' : isKeyInvoice && details.status === 'final' ? 'Emitida' : statusInfo.label}
                </Badge>
              )}
            </DialogTitle>
            {details?.client && (
              <p className="text-sm text-muted-foreground">{details.client.name}</p>
            )}
          </DialogHeader>

          {isLoading ? (
            <div className="p-6 space-y-4">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : error ? (
            <div className="text-center py-8 px-6">
              <p className="text-sm text-destructive mb-2">Erro ao carregar detalhes</p>
              <p className="text-xs text-muted-foreground">{(error as Error).message}</p>
            </div>
          ) : details ? (
              <ScrollArea className="max-h-[calc(95dvh-14rem)]">
                <div className="p-6 space-y-5">
                  {/* Emitente & Cliente side by side */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {details.owner && (
                      <div className="space-y-1 p-3 rounded-lg bg-muted/30">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Emitente</p>
                        <p className="text-sm font-medium">{details.owner.name}</p>
                        {details.owner.address && <p className="text-xs text-muted-foreground">{details.owner.address}</p>}
                        {(details.owner.postal_code || details.owner.city) && (
                          <p className="text-xs text-muted-foreground">
                            {[details.owner.postal_code, details.owner.city].filter(Boolean).join(', ')}
                          </p>
                        )}
                        {details.owner.fiscal_id && <p className="text-xs text-muted-foreground">NIF: {details.owner.fiscal_id}</p>}
                        {details.owner.email && <p className="text-xs text-muted-foreground">{details.owner.email}</p>}
                      </div>
                    )}
                    {details.client && (
                      <div className="space-y-1 p-3 rounded-lg bg-muted/30">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cliente</p>
                        <p className="text-sm font-medium">{details.client.name}</p>
                        {details.client.address && <p className="text-xs text-muted-foreground">{details.client.address}</p>}
                        {(details.client.postal_code || details.client.city) && (
                          <p className="text-xs text-muted-foreground">
                            {[details.client.postal_code, details.client.city].filter(Boolean).join(', ')}
                          </p>
                        )}
                        {details.client.fiscal_id && <p className="text-xs text-muted-foreground">NIF: {details.client.fiscal_id}</p>}
                        {details.client.country && <p className="text-xs text-muted-foreground">{details.client.country}</p>}
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Document metadata */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    {details.date && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Data</p>
                        <p className="font-medium text-xs">{details.date}</p>
                      </div>
                    )}
                    {details.due_date && details.due_date !== details.date && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Vencimento</p>
                        <p className="font-medium text-xs">{details.due_date}</p>
                      </div>
                    )}
                    {details.client?.fiscal_id && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Contribuinte</p>
                        <p className="font-mono font-medium text-xs">{details.client.fiscal_id}</p>
                      </div>
                    )}
                    {details.atcud && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">ATCUD</p>
                        <p className="font-mono font-medium text-xs">{details.atcud}</p>
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Items Table */}
                  {details.items.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Itens</p>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Descrição</TableHead>
                              <TableHead className="text-xs text-right">Preço</TableHead>
                              <TableHead className="text-xs text-right">Qtd</TableHead>
                              <TableHead className="text-xs text-right">IVA</TableHead>
                              <TableHead className="text-xs text-right">Dsc</TableHead>
                              <TableHead className="text-xs text-right">Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {details.items.map((item, i) => (
                              <TableRow key={i}>
                                <TableCell className="text-xs py-2">
                                  <div>
                                    <p className="font-medium">{item.name}</p>
                                    {item.description && (
                                      <p className="text-muted-foreground text-[10px] mt-0.5">{item.description}</p>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-xs text-right py-2">{formatCurrency(Number(item.unit_price))}</TableCell>
                                <TableCell className="text-xs text-right py-2">{item.quantity}</TableCell>
                                <TableCell className="text-xs text-right py-2">{item.tax?.value ?? 0}%</TableCell>
                                <TableCell className="text-xs text-right py-2">{item.discount > 0 ? `${item.discount}%` : '-'}</TableCell>
                                <TableCell className="text-xs text-right py-2 font-medium">{formatCurrency(item.total)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {/* Tax Summary */}
                  {details.tax_summary && details.tax_summary.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Impostos</p>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Imposto</TableHead>
                            <TableHead className="text-xs text-right">Taxa</TableHead>
                            <TableHead className="text-xs text-right">Incidência</TableHead>
                            <TableHead className="text-xs text-right">Valor</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {details.tax_summary.map((tax, i) => (
                            <TableRow key={i}>
                              <TableCell className="text-xs py-1.5">{tax.name}</TableCell>
                              <TableCell className="text-xs text-right py-1.5">{tax.rate}%</TableCell>
                              <TableCell className="text-xs text-right py-1.5">{formatCurrency(tax.incidence)}</TableCell>
                              <TableCell className="text-xs text-right py-1.5 font-medium">{formatCurrency(tax.value)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  <Separator />

                  {/* Financial Summary */}
                  <div className="space-y-1.5 p-4 rounded-lg bg-muted/30">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Sumário</p>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Soma</span>
                      <span>{formatCurrency(details.sum)}</span>
                    </div>
                    {details.discount > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Desconto</span>
                        <span>-{formatCurrency(details.discount)}</span>
                      </div>
                    )}
                    {(details.retention || 0) > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Retenção</span>
                        <span>-{formatCurrency(details.retention)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">S/ IVA</span>
                      <span>{formatCurrency(details.before_taxes)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">IVA</span>
                      <span>{formatCurrency(details.taxes)}</span>
                    </div>
                    {details.tax_exemption && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Isenção</span>
                        <span className="text-xs text-right max-w-[60%]">{details.tax_exemption}</span>
                      </div>
                    )}
                    <Separator className="my-2" />
                    <div className="flex justify-between font-semibold text-base">
                      <span>Total</span>
                      <span className="text-primary">{formatCurrency(details.total)}</span>
                    </div>
                  </div>

                  {/* Observations */}
                  {details.observations && (
                    <div className="space-y-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Observações</p>
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">{details.observations}</p>
                    </div>
                  )}

                  {/* Cancel reason */}
                  {details.cancel_reason && (
                    <div className="space-y-1 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-destructive">Razão de cancelamento</p>
                      <p className="text-xs text-destructive/80">{details.cancel_reason}</p>
                    </div>
                  )}

                  {/* QR Code */}
                  {details.qr_code_url && (
                    <div className="flex justify-center">
                      <img src={details.qr_code_url} alt="QR Code" className="h-24 w-24 rounded" />
                    </div>
                  )}

                </div>
              </ScrollArea>
          ) : null}

          {/* Footer Actions */}
          {details && !isLoading && (
            <div className="p-4 border-t border-border/50 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={handleViewPdf} disabled={viewingPdf}>
                  {viewingPdf ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <FileText className="h-3.5 w-3.5 mr-1.5" />}
                  Ver PDF
                </Button>
                {canSendFiscalEmail && (
          <EmailTemplateGate triggerType={getFiscalEmailTrigger(documentType)} className="w-full">
            <Button variant="outline" size="sm" className="w-full" onClick={() => setEmailOpen(true)}>
                      <Mail className="h-3.5 w-3.5 mr-1.5" />
                      Enviar
                    </Button>
                  </EmailTemplateGate>
                )}
                {supportsProviderActions && !isCancelled && (!isKeyInvoice || documentType === 'invoice' || documentType === 'invoice_receipt') && (
                  <>
                    {!isKeyInvoice && !creditNoteId && (
                      <Button variant="outline" size="sm" onClick={() => setCreditNoteOpen(true)}>
                        <FileText className="h-3.5 w-3.5 mr-1.5" />
                        Nota Crédito
                      </Button>
                    )}
                    <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setCancelOpen(true)}>
                      <Ban className="h-3.5 w-3.5 mr-1.5" />
                      {isKeyInvoice ? 'Nota de Crédito' : 'Anular'}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Sub-modals */}
      {details && canSendFiscalEmail && (
        <SendInvoiceEmailModal
            open={emailOpen}
            onOpenChange={setEmailOpen}
            invoiceId={invoiceId}
            documentId={documentId}
            documentType={documentType}
            organizationId={organizationId}
            clientEmail={details.client?.email}
        />
      )}
      {details && supportsProviderActions && documentId != null && (
        <>
          <CreateCreditNoteModal
            open={creditNoteOpen}
            onOpenChange={setCreditNoteOpen}
            organizationId={organizationId}
            saleId={saleId}
            paymentId={paymentId}
            documentId={documentId}
            documentType={documentType}
            documentReference={ref}
          />
          <CancelInvoiceDialog
            open={cancelOpen}
            onOpenChange={setCancelOpen}
            onConfirm={handleCancel}
            isLoading={cancelInvoice.isPending}
            invoiceReference={ref}
            createsCreditNote={isKeyInvoice}
          />
        </>
      )}
    </>
  );
}
