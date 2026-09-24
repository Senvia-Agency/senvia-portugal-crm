import { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useModules } from "@/hooks/useModules";
import { Progress } from "@/components/ui/progress";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { 
  User, 
  Calendar, 
  FileText, 
  MessageSquare, 
  Phone,
  Package,
  Zap,
  Wrench,
  Pencil,
  Eye,
  CreditCard,
  ArrowLeft,
  FileDown,
  Mail,
  Info,
  Clock,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useUpdateSale } from "@/hooks/useSales";
import { useOrganization } from "@/hooks/useOrganization";
import { InvoiceDraftModal } from "./InvoiceDraftModal";
import type { DraftSaleItem } from "./InvoiceDraftModal";
import { useIssueInvoice } from "@/hooks/useIssueInvoice";
import { useIssueInvoiceReceipt } from "@/hooks/useIssueInvoiceReceipt";
import { useGenerateReceipt } from "@/hooks/useGenerateReceipt";
import { useSaleItems } from "@/hooks/useSaleItems";
import { useProducts } from "@/hooks/useProducts";
import { VatBadge, useVatCalculation, isInvoiceXpressActive as checkIxActive, getOrgTaxValue } from "./SaleFiscalInfo";
import { useProposalCpes } from "@/hooks/useProposalCpes";
import { useCommissionMatrix, getVolumeTier } from "@/hooks/useCommissionMatrix";
import { useCpes } from "@/hooks/useCpes";
import { formatCurrency } from "@/lib/format";
import { formatOperationalUnits } from "@/lib/sale-units";
import { CPE_STATUS_LABELS, CPE_STATUS_STYLES } from "@/types/cpes";
import {
  TELECOM_TECHNOLOGY_LABELS, MODELO_SERVICO_LABELS, NEGOTIATION_TYPE_LABELS } from "@/types/proposals";
import { useSaleCommissionSplits } from "@/hooks/useCommissionSplits";
import { useProfileNames } from "@/hooks/useTeam";
import type { SaleWithDetails, SaleStatus } from "@/types/sales";
import {
  SALE_STATUS_LABELS, SALE_STATUS_COLORS, SALE_STATUSES,
  TELECOM_STATUSES, TELECOM_STATUS_LABELS, TELECOM_STATUS_COLORS, TELECOM_STATUS_HINTS,
  TELECOM_TO_SALE_STATUS, type TelecomStatus,
} from "@/types/sales";

/** Radix Select can't hold an empty string as a value. */
const NO_TELECOM_STATUS = "__none__";
import { SalePaymentsList, useSaleFiscalDocuments } from "./SalePaymentsList";
import { RecurringSalePanel } from "./RecurringSalePanel";
import { useSalePayments, calculatePaymentSummary } from "@/hooks/useSalePayments";
import { SendInvoiceEmailModal } from "./SendInvoiceEmailModal";
import { InvoiceDetailsModal } from "./InvoiceDetailsModal";
import { CreateCreditNoteModal } from "./CreateCreditNoteModal";
import { openPdfInNewTab } from "@/lib/download";
import { useSaleActivationHistory } from "@/hooks/useSaleActivationHistory";
import { useSaleFieldsSettings } from "@/hooks/useSaleFieldsSettings";
import { isSalePaidInFull } from "@/lib/fiscal-eligibility";

interface SaleDetailsModalProps {
  sale: SaleWithDetails | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (sale: SaleWithDetails) => void;
}

export function SaleDetailsModal({ sale, open, onOpenChange, onEdit }: SaleDetailsModalProps) {
  const [status, setStatus] = useState<SaleStatus>("in_progress");
  const [notes, setNotes] = useState("");
  const [draftMode, setDraftMode] = useState<"invoice" | "invoice_receipt" | null>(null);
  const [showDeliveredConfirm, setShowDeliveredConfirm] = useState(false);
  const [invoiceEmailModal, setInvoiceEmailModal] = useState(false);
  const [invoiceDetailsModal, setInvoiceDetailsModal] = useState(false);
  const [invoiceCreditNoteModal, setInvoiceCreditNoteModal] = useState(false);
  const [pendingActivationDate, setPendingActivationDate] = useState("");

  const { organization, user } = useAuth();
  const queryClient = useQueryClient();
  const { data: fiscalDocuments = [], isLoading: fiscalDocumentsLoading } = useSaleFiscalDocuments(organization?.id, sale?.id);
  const { isAdmin } = usePermissions();
  const { data: orgData } = useOrganization();
  const salesSettings = (orgData?.sales_settings as { lock_delivered_sales?: boolean; lock_fulfilled_sales?: boolean; prevent_payment_deletion?: boolean }) || {};
  const lockDeliveredSales = !!salesSettings.lock_delivered_sales;
  const lockFulfilledSales = !!salesSettings.lock_fulfilled_sales;
  const preventPaymentDeletion = !!salesSettings.prevent_payment_deletion;
  const isDeliveredAndLocked = lockDeliveredSales && sale?.status === 'delivered' && !isAdmin;
  const isFulfilledAndLocked = lockFulfilledSales && sale?.status === 'fulfilled' && !isAdmin;
  const isCancelledAndLocked = sale?.status === 'cancelled' && !isAdmin;
  const isLocked = isDeliveredAndLocked || isFulfilledAndLocked || isCancelledAndLocked;

  const { data: saleItems = [] } = useSaleItems(sale?.id);
  const { data: products } = useProducts();
  const { data: rawProposalCpes = [] } = useProposalCpes(sale?.proposal_id ?? undefined);
  const { calculateEnergyCommission, hasEnergyConfig } = useCommissionMatrix();

  // Recalculate energy CPE commissions using current tier rules
  const proposalCpes = useMemo(() => {
    if (!hasEnergyConfig || rawProposalCpes.length === 0) return rawProposalCpes;
    return rawProposalCpes.map(cpe => {
      if (!cpe.margem || !cpe.consumo_anual) return cpe;
      const margem = Number(cpe.margem);
      if (margem <= 0) return cpe;
      const calc = calculateEnergyCommission(margem, getVolumeTier(Number(cpe.consumo_anual) || 0));
      if (calc === null) return cpe;
      return { ...cpe, comissao: calc };
    });
  }, [rawProposalCpes, hasEnergyConfig, calculateEnergyCommission]);
  const clientId = sale?.client_id || sale?.client?.id || null;
  const { data: clientCpes = [] } = useCpes(clientId);
  const updateSale = useUpdateSale();
  const issueInvoice = useIssueInvoice();
  const issueInvoiceReceipt = useIssueInvoiceReceipt();
  const generateReceipt = useGenerateReceipt();

  const { data: salePayments = [] } = useSalePayments(sale?.id);
  const hasPaidPayments = salePayments.some(p => p.status === 'paid');
  const paymentObligation = sale?.gross_value ?? sale?.total_value ?? 0;
  const paymentSummary = calculatePaymentSummary(salePayments, paymentObligation);

  const hasInvoiceXpress = checkIxActive(organization);
  const billingCompany = (sale?.billing_target ?? sale?.client?.billing_target) === 'company';
  const billingName = billingCompany ? sale?.client?.company : sale?.client?.name;
  const billingNif = billingCompany ? sale?.client?.company_nif : sale?.client?.nif;
  const hasCompanyFiscalAddress = !billingCompany || !!(
    (sale?.client?.company_address_same_as_client ? sale?.client?.address_line1 : sale?.client?.company_address_line1)?.trim()
    && (sale?.client?.company_address_same_as_client ? sale?.client?.city : sale?.client?.company_city)?.trim()
    && (sale?.client?.company_address_same_as_client ? sale?.client?.postal_code : sale?.client?.company_postal_code)?.trim()
    && (sale?.client?.company_address_same_as_client ? sale?.client?.country : sale?.client?.company_country)?.trim()
  );
  const saleDocumentType = sale?.invoicexpress_type === "FR" ? "invoice_receipt" : "invoice";
  const saleDocumentCandidates = fiscalDocuments.filter((document) =>
    document.payment_id == null
    && document.document_type === saleDocumentType
    && document.invoicexpress_id === sale?.invoicexpress_id);
  const saleFiscalDocument = saleDocumentCandidates.find((document) => document.reference === sale?.invoice_reference)
    || (saleDocumentCandidates.length === 1 ? saleDocumentCandidates[0] : null);
  const supportsInvoiceXpressActions = (organization?.billing_provider ?? "invoicexpress") === "invoicexpress"
    && saleFiscalDocument?.provider === "invoicexpress";
  const orgTaxValue = getOrgTaxValue(organization);

  // VAT calculation for display
  const vatCalc = useVatCalculation({
    items: saleItems.map(i => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price })),
    products,
    orgTaxValue,
    discount: sale?.discount || 0,
    subtotal: sale?.subtotal || 0,
  });

  // Conditional labels based on organization niche
  const isTelecom = organization?.niche === 'telecom';
  const { modules } = useModules();
  const showEnergy = isTelecom && modules.energy;
  const { data: saleFields } = useSaleFieldsSettings();
  const cpeLabel = isTelecom ? 'CPE/CUI (Pontos de Consumo)' : 'CPEs (Equipamentos)';
  const serialLabel = isTelecom ? 'Local de Consumo' : 'Nº Série';

  // The install is booked as a window ("das 9h às 12h"): the date column
  // carries the start, scheduled_install_end the end. A midnight start with
  // no end means only a day was agreed, so there is no window to show.
  const installWindow = (() => {
    const start = (sale?.scheduled_install_date?.split('T')[1] ?? '').slice(0, 5);
    const end = (sale?.scheduled_install_end?.split('T')[1] ?? '').slice(0, 5);
    if (!start || start === '00:00') return end ? `até ${end}` : '';
    return end ? `das ${start} às ${end}` : `às ${start}`;
  })();

  const [showFulfilledConfirm, setShowFulfilledConfirm] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<SaleStatus | null>(null);
  // Telecom has its own lifecycle and only that one — picking it writes
  // sales.status behind the scenes (TELECOM_TO_SALE_STATUS) so invoicing and
  // finance keep matching on it, same as the create/edit modals do.
  const [telecomStatus, setTelecomStatus] = useState<TelecomStatus | "">("");
  const [pendingTelecomStatus, setPendingTelecomStatus] = useState<TelecomStatus | null>(null);
  const { history: activationHistory, addEntry: addActivationEntry } = useSaleActivationHistory(sale?.id);

  useEffect(() => {
    if (sale) {
      setStatus(sale.status);
      setTelecomStatus((sale.telecom_status as TelecomStatus) || "");
      setNotes(sale.notes || "");
    }
  }, [sale]);

  // Per-beneficiary commission breakdown. Declared above the early return so
  // the hook order never changes between renders.
  const { data: commissionSplitsData } = useSaleCommissionSplits(sale?.id);
  const commissionSplits = commissionSplitsData ?? [];
  // A salesperson sees only what HE earns on this sale; what the colleagues
  // and the company make is not his to read. Admins see the whole breakdown.
  const visibleSplits = isAdmin
    ? commissionSplits
    : commissionSplits.filter((s) => s.user_id === user?.id);
  const myCommissionTotal = visibleSplits.reduce((sum, s) => sum + (s.amount || 0), 0);
  // What the SELLER earns on this sale — the sum of every frozen row, which in
  // this model is his alone. Unlike myCommissionTotal it doesn't depend on who
  // is looking, so an admin checking the sale sees the seller's real number.
  const sellerCommissionTotal = commissionSplits.reduce((sum, s) => sum + (s.amount || 0), 0);
  // Resolved straight from profiles — not from the active team roster, which
  // would blank out whoever made this sale if they were later deactivated.
  const { data: beneficiaryNames } = useProfileNames([
    sale?.seller_id,
    sale?.created_by,
    ...commissionSplits.map((s) => s.user_id),
  ]);
  const splitBeneficiaryName = (userId: string) => beneficiaryNames?.[userId] || 'Desconhecido';

  if (!sale) return null;

  // The install IS the activation: when a sale goes live, its activation
  // date is the booked install day. Nobody is asked for a second date.
  const installDay = sale.scheduled_install_date ? sale.scheduled_install_date.slice(0, 10) : null;
  const defaultActivation = () => sale.activation_date || installDay || new Date().toISOString().split('T')[0];

  const handleStatusChange = (newStatus: SaleStatus) => {
    if (isTelecom) {
      if (newStatus === 'delivered') {
        setPendingStatus('delivered');
        setPendingActivationDate(defaultActivation());
        setShowDeliveredConfirm(true);
        return;
      }
      if (newStatus === 'fulfilled') {
        setPendingStatus('fulfilled');
        setPendingActivationDate(defaultActivation());
        setShowFulfilledConfirm(true);
        return;
      }
      if (newStatus === 'in_progress') {
        setPendingStatus('in_progress');
        setPendingActivationDate(defaultActivation());
        setShowFulfilledConfirm(true);
        return;
      }
    }
    setStatus(newStatus);
    updateSale.mutate({ saleId: sale.id, updates: { status: newStatus } });
  };


  const confirmDelivered = () => {
    setStatus('delivered');
    if (pendingTelecomStatus) setTelecomStatus(pendingTelecomStatus);
    updateSale.mutate({ saleId: sale.id, updates: {
      status: 'delivered',
      activation_date: pendingActivationDate || null,
      ...(pendingTelecomStatus ? { telecom_status: pendingTelecomStatus } : {}),
    } });
    if (pendingActivationDate) {
      addActivationEntry.mutate({ activationDate: pendingActivationDate, notes: pendingTelecomStatus === 'instalado' ? 'Instalado' : 'Concluída' });
    }
    setShowDeliveredConfirm(false);
  };

  const confirmFulfilled = () => {
    const newStatus = pendingStatus || 'fulfilled';
    setStatus(newStatus as SaleStatus);
    if (pendingTelecomStatus) setTelecomStatus(pendingTelecomStatus);
    updateSale.mutate({ saleId: sale.id, updates: {
      status: newStatus as SaleStatus,
      activation_date: pendingActivationDate || null,
      ...(pendingTelecomStatus ? { telecom_status: pendingTelecomStatus } : {}),
    } });
    if (pendingActivationDate) {
      const label = newStatus === 'in_progress'
        ? 'Em Progresso'
        : (pendingTelecomStatus === 'ativo' ? 'Ativo' : 'Entregue');
      addActivationEntry.mutate({ activationDate: pendingActivationDate, notes: label });
    }
    setShowFulfilledConfirm(false);
  };

  /**
   * The telecom lifecycle IS the sale state here. Writes telecom_status and,
   * behind it, the generic sales.status the rest of the app (invoicing,
   * finance, filters) still matches on. Reuses the same activation-date
   * confirmations the generic flow already had.
   */
  const handleTelecomStatusChange = (next: TelecomStatus) => {
    const derived = TELECOM_TO_SALE_STATUS[next];

    if (derived === 'delivered' || derived === 'fulfilled' || derived === 'in_progress') {
      setPendingTelecomStatus(next);
      setPendingStatus(derived);
      setPendingActivationDate(defaultActivation());
      if (derived === 'delivered') setShowDeliveredConfirm(true);
      else setShowFulfilledConfirm(true);
      return;
    }

    setTelecomStatus(next);
    setStatus(derived);
    updateSale.mutate({ saleId: sale.id, updates: { status: derived, telecom_status: next } });
  };

  const handleNotesBlur = () => {
    if (notes !== sale.notes) {
      updateSale.mutate({ saleId: sale.id, updates: { notes } });
    }
  };


  const openWhatsApp = () => {
    const phone = sale.client?.phone || sale.lead?.phone;
    if (phone) {
      const cleaned = phone.replace(/\D/g, "");
      window.open(`https://wa.me/${cleaned}`, "_blank");
    }
  };

  // Check if has energy or service data
  const proposalCpesHaveEnergyValues = proposalCpes.some((cpe) =>
    cpe.consumo_anual != null ||
    cpe.margem != null ||
    cpe.dbl != null ||
    cpe.comissao != null ||
    cpe.duracao_contrato != null ||
    cpe.contrato_inicio != null ||
    cpe.contrato_fim != null
  );

  const displayConsumoAnual = sale.consumo_anual ?? (
    proposalCpes.some((cpe) => cpe.consumo_anual != null)
      ? proposalCpes.reduce((sum, cpe) => sum + (Number(cpe.consumo_anual) || 0), 0)
      : null
  );
  const displayMargem = sale.margem ?? (
    proposalCpes.some((cpe) => cpe.margem != null)
      ? proposalCpes.reduce((sum, cpe) => sum + (Number(cpe.margem) || 0), 0)
      : null
  );
  const displayComissao = sale.comissao ?? (
    proposalCpes.some((cpe) => cpe.comissao != null)
      ? proposalCpes.reduce((sum, cpe) => sum + (Number(cpe.comissao) || 0), 0)
      : null
  );
  const displayDbl = sale.dbl ?? proposalCpes.find((cpe) => cpe.dbl != null)?.dbl ?? null;
  const displayAnosContrato = sale.anos_contrato ?? proposalCpes.find((cpe) => cpe.duracao_contrato != null)?.duracao_contrato ?? null;
  const displayContratoInicio = proposalCpes
    .map((cpe) => cpe.contrato_inicio)
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? null;
  const displayContratoFim = proposalCpes
    .map((cpe) => cpe.contrato_fim)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  const hasEnergyData = sale.proposal_type === 'energia' && (
    sale.negotiation_type ||
    displayConsumoAnual != null ||
    displayMargem != null ||
    displayDbl != null ||
    displayAnosContrato != null ||
    displayComissao != null ||
    proposalCpesHaveEnergyValues
  );
  const saleServicosDetails = sale?.servicos_details ?? null;
  const hasServiceData = (sale.proposal_type === 'servicos' || (!sale.proposal_type && sale.servicos_produtos && sale.servicos_produtos.length > 0)) && (
    sale.modelo_servico || sale.kwp || sale.comissao || (sale.servicos_produtos && sale.servicos_produtos.length > 0)
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent variant="fullScreen" className="flex flex-col p-0 gap-0">
          {/* Header */}
          <DialogHeader className="pl-6 pr-14 py-4 border-b border-border/50 shrink-0">
            <DialogTitle className="text-base font-semibold">Detalhes da Venda</DialogTitle>
          </DialogHeader>


          {/* Content - 2 column layout */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-6xl mx-auto p-4 sm:p-6">
              {/* Mobile: Total first */}
              <div className="lg:hidden mb-4">
                <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
                  <p className="text-sm text-muted-foreground">
                    {/* Telecom is paid by the operator, not the client: the
                        contracted monthly price is not what this sale is worth
                        to us. Show the commission the seller earns on it. */}
                    {isTelecom ? 'Comissão' : hasInvoiceXpress ? 'Valor Total (s/ IVA)' : 'Valor Total'}
                  </p>
                  <p className="text-2xl font-bold text-primary">
                    {formatCurrency(isTelecom ? sellerCommissionTotal : sale.total_value)}
                  </p>
                  {hasInvoiceXpress && (
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-primary/10">
                      <span className="text-xs text-muted-foreground">IVA: {formatCurrency(vatCalc.totalVat)}</span>
                      <span className="text-sm font-semibold">c/ IVA: {formatCurrency(sale.gross_value ?? vatCalc.totalWithVat)}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* LEFT COLUMN (60%) */}
                <div className="lg:col-span-3 space-y-4">
                  {/* Sale Data Card */}
                  <Card>
                    <CardHeader className="pb-2 p-4">
                      <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                        <FileText className="h-4 w-4" />
                        Dados da Venda
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <p className="text-xs text-muted-foreground">Código</p>
                          <p className="text-sm font-medium font-mono">{sale.code}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Data da Venda</p>
                          <p className="text-sm font-medium">
                            {format(new Date(sale.sale_date), "d MMM yyyy", { locale: pt })}
                          </p>
                        </div>
                        <div>
                          {/* Who is paid for this sale — not necessarily who typed it in. */}
                          <p className="text-xs text-muted-foreground">Vendedor</p>
                          <p className="text-sm font-medium">
                            {sale.seller_id || sale.created_by
                              ? splitBeneficiaryName(sale.seller_id || sale.created_by!)
                              : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Estado</p>
                          {isTelecom ? (
                            <Select
                              value={telecomStatus || NO_TELECOM_STATUS}
                              onValueChange={(v) => v !== NO_TELECOM_STATUS && handleTelecomStatusChange(v as TelecomStatus)}
                              disabled={isLocked}
                            >
                              <SelectTrigger className={cn(
                                'w-full h-8 text-xs border mt-0.5',
                                telecomStatus && TELECOM_STATUS_COLORS[telecomStatus],
                              )}>
                                <SelectValue placeholder="Sem estado" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NO_TELECOM_STATUS} disabled>Sem estado</SelectItem>
                                {TELECOM_STATUSES.map((s) => (
                                  <SelectItem key={s} value={s}>
                                    <span className="flex flex-col items-start">
                                      <span className={cn('px-2 py-0.5 rounded text-xs font-medium', TELECOM_STATUS_COLORS[s])}>
                                        {TELECOM_STATUS_LABELS[s]}
                                      </span>
                                      {TELECOM_STATUS_HINTS[s] && (
                                        <span className="mt-0.5 text-[11px] text-muted-foreground">{TELECOM_STATUS_HINTS[s]}</span>
                                      )}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Select value={status} onValueChange={handleStatusChange} disabled={isLocked}>
                              <SelectTrigger className={cn('w-full h-8 text-xs border mt-0.5', SALE_STATUS_COLORS[status])}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {SALE_STATUSES.map((s) => (
                                  <SelectItem key={s} value={s}>
                                    <span className={cn('px-2 py-0.5 rounded text-xs font-medium', SALE_STATUS_COLORS[s])}>
                                      {SALE_STATUS_LABELS[s]}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                        {saleFields?.edp_proposal_number?.visible && (sale as any).edp_proposal_number && (
                          <div>
                            <p className="text-xs text-muted-foreground">{saleFields.edp_proposal_number.label}</p>
                            <p className="text-sm font-medium font-mono">{(sale as any).edp_proposal_number}</p>
                          </div>
                        )}
                        {isTelecom && sale.activation_date && sale.activation_date !== installDay && (
                          <div>
                            <p className="text-xs text-muted-foreground">Data de Ativação</p>
                            <p className="text-sm font-medium">
                              {format(new Date(sale.activation_date), "d MMM yyyy", { locale: pt })}
                            </p>
                          </div>
                        )}
                        {isTelecom && (sale.commission_payment_month_offset ?? 0) > 0 && (
                          <div>
                            <p className="text-xs text-muted-foreground">Mês previsto da comissão · M+{sale.commission_payment_month_offset}</p>
                            <p className="text-sm font-medium">
                              {sale.commission_expected_date ? format(new Date(`${sale.commission_expected_date}T12:00:00`), 'MMMM yyyy', { locale: pt }) : 'Aguarda ativação ou instalação'}
                            </p>
                          </div>
                        )}
                        {/* Always shown in telecom: the booked install slot is the
                            single most asked-about field on a sale. */}
                        {isTelecom && (
                          <div className="col-span-2">
                            <p className="text-xs text-muted-foreground">Data de Instalação</p>
                            {sale.scheduled_install_date ? (
                              <p className="text-sm font-medium">
                                {format(new Date(sale.scheduled_install_date), "d MMM yyyy", { locale: pt })}
                                {installWindow && (
                                  <span className="text-muted-foreground font-normal"> · {installWindow}</span>
                                )}
                              </p>
                            ) : (
                              <p className="text-sm font-medium text-muted-foreground">Sem data marcada</p>
                            )}
                          </div>
                        )}
                        {isTelecom && (sale as any).fidelizacao_end && (() => {
                          const end = new Date((sale as any).fidelizacao_end);
                          const days = Math.ceil((end.getTime() - Date.now()) / 86400000);
                          const tone = days < 0 ? "text-destructive" : days <= 30 ? "text-amber-600" : "";
                          return (
                            <div>
                              <p className="text-xs text-muted-foreground">Fim da fidelização</p>
                              <p className={`text-sm font-medium ${tone}`}>
                                {format(end, "d MMM yyyy", { locale: pt })}
                                <span className="text-muted-foreground font-normal">
                                  {" · "}{days < 0 ? `terminou há ${-days} dias` : days === 0 ? "termina hoje" : `faltam ${days} dias`}
                                </span>
                              </p>
                            </div>
                          );
                        })()}
                      </div>
                      {isLocked && (
                        <p className="text-xs text-muted-foreground mt-3">
                          Esta venda está {isDeliveredAndLocked ? 'concluída' : isCancelledAndLocked ? 'cancelada' : 'entregue'} e não pode ser alterada.
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  {/* Client Card */}
                  {(sale.client || sale.lead) && (
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                          <User className="h-4 w-4" />
                          Cliente
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{sale.client?.name || sale.lead?.name}</span>
                          {sale.client?.code && (
                            <Badge variant="outline" className="font-mono text-xs">
                              {sale.client.code}
                            </Badge>
                          )}
                        </div>

                        {sale.client && (
                          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                            <p className="text-xs text-muted-foreground">Faturar a {billingCompany ? 'empresa' : 'cliente'}</p>
                            <p className="font-medium">{billingName || 'Nome em falta'}</p>
                            <p className="text-muted-foreground">NIF: {billingNif || 'Não definido'}</p>
                            {billingCompany && !hasCompanyFiscalAddress && (
                              <p className="text-amber-600">Preenche a morada escolhida para a empresa na ficha do cliente para emitir.</p>
                            )}
                          </div>
                        )}

                        {(sale.client?.nif || sale.client?.company) && (
                          <div className="grid grid-cols-2 gap-2">
                            {sale.client?.nif && (
                              <div>
                                <p className="text-xs text-muted-foreground">NIF</p>
                                <p className="text-sm font-medium font-mono">{sale.client.nif}</p>
                              </div>
                            )}
                            {sale.client?.company && (
                              <div>
                                <p className="text-xs text-muted-foreground">Empresa</p>
                                <p className="text-sm font-medium">{sale.client.company}</p>
                              </div>
                            )}
                          </div>
                        )}

                        {(sale.client?.email || sale.lead?.email) && (
                          <div>
                            <p className="text-xs text-muted-foreground">Email</p>
                            <p className="text-sm">{sale.client?.email || sale.lead?.email}</p>
                          </div>
                        )}

                        {(sale.client?.phone || sale.lead?.phone) && (
                          <div className="flex items-center gap-2">
                            <Phone className="h-3 w-3 text-muted-foreground" />
                            <span className="text-sm">{sale.client?.phone || sale.lead?.phone}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-green-500 hover:text-green-400"
                              onClick={openWhatsApp}
                            >
                              <MessageSquare className="h-3 w-3 mr-1" />
                              WhatsApp
                            </Button>
                          </div>
                        )}

                        {(sale.client?.address_line1 || sale.client?.city || sale.client?.postal_code) && (
                          <div>
                            <p className="text-xs text-muted-foreground">Morada</p>
                            <div className="text-sm">
                              {sale.client?.address_line1 && <p>{sale.client.address_line1}</p>}
                              {sale.client?.address_line2 && <p>{sale.client.address_line2}</p>}
                              {(sale.client?.postal_code || sale.client?.city) && (
                                <p>
                                  {[sale.client?.postal_code, sale.client?.city].filter(Boolean).join(' ')}
                                </p>
                              )}
                              {sale.client?.country && sale.client.country !== 'Portugal' && (
                                <p>{sale.client.country}</p>
                              )}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Telecom: Energy Data */}
                  {showEnergy && hasEnergyData && (
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                          <Zap className="h-4 w-4 text-amber-500" />
                          Dados de Energia
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {sale.negotiation_type && (
                            <div className="sm:col-span-2">
                              <p className="text-xs text-muted-foreground">Tipo de Negociação</p>
                              <p className="text-sm font-medium">
                                {NEGOTIATION_TYPE_LABELS[sale.negotiation_type as keyof typeof NEGOTIATION_TYPE_LABELS] || sale.negotiation_type}
                              </p>
                            </div>
                          )}
                          {displayConsumoAnual != null && (
                            <div>
                              <p className="text-xs text-muted-foreground">Consumo Anual</p>
                              <p className="text-sm font-medium">{displayConsumoAnual.toLocaleString('pt-PT')} kWh</p>
                            </div>
                          )}
                          {displayAnosContrato != null && (
                            <div>
                              <p className="text-xs text-muted-foreground">Contrato</p>
                              <p className="text-sm font-medium">{displayAnosContrato} {displayAnosContrato === 1 ? 'ano' : 'anos'}</p>
                            </div>
                          )}
                          {displayDbl != null && (
                            <div>
                              <p className="text-xs text-muted-foreground">DBL</p>
                              <p className="text-sm font-medium">{displayDbl.toLocaleString('pt-PT', { minimumFractionDigits: 2 })}</p>
                            </div>
                          )}
                          {displayMargem != null && (
                            <div>
                              <p className="text-xs text-muted-foreground">Margem</p>
                              <p className="text-sm font-medium">{formatCurrency(displayMargem)}</p>
                            </div>
                          )}
                          {displayComissao != null && (
                            <div>
                              <p className="text-xs text-muted-foreground">Comissão</p>
                              <p className="text-sm font-medium text-green-500">{formatCurrency(displayComissao)}</p>
                            </div>
                          )}
                          {(displayContratoInicio || displayContratoFim) && (
                            <div className="sm:col-span-2">
                              <p className="text-xs text-muted-foreground">Período do Contrato</p>
                              <p className="text-sm font-medium">
                                {displayContratoInicio
                                  ? format(new Date(displayContratoInicio), "dd/MM/yyyy", { locale: pt })
                                  : '—'}
                                {' → '}
                                {displayContratoFim
                                  ? format(new Date(displayContratoFim), "dd/MM/yyyy", { locale: pt })
                                  : '—'}
                              </p>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Telecom: Service Data */}
                  {isTelecom && hasServiceData && (
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                          <Wrench className="h-4 w-4 text-blue-500" />
                          Dados do Serviço
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0">
                        <div className="grid grid-cols-2 gap-3">
                          {sale.negotiation_type && (
                            <div className="col-span-2">
                              <p className="text-xs text-muted-foreground">Tipo de Negociação</p>
                              <p className="text-sm font-medium">
                                {NEGOTIATION_TYPE_LABELS[sale.negotiation_type as keyof typeof NEGOTIATION_TYPE_LABELS] || sale.negotiation_type}
                              </p>
                            </div>
                          )}
                          {sale.servicos_produtos && sale.servicos_produtos.length > 0 && (
                            <div className="col-span-2 space-y-2">
                              <p className="text-xs text-muted-foreground">Serviços/Produtos</p>
                              {saleServicosDetails ? (
                                <div className="space-y-2">
                                  {sale.servicos_produtos.map((s) => {
                                    const detail = saleServicosDetails[s];
                                    return (
                                      <div key={s} className="p-2.5 rounded-lg border bg-muted/30 space-y-1">
                                        <div className="flex items-center justify-between gap-3">
                                          <span className="text-sm font-medium">{detail?.name || s}</span>
                                          <div className="flex shrink-0 items-center gap-2 text-sm">
                                            <span className="text-muted-foreground">
                                              Qtd. {formatOperationalUnits(detail?.quantidade ?? 1)}
                                            </span>
                                            {detail?.price != null && (
                                              <span className="font-medium">{formatCurrency(detail.price)}</span>
                                            )}
                                          </div>
                                        </div>
                                        {/* The operator frozen onto the sale, not the
                                            catalog's current one — a product can be moved
                                            between operators after the sale was made. */}
                                        {detail?.operator_name && (
                                          <Badge
                                            variant="outline"
                                            className="bg-primary/10 text-primary border-primary/30 text-[11px] font-semibold"
                                          >
                                            {detail.operator_name}
                                          </Badge>
                                        )}
                                        {/* Which technology was installed — the same
                                            product pays differently on each. */}
                                        {detail?.tecnologia && (
                                          <Badge
                                            variant="outline"
                                            className="bg-sky-500/10 text-sky-600 border-sky-500/30 text-[11px] font-medium"
                                          >
                                            {TELECOM_TECHNOLOGY_LABELS[detail.tecnologia]}
                                          </Badge>
                                        )}
                                        {/* No commission figure here on purpose. What used to sit
                                            on this line was servicos_details[...].comissao — a value
                                            frozen into the sale's JSON when it was created, which no
                                            recalculation ever revisits. It drifted from the real,
                                            server-frozen numbers shown just below and read as a
                                            contradiction. Those below are the truth. */}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {sale.servicos_produtos.map((s) => (
                                    <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {sale.modelo_servico && (
                            <div>
                              <p className="text-xs text-muted-foreground">Modelo</p>
                              <p className="text-sm font-medium">
                                {MODELO_SERVICO_LABELS[sale.modelo_servico as keyof typeof MODELO_SERVICO_LABELS] || sale.modelo_servico}
                              </p>
                            </div>
                          )}
                          {sale.kwp && (
                            <div>
                              <p className="text-xs text-muted-foreground">Potência</p>
                              <p className="text-sm font-medium">{sale.kwp.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} kWp</p>
                            </div>
                          )}
                          {(myCommissionTotal > 0 || (isAdmin && !!sale.comissao)) && (
                            <div className="col-span-2">
                              {/* The headline number is what people actually earn on this
                                  sale — never sales.comissao, which is the operator's gross
                                  and read as if it were the seller's pay. */}
                              <p className="text-xs text-muted-foreground">Comissão</p>
                              <p className="text-sm font-medium text-green-500">
                                {formatCurrency(myCommissionTotal)}
                              </p>
                              {/* The operator's gross and the org's margin belong to their own
                                  cards in Financeiro and no Dashboard — not here, where they
                                  read as if they were the seller's pay. */}
                              {visibleSplits.length > 0 && (
                                <div className="mt-2 space-y-1 border-t pt-2">
                                  <p className="text-xs text-muted-foreground">
                                    {isAdmin ? 'Repartição' : 'Detalhe'}
                                  </p>
                                  {visibleSplits.map((split) => (
                                    <div key={split.id} className="flex items-center justify-between gap-2">
                                      <span className="text-xs">
                                        {splitBeneficiaryName(split.user_id)}
                                        {split.product_name && (
                                          <span className="text-muted-foreground"> · {split.product_name}</span>
                                        )}
                                        {split.basis === 'pct' && (
                                          <span className="text-muted-foreground"> · {split.rate}%</span>
                                        )}
                                      </span>
                                      <span className="text-xs font-medium text-green-500">
                                        {formatCurrency(split.amount)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {/* What the sale leaves for the company once the seller
                                  took his own cut — admin-only, so it never reads as
                                  part of anyone's personal pay. */}
                              {isAdmin && !!sale.org_commission && (
                                <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
                                  <span className="text-xs text-muted-foreground">Comissão da organização</span>
                                  <span className="text-xs font-medium text-amber-600">
                                    {formatCurrency(sale.org_commission)}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Telecom: CPEs (proposal CPEs first, fallback to client CPEs) */}
                  {showEnergy && (proposalCpes.length > 0 || clientCpes.length > 0) && (
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                          <Zap className="h-4 w-4 text-amber-500" />
                          {cpeLabel}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0 space-y-2">
                        {proposalCpes.length > 0 ? (
                          proposalCpes.map((cpe) => (
                            <div
                              key={cpe.id}
                              className="p-3 rounded-lg border bg-muted/30 space-y-3"
                            >
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className="text-xs">{cpe.equipment_type}</Badge>
                                <Badge variant="secondary" className="text-xs">{cpe.comercializador}</Badge>
                                {sale.negotiation_type === 'renovacao' ? (
                                  <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-500 border-blue-500/30">Renovação</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs bg-green-500/10 text-green-500 border-green-500/30">Novo</Badge>
                                )}
                              </div>
                              {cpe.serial_number && (
                                <div>
                                  <p className="text-xs text-muted-foreground">{serialLabel}</p>
                                  <p className="text-sm font-mono">{cpe.serial_number}</p>
                                </div>
                              )}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {cpe.consumo_anual != null && (
                                  <div>
                                    <p className="text-xs text-muted-foreground">Consumo Anual</p>
                                    <p className="text-sm font-medium">{Number(cpe.consumo_anual).toLocaleString('pt-PT')} kWh</p>
                                  </div>
                                )}
                                {cpe.duracao_contrato != null && (
                                  <div>
                                    <p className="text-xs text-muted-foreground">Duração</p>
                                    <p className="text-sm font-medium">{cpe.duracao_contrato} {cpe.duracao_contrato === 1 ? 'ano' : 'anos'}</p>
                                  </div>
                                )}
                                {cpe.dbl != null && (
                                  <div>
                                    <p className="text-xs text-muted-foreground">DBL</p>
                                    <p className="text-sm font-medium">{Number(cpe.dbl).toLocaleString('pt-PT', { minimumFractionDigits: 2 })}</p>
                                  </div>
                                )}
                                {cpe.margem != null && (
                                  <div>
                                    <p className="text-xs text-muted-foreground">Margem</p>
                                    <p className="text-sm font-medium">{formatCurrency(Number(cpe.margem))}</p>
                                  </div>
                                )}
                                {cpe.comissao != null && (
                                  <div>
                                    <p className="text-xs text-muted-foreground">Comissão</p>
                                    <p className="text-sm font-medium text-green-500">{formatCurrency(Number(cpe.comissao))}</p>
                                  </div>
                                )}
                                {(cpe.contrato_inicio || cpe.contrato_fim) && (
                                  <div>
                                    <p className="text-xs text-muted-foreground">Contrato</p>
                                    <p className="text-sm">
                                      {cpe.contrato_inicio
                                        ? format(new Date(cpe.contrato_inicio), "dd/MM/yyyy", { locale: pt })
                                        : '—'}
                                      {' → '}
                                      {cpe.contrato_fim
                                        ? format(new Date(cpe.contrato_fim), "dd/MM/yyyy", { locale: pt })
                                        : '—'}
                                    </p>
                                  </div>
                                )}
                                {(cpe.fidelizacao_start || cpe.fidelizacao_end) && (
                                  <div className="sm:col-span-2">
                                    <p className="text-xs text-muted-foreground">Fidelização</p>
                                    <p className="text-sm">
                                      {cpe.fidelizacao_start 
                                        ? format(new Date(cpe.fidelizacao_start), "dd/MM/yyyy", { locale: pt })
                                        : '—'
                                      }
                                      {' → '}
                                      {cpe.fidelizacao_end 
                                        ? format(new Date(cpe.fidelizacao_end), "dd/MM/yyyy", { locale: pt })
                                        : '—'
                                      }
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))
                        ) : (
                          clientCpes.map((cpe) => {
                            const statusStyle = CPE_STATUS_STYLES[cpe.status as keyof typeof CPE_STATUS_STYLES];
                            return (
                              <div
                                key={cpe.id}
                                className="p-3 rounded-lg border bg-muted/30 space-y-2"
                              >
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge variant="outline" className="text-xs">{cpe.equipment_type}</Badge>
                                  <Badge variant="secondary" className="text-xs">{cpe.comercializador}</Badge>
                                  {statusStyle && (
                                    <Badge variant="outline" className={`text-xs ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
                                      {CPE_STATUS_LABELS[cpe.status as keyof typeof CPE_STATUS_LABELS]}
                                    </Badge>
                                  )}
                                </div>
                                {cpe.serial_number && (
                                  <div>
                                    <p className="text-xs text-muted-foreground">{serialLabel}</p>
                                    <p className="text-sm font-mono">{cpe.serial_number}</p>
                                  </div>
                                )}
                                {(cpe.fidelizacao_start || cpe.fidelizacao_end) && (
                                  <div>
                                    <p className="text-xs text-muted-foreground">Fidelização</p>
                                    <p className="text-sm">
                                      {cpe.fidelizacao_start 
                                        ? format(new Date(cpe.fidelizacao_start), "dd/MM/yyyy", { locale: pt })
                                        : '—'
                                      }
                                      {' → '}
                                      {cpe.fidelizacao_end 
                                        ? format(new Date(cpe.fidelizacao_end), "dd/MM/yyyy", { locale: pt })
                                        : '—'
                                      }
                                    </p>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Products/Services */}
                  {!isTelecom && saleItems.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                          <Package className="h-4 w-4" />
                          Produtos/Serviços
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0 space-y-2">
                        {saleItems.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between p-2.5 rounded-lg border bg-muted/30"
                          >
                            <div>
                              <div className="flex items-center gap-1.5">
                                <p className="font-medium text-sm">{item.name}</p>
                                {hasInvoiceXpress && <VatBadge taxValue={vatCalc.getItemTaxRate(item.product_id)} />}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {item.quantity} × {formatCurrency(item.unit_price)}
                              </p>
                            </div>
                            <p className="font-semibold text-sm">{formatCurrency(item.total)}</p>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  {/* Payments Section (hidden for telecom) */}
                  {!isTelecom && organization && (
                    <Card>
                      <CardContent className="p-4">
                        <SalePaymentsList
                          saleId={sale.id}
                          organizationId={organization.id}
                          saleTotal={paymentObligation}
                          readonly={false}
                          hasInvoiceXpress={hasInvoiceXpress}
                          invoicexpressId={sale.invoicexpress_id}
                          invoicexpressType={sale.invoicexpress_type}
                          invoiceReference={sale.invoice_reference}
                          invoiceQrCodeUrl={(sale as any).qr_code_url}
                          invoicePdfUrl={(sale as any).invoice_pdf_url}
                          clientNif={billingNif}
                          clientName={billingName || sale.lead?.name}
                          clientEmail={sale.client?.email || sale.lead?.email}
                          taxConfig={organization?.tax_config as { tax_value?: number; tax_exemption_reason?: string } | null}
                          creditNoteId={sale.credit_note_id}
                          preventPaymentDeletion={preventPaymentDeletion}
                        />
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* RIGHT COLUMN (40%) */}
                <div className="lg:col-span-2 space-y-4">
                  <div className="lg:sticky lg:top-6 space-y-4">
                    {/* Total Value - Desktop only (mobile shown above) */}
                    <div className="hidden lg:block">
                      <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
                        <p className="text-sm text-muted-foreground">
                          {isTelecom ? 'Comissão' : hasInvoiceXpress ? 'Valor Total (s/ IVA)' : 'Valor Total'}
                        </p>
                        <p className="text-2xl font-bold text-primary">
                          {formatCurrency(isTelecom ? sellerCommissionTotal : sale.total_value)}
                        </p>
                        {hasInvoiceXpress && (
                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-primary/10">
                            <span className="text-xs text-muted-foreground">IVA: {formatCurrency(vatCalc.totalVat)}</span>
                            <span className="text-sm font-semibold">c/ IVA: {formatCurrency(sale.gross_value ?? vatCalc.totalWithVat)}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Payment Progress */}
                    {!isTelecom && salePayments.length > 0 && (
                      <Card>
                        <CardHeader className="pb-2 p-4">
                          <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                            <CreditCard className="h-4 w-4" />
                            Pagamento
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 pt-0 space-y-4">
                          <div className="space-y-2">
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>Progresso</span>
                              <span>{Math.round(paymentSummary.percentage)}%</span>
                            </div>
                            <Progress value={paymentSummary.percentage} className="h-2" />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-xs text-muted-foreground">Total Pago</p>
                              <p className="text-sm font-semibold text-green-500">{formatCurrency(paymentSummary.totalPaid)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Em Falta</p>
                              <p className="text-sm font-semibold text-amber-500">{formatCurrency(paymentSummary.remaining)}</p>
                            </div>
                          </div>
                          {paymentSummary.totalScheduled > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground">Agendado</p>
                              <p className="text-sm font-semibold">{formatCurrency(paymentSummary.totalScheduled)}</p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}

                    {/* Proposal Info */}
                    {sale.proposal && (
                      <Card>
                        <CardHeader className="pb-2 p-4">
                          <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                            <FileText className="h-4 w-4" />
                            Proposta Associada
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 pt-0">
                          <div className="flex items-center gap-2 text-sm">
                            {sale.proposal.code && (
                              <Badge variant="outline" className="font-mono text-xs">
                                {sale.proposal.code}
                              </Badge>
                            )}
                            <span>
                              {format(new Date(sale.proposal.proposal_date), "d MMM yyyy", { locale: pt })}
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Painel por ciclo: o resumo antigo mostrava só a próxima
                        renovação, sem histórico — não dava para ver que meses
                        foram cobrados nem quais ficaram por liquidar. */}
                    {sale.has_recurring && organization && (
                      <RecurringSalePanel saleId={sale.id} />
                    )}

                    {/* Activation History (telecom only) */}
                    {isTelecom && activationHistory.length > 0 && (
                      <Card>
                        <CardHeader className="pb-2 p-4">
                          <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                            <Clock className="h-4 w-4" />
                            Histórico de Ativação
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 pt-0">
                          <div className="space-y-3">
                            {activationHistory.map((entry, idx) => (
                              <div key={entry.id} className="flex gap-3">
                                <div className="flex flex-col items-center">
                                  <div className="h-2 w-2 rounded-full bg-primary mt-1.5" />
                                  {idx < activationHistory.length - 1 && (
                                    <div className="w-px flex-1 bg-border mt-1" />
                                  )}
                                </div>
                                <div className="pb-3 min-w-0">
                                  <p className="text-sm font-medium">
                                    {format(new Date(entry.activation_date), "d MMM yyyy", { locale: pt })}
                                  </p>
                                  {entry.notes && (
                                    <Badge variant="outline" className="text-[10px] mt-0.5">
                                      {entry.notes}
                                    </Badge>
                                  )}
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {entry.profile?.full_name || 'Sistema'} · {format(new Date(entry.created_at), "d MMM yyyy HH:mm", { locale: pt })}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Observations */}
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Observações</CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0">
                        <Textarea
                          placeholder="Adicionar observações..."
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          onBlur={handleNotesBlur}
                          rows={3}
                          className="min-h-[60px]"
                        />
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="p-4 border-t border-border/50 shrink-0">
            <div className="flex gap-3 max-w-6xl mx-auto">
              {(() => {
                const canEmit = hasInvoiceXpress && !sale.invoicexpress_id && !!billingName && !!billingNif && hasCompanyFiscalAddress && !sale.credit_note_id;
                if (canEmit) {
                  const paidInFull = isSalePaidInFull(paymentObligation, salePayments);
                  const mode = paidInFull ? "invoice_receipt" as const : "invoice" as const;
                  const emitLabel = paidInFull ? "Emitir Fatura-Recibo" : "Emitir Fatura";
                  return (
                    <>
                      <Button
                        variant="secondary"
                        className="flex-1"
                        onClick={() => setDraftMode(mode)}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        Ver Rascunho Fatura
                      </Button>
                      <Button
                        variant="senvia"
                        className="flex-1"
                        disabled={issueInvoice.isPending || issueInvoiceReceipt.isPending}
                        onClick={() => {
                          if (mode === 'invoice_receipt') {
                            issueInvoiceReceipt.mutate({ saleId: sale.id, organizationId: organization?.id || '' }, {
                              onSuccess: () => queryClient.invalidateQueries({ queryKey: ["invoices", organization?.id, "sale", sale.id] }),
                            });
                          } else {
                            issueInvoice.mutate({ saleId: sale.id, organizationId: organization?.id || '' });
                          }
                        }}
                      >
                        {(issueInvoice.isPending || issueInvoiceReceipt.isPending) ? (
                          <span className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        ) : (
                          <FileText className="h-4 w-4 mr-2" />
                        )}
                        {emitLabel}
                      </Button>
                    </>
                  );
                }

                // Post-emission actions
                const hasInvoice = !!sale.invoicexpress_id;
                if (hasInvoice) {
                  return (
                    <>
                      {sale.invoice_pdf_url && (
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={() => openPdfInNewTab(sale.invoice_pdf_url!)}
                        >
                          <FileDown className="h-4 w-4 mr-2" />
                          Ver PDF
                        </Button>
                      )}
                      {supportsInvoiceXpressActions && (sale.client?.email || sale.lead?.email) && (
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={() => setInvoiceEmailModal(true)}
                        >
                          <Mail className="h-4 w-4 mr-2" />
                          Enviar Email
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        className="flex-1"
                        disabled={fiscalDocumentsLoading || (organization?.billing_provider === 'vendus' && !saleFiscalDocument)}
                        onClick={() => setInvoiceDetailsModal(true)}
                      >
                        <Info className="h-4 w-4 mr-2" />
                        Detalhes
                      </Button>
                      {supportsInvoiceXpressActions && !sale.credit_note_id && (
                        <Button
                          variant="destructive"
                          className="flex-1"
                          onClick={() => setInvoiceCreditNoteModal(true)}
                        >
                          <FileText className="h-4 w-4 mr-2" />
                          Nota de Crédito
                        </Button>
                      )}
                    </>
                  );
                }

                return null;
              })()}
              {sale.status !== 'cancelled' && onEdit && !isLocked && (
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    onOpenChange(false);
                    onEdit(sale);
                  }}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Editar Venda
                </Button>
              )}
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => onOpenChange(false)}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Voltar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delivered Confirmation Dialog */}
      <AlertDialog open={showDeliveredConfirm} onOpenChange={setShowDeliveredConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingTelecomStatus === 'instalado' ? 'Marcar como Instalada' : 'Concluir Venda'}</AlertDialogTitle>
            <AlertDialogDescription>
              Ao concluir esta venda, ela não poderá mais ser editada (exceto por administradores).
              {installDay ? ` A ativação fica com a data de instalação (${installDay.split('-').reverse().join('/')}).` : ' Sem data de instalação marcada, a ativação fica com a data de hoje.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelivered}>
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Fulfilled / In Progress Confirmation Dialog */}
      <AlertDialog open={showFulfilledConfirm} onOpenChange={setShowFulfilledConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingStatus === 'in_progress'
                ? 'Marcar como Em Progresso'
                : (pendingTelecomStatus === 'ativo' ? 'Marcar como Ativa' : 'Marcar como Entregue')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {installDay ? `A ativação fica com a data de instalação (${installDay.split('-').reverse().join('/')}).` : 'Sem data de instalação marcada, a ativação fica com a data de hoje.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmFulfilled}>
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Invoice Draft Modal */}
      {draftMode && (
        <InvoiceDraftModal
          open={!!draftMode}
          onOpenChange={(open) => { if (!open) setDraftMode(null); }}
          mode={draftMode}
          onConfirm={(obs) => {
            if (draftMode === 'invoice_receipt') {
              issueInvoiceReceipt.mutate({ saleId: sale.id, organizationId: organization?.id || '', observations: obs }, {
                onSuccess: () => queryClient.invalidateQueries({ queryKey: ["invoices", organization?.id, "sale", sale.id] }),
              });
            } else {
              issueInvoice.mutate({ saleId: sale.id, organizationId: organization?.id || '', observations: obs });
            }
          }}
          isLoading={issueInvoice.isPending || issueInvoiceReceipt.isPending}
          clientName={billingName || sale.lead?.name || ''}
          clientNif={billingNif || ''}
          amount={sale.total_value}
          paymentDate={sale.sale_date}
          saleTotal={paymentObligation}
          saleItems={saleItems.map((item: any) => ({
            name: item.name,
            quantity: Number(item.quantity),
            unit_price: Number(item.unit_price),
            tax_value: item.product?.tax_value ?? null,
          }))}
          payments={salePayments}
          taxConfig={{
            tax_value: orgTaxValue,
            tax_exemption_reason: (organization?.tax_config as { tax_exemption_reason?: string } | null)?.tax_exemption_reason,
          }}
        />
      )}

      {/* Post-emission modals */}
      {sale.invoicexpress_id && organization && (
        <>
          {supportsInvoiceXpressActions && <SendInvoiceEmailModal
            open={invoiceEmailModal}
            onOpenChange={setInvoiceEmailModal}
            documentId={sale.invoicexpress_id}
            documentType={(sale.invoicexpress_type === 'FR' ? 'invoice_receipt' : 'invoice') as any}
            organizationId={organization.id}
            reference={sale.invoice_reference || `${sale.invoicexpress_type || 'FT'} #${sale.invoicexpress_id}`}
            clientEmail={sale.client?.email || sale.lead?.email}
          />}
          <InvoiceDetailsModal
            open={invoiceDetailsModal}
            onOpenChange={setInvoiceDetailsModal}
            documentId={sale.invoicexpress_id}
            invoiceId={saleFiscalDocument?.id}
            provider={saleFiscalDocument?.provider}
            documentType={(sale.invoicexpress_type === 'FR' ? 'invoice_receipt' : 'invoice') as any}
            organizationId={organization.id}
            saleId={sale.id}
          />
          {supportsInvoiceXpressActions && <CreateCreditNoteModal
            open={invoiceCreditNoteModal}
            onOpenChange={setInvoiceCreditNoteModal}
            organizationId={organization.id}
            saleId={sale.id}
            documentId={sale.invoicexpress_id}
            documentType={(sale.invoicexpress_type === 'FR' ? 'invoice_receipt' : 'invoice') as any}
            documentReference={sale.invoice_reference || `${sale.invoicexpress_type || 'FT'} #${sale.invoicexpress_id}`}
          />}
        </>
      )}
    </>
  );
}
