
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Download, Search, CreditCard, X, CheckCircle, Receipt, FileText, ArrowUpDown, ArrowUp, ArrowDown, Plus } from "lucide-react";
import { AddRevenueModal } from "@/components/finance/AddRevenueModal";
import { useAllPayments } from "@/hooks/useAllPayments";
import { useUpdateSalePayment } from "@/hooks/useSalePayments";
import { useGenerateReceipt } from "@/hooks/useGenerateReceipt";
import { useIssueInvoiceReceipt } from "@/hooks/useIssueInvoiceReceipt";
import { useSaleItems } from "@/hooks/useSaleItems";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency, formatDate, billingPeriodLabel } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useState, useMemo, useEffect } from "react";
import { usePersistedState } from "@/hooks/usePersistedState";
import { matchesSearch } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, PAYMENT_RECORD_STATUS_LABELS, PaymentMethod } from "@/types/sales";
import { exportToExcel } from "@/lib/export";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import { startOfDay, endOfDay, parseISO, format } from "date-fns";
import type { PaymentWithSale } from "@/types/finance";
import { InvoiceDraftModal, type DraftSaleItem } from "@/components/sales/InvoiceDraftModal";
import { isBillingActive } from "@/components/sales/SaleFiscalInfo";
import { isSalePaidInFull } from "@/lib/fiscal-eligibility";
import { toast } from "sonner";

type SortField = 'payment_date' | 'sale_code' | 'client_name' | 'amount' | 'payment_method' | 'status';
type SortDirection = 'asc' | 'desc';

const SortIcon = ({ field, sortField, sortDirection }: { field: SortField; sortField: SortField; sortDirection: SortDirection }) => {
  if (field !== sortField) return <ArrowUpDown className="h-3.5 w-3.5 ml-1 opacity-50" />;
  return sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 ml-1" /> : <ArrowDown className="h-3.5 w-3.5 ml-1" />;
};

export default function FinancePayments() {
  const { data: payments, isLoading } = useAllPayments();
  const { organization } = useAuth();
  const updatePayment = useUpdateSalePayment();
  const generateReceipt = useGenerateReceipt();
  const issueInvoiceReceipt = useIssueInvoiceReceipt();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = usePersistedState("payments-search-v1", "");
  const [statusFilter, setStatusFilter] = usePersistedState("payments-status-v1", "all");
  const [methodFilter, setMethodFilter] = usePersistedState("payments-method-v1", "all");
  const [dateRange, setDateRange] = usePersistedState<DateRange | undefined>("payments-daterange-v1", undefined);
  const [confirmPayment, setConfirmPayment] = useState<PaymentWithSale | null>(null);
  const [draftPayment, setDraftPayment] = useState<PaymentWithSale | null>(null);
  const [draftMode, setDraftMode] = useState<"receipt" | "invoice_receipt">("receipt");
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | "">("");
  const [showRevenueModal, setShowRevenueModal] = useState(false);
  const SORT_KEY = 'finance-payments-sort-v1';
  const VALID_FIELDS: SortField[] = ['payment_date', 'sale_code', 'client_name', 'amount', 'payment_method', 'status'];

  const [sortField, setSortField] = useState<SortField>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SORT_KEY) || '{}');
      if (VALID_FIELDS.includes(saved.field)) return saved.field;
    } catch {}
    return 'payment_date';
  });
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SORT_KEY) || '{}');
      if (saved.direction === 'asc' || saved.direction === 'desc') return saved.direction;
    } catch {}
    return 'desc';
  });

  useEffect(() => {
    try { localStorage.setItem(SORT_KEY, JSON.stringify({ field: sortField, direction: sortDirection })); } catch {}
  }, [sortField, sortDirection]);

  const hasFiscalIntegration = isBillingActive(organization);
  const taxConfig = organization?.tax_config as { tax_value?: number; tax_exemption_reason?: string } | null;

  // Load sale items when draft modal is open
  const { data: saleItems } = useSaleItems(draftPayment?.sale_id);

  // Read filters from URL on mount
  useEffect(() => {
    const statusFromUrl = searchParams.get('status');
    if (statusFromUrl === 'pending' || statusFromUrl === 'paid' || statusFromUrl === 'overdue') {
      setStatusFilter(statusFromUrl);
    }
    // Coming from the global "Pendente" card: clear any persisted date filter
    // so all pending payments are visible regardless of month.
    if (searchParams.get('clearDates') === '1') {
      setDateRange(undefined);
      return;
    }
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    if (fromParam) {
      setDateRange({
        from: parseISO(fromParam),
        to: toParam ? parseISO(toParam) : undefined,
      });
    }
  }, [searchParams]);

  const filteredPayments = useMemo(() => {
    if (!payments) return [];

    return payments.filter(payment => {
      if (dateRange?.from) {
        const paymentDate = parseISO(payment.payment_date);
        if (paymentDate < startOfDay(dateRange.from)) return false;
        if (dateRange.to && paymentDate > endOfDay(dateRange.to)) return false;
      }
      if (statusFilter === 'overdue') {
        if (payment.status !== 'pending') return false;
        const paymentDate = parseISO(payment.payment_date);
        if (paymentDate >= startOfDay(new Date())) return false;
      } else if (statusFilter !== "all" && payment.status !== statusFilter) return false;
      if (methodFilter !== "all" && payment.payment_method !== methodFilter) return false;
      if (searchTerm) {
        return matchesSearch(
          searchTerm,
          payment.client_name,
          payment.lead_name,
          payment.sale.code,
          payment.invoice_reference,
        );
      }
      return true;
    });
  }, [payments, searchTerm, statusFilter, methodFilter, dateRange]);

  const hasActiveFilters = searchTerm || statusFilter !== "all" || methodFilter !== "all" || dateRange?.from;

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection(field === 'payment_date' ? 'desc' : 'asc');
    }
  };

  const sortedPayments = useMemo(() => {
    return [...filteredPayments].sort((a, b) => {
      const dir = sortDirection === 'asc' ? 1 : -1;
      switch (sortField) {
        case 'payment_date':
          return dir * (a.payment_date.localeCompare(b.payment_date));
        case 'sale_code':
          return dir * ((a.sale.code || '').localeCompare(b.sale.code || ''));
        case 'client_name': {
          const nameA = (a.client_name || a.lead_name || '').toLowerCase();
          const nameB = (b.client_name || b.lead_name || '').toLowerCase();
          return dir * nameA.localeCompare(nameB);
        }
        case 'amount':
          return dir * (a.amount - b.amount);
        case 'payment_method':
          return dir * ((a.payment_method || '').localeCompare(b.payment_method || ''));
        case 'status':
          return dir * (a.status.localeCompare(b.status));
        default:
          return 0;
      }
    });
  }, [filteredPayments, sortField, sortDirection]);
  const clearFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setMethodFilter("all");
    setDateRange(undefined);
  };

  const handleExport = () => {
    const exportData = filteredPayments.map(p => ({
      Data: formatDate(p.payment_date),
      Venda: `#${p.sale.code}`,
      Cliente: p.client_name || p.lead_name || '-',
      Valor: p.amount,
      Método: p.payment_method ? PAYMENT_METHOD_LABELS[p.payment_method] : '-',
      Fatura: p.invoice_reference || '-',
      Estado: PAYMENT_RECORD_STATUS_LABELS[p.status],
    }));
    exportToExcel(exportData, 'pagamentos');
  };

  const availableMethods = useMemo(() => {
    if (!payments) return [];
    const methods = new Set(payments.map(p => p.payment_method).filter(Boolean));
    return Array.from(methods) as PaymentMethod[];
  }, [payments]);

  const openConfirmDialog = (payment: PaymentWithSale) => {
    setSelectedMethod(payment.payment_method || "");
    setConfirmPayment(payment);
  };

  const handleMarkAsPaid = () => {
    if (!confirmPayment) return;
    const updates: Record<string, unknown> = {
      status: 'paid',
      payment_date: format(new Date(), 'yyyy-MM-dd'),
    };
    if (selectedMethod) {
      updates.payment_method = selectedMethod;
    }
    updatePayment.mutate(
      {
        paymentId: confirmPayment.id,
        saleId: confirmPayment.sale_id,
        updates,
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['all-payments'] });
          setConfirmPayment(null);
        },
        onError: () => {
          setConfirmPayment(null);
        },
      }
    );
  };

  const canEmitDocument = (payment: PaymentWithSale) => {
    if (!hasFiscalIntegration) return false;
    if (payment.status !== 'paid') return false;
    if ((payment.reversal_status ?? 'none') !== 'none' || Number(payment.reversed_amount ?? 0) > 0) return false;
    if (payment.invoice_reference) return false;
    const mode = getDocumentMode(payment);
    if (mode === 'invoice_receipt') {
      // FR belongs to the sale, not to each instalment. Show a single action
      // on the newest confirmed payment instead of one duplicate per row.
      const representative = (payments ?? []).find((candidate) =>
        candidate.sale_id === payment.sale_id
        && candidate.status === 'paid'
        && (candidate.reversal_status ?? 'none') === 'none'
        && Number(candidate.reversed_amount ?? 0) === 0,
      );
      return representative?.id === payment.id;
    }
    return mode === 'receipt';
  };

  const getDocumentMode = (payment: PaymentWithSale): "receipt" | "invoice_receipt" | null => {
    // A receipt only settles an existing FT. An existing FR is already both
    // invoice and receipt and must not produce a second receipt.
    if (payment.sale.invoicexpress_id) {
      return payment.sale.invoicexpress_type === 'FT' ? 'receipt' : null;
    }

    // The payments page contains individual instalments. Looking only at this
    // row (or merely checking that every scheduled row is paid) could issue an
    // FR for a partial amount. Sum every confirmed payment for this sale.
    const paymentsForSale = (payments ?? []).filter((candidate) => candidate.sale_id === payment.sale_id);
    const paymentObligation = payment.sale.gross_value ?? payment.sale.total_value;
    return isSalePaidInFull(paymentObligation, paymentsForSale)
      ? 'invoice_receipt'
      : null;
  };

  const handleOpenDraft = (payment: PaymentWithSale) => {
    const mode = getDocumentMode(payment);
    if (!mode) return;
    setDraftMode(mode);
    setDraftPayment(payment);
  };

  const handleConfirmDraft = (obs?: string) => {
    if (!draftPayment || !organization) return;

    if (
      draftPayment.status !== 'paid'
      || (draftPayment.reversal_status ?? 'none') !== 'none'
      || Number(draftPayment.reversed_amount ?? 0) > 0
      || getDocumentMode(draftPayment) !== draftMode
    ) {
      toast.error('O estado do pagamento já não permite emitir este documento. Atualiza a página e tenta novamente.');
      return;
    }

    if (draftMode === "receipt") {
      generateReceipt.mutate(
        { saleId: draftPayment.sale_id, paymentId: draftPayment.id, organizationId: organization.id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['all-payments'] });
            setDraftPayment(null);
          },
        }
      );
    } else {
      issueInvoiceReceipt.mutate(
        { saleId: draftPayment.sale_id, organizationId: organization.id, observations: obs },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['all-payments'] });
            setDraftPayment(null);
          },
        }
      );
    }
  };

  const draftSaleItems: DraftSaleItem[] = (saleItems || []).map(item => ({
    name: item.name,
    quantity: item.quantity,
    unit_price: Number(item.unit_price),
    tax_value: (item.product as any)?.tax_value ?? null,
  }));

  return (
    <>
      <div className="p-4 md:p-6 lg:p-8 space-y-6 pb-20 md:pb-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => navigate('/financeiro')}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <CreditCard className="h-5 w-5 shrink-0 text-primary" />
                Pagamentos
              </h1>
              <p className="text-sm text-muted-foreground">
                Histórico de todos os pagamentos
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setShowRevenueModal(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Adicionar Receita</span>
            </Button>
            <Button onClick={handleExport} variant="outline" className="gap-2">
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Exportar</span>
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Pesquisar por cliente, venda ou fatura..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <DateRangePicker
                  value={dateRange}
                  onChange={setDateRange}
                  placeholder="Período"
                  className="w-full xs:w-auto"
                />
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full xs:w-32">
                    <SelectValue placeholder="Estado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="paid">Pagos</SelectItem>
                    <SelectItem value="pending">Agendados</SelectItem>
                    <SelectItem value="overdue">Atrasados</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={methodFilter} onValueChange={setMethodFilter}>
                  <SelectTrigger className="w-full xs:w-36">
                    <SelectValue placeholder="Método" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos métodos</SelectItem>
                    {availableMethods.map(method => (
                      <SelectItem key={method} value={method}>
                        {PAYMENT_METHOD_LABELS[method]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {hasActiveFilters && (
                  <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-muted-foreground">
                    <X className="h-4 w-4" />
                    Limpar
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {hasActiveFilters && !isLoading && (
          <p className="text-sm text-muted-foreground">
            {filteredPayments.length} pagamento(s) encontrado(s)
          </p>
        )}

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-3 p-6">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : filteredPayments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <CreditCard className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">Nenhum pagamento encontrado</p>
                {hasActiveFilters && (
                  <Button variant="link" onClick={clearFilters} className="mt-2">
                    Limpar filtros
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="cursor-pointer select-none" onClick={() => handleSort('payment_date')}>
                        <span className="flex items-center">Data<SortIcon field="payment_date" sortField={sortField} sortDirection={sortDirection} /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer select-none" onClick={() => handleSort('sale_code')}>
                        <span className="flex items-center">Venda<SortIcon field="sale_code" sortField={sortField} sortDirection={sortDirection} /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer select-none" onClick={() => handleSort('client_name')}>
                        <span className="flex items-center">Cliente<SortIcon field="client_name" sortField={sortField} sortDirection={sortDirection} /></span>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer select-none" onClick={() => handleSort('amount')}>
                        <span className="flex items-center justify-end">Valor<SortIcon field="amount" sortField={sortField} sortDirection={sortDirection} /></span>
                      </TableHead>
                      <TableHead className="hidden sm:table-cell cursor-pointer select-none" onClick={() => handleSort('payment_method')}>
                        <span className="flex items-center">Método<SortIcon field="payment_method" sortField={sortField} sortDirection={sortDirection} /></span>
                      </TableHead>
                      <TableHead className="hidden md:table-cell">Fatura</TableHead>
                      <TableHead className="cursor-pointer select-none" onClick={() => handleSort('status')}>
                        <span className="flex items-center">Estado<SortIcon field="status" sortField={sortField} sortDirection={sortDirection} /></span>
                      </TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedPayments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="whitespace-nowrap">
                          {formatDate(payment.payment_date)}
                          {/* Stripe bills in advance, so a payment charged on e.g. 30 Jul
                              can cover the June→July cycle, not August — without this the
                              charge date alone reads as "wrong month" when filtering by
                              the period the subscription is actually for. */}
                          {billingPeriodLabel(payment.billing_period_start, payment.billing_period_end) && (
                            <div className="text-xs font-normal text-muted-foreground">
                              Cobre {billingPeriodLabel(payment.billing_period_start, payment.billing_period_end)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">#{payment.sale.code}</span>
                        </TableCell>
                        <TableCell className="max-w-[150px] truncate">
                          {payment.client_name || payment.lead_name || '-'}
                        </TableCell>
                        <TableCell className="text-right font-semibold whitespace-nowrap">
                          {formatCurrency(payment.amount)}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {payment.payment_method ? PAYMENT_METHOD_LABELS[payment.payment_method] : '-'}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {payment.invoice_reference || '-'}
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant={payment.status === 'paid' ? 'default' : 'secondary'}
                            className={payment.status === 'paid' ? 'bg-emerald-500' : 'bg-amber-500'}
                          >
                            {PAYMENT_RECORD_STATUS_LABELS[payment.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {payment.status === 'pending' && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5"
                                onClick={() => openConfirmDialog(payment)}
                              >
                                <CheckCircle className="h-4 w-4" />
                                <span className="hidden sm:inline">Marcar Pago</span>
                              </Button>
                            )}
                            {canEmitDocument(payment) && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5"
                                onClick={() => handleOpenDraft(payment)}
                                disabled={generateReceipt.isPending || issueInvoiceReceipt.isPending}
                              >
                                {getDocumentMode(payment) === "receipt" ? (
                                  <>
                                    <Receipt className="h-4 w-4" />
                                    <span className="hidden sm:inline">Emitir Recibo</span>
                                  </>
                                ) : (
                                  <>
                                    <FileText className="h-4 w-4" />
                                    <span className="hidden sm:inline">Emitir FR</span>
                                  </>
                                )}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Mark as Paid confirmation */}
      <Dialog open={!!confirmPayment} onOpenChange={(open) => !open && setConfirmPayment(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Marcar pagamento como pago?</DialogTitle>
            <DialogDescription>
              {confirmPayment && (
                <span className="flex flex-col gap-2 mt-2">
                  <span><strong>Cliente:</strong> {confirmPayment.client_name || confirmPayment.lead_name || '-'}</span>
                  <span><strong>Venda:</strong> #{confirmPayment.sale.code}</span>
                  <span><strong>Valor:</strong> {formatCurrency(confirmPayment.amount)}</span>
                  <span><strong>Data agendada:</strong> {formatDate(confirmPayment.payment_date)}</span>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {confirmPayment && !confirmPayment.payment_method && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Método de pagamento</label>
              <Select value={selectedMethod} onValueChange={(v) => setSelectedMethod(v as PaymentMethod)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar método..." />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map(method => (
                    <SelectItem key={method} value={method}>
                      {PAYMENT_METHOD_LABELS[method]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {confirmPayment?.payment_method && (
            <div className="text-sm">
              <strong>Método:</strong> {PAYMENT_METHOD_LABELS[confirmPayment.payment_method]}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmPayment(null)} disabled={updatePayment.isPending}>
              Cancelar
            </Button>
            <Button onClick={handleMarkAsPaid} disabled={updatePayment.isPending}>
              {updatePayment.isPending ? 'A atualizar...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invoice Draft Modal */}
      {draftPayment && (
        <InvoiceDraftModal
          open={!!draftPayment}
          onOpenChange={(open) => !open && setDraftPayment(null)}
          onConfirm={handleConfirmDraft}
          isLoading={generateReceipt.isPending || issueInvoiceReceipt.isPending}
          mode={draftMode}
          clientName={draftPayment.client_name || draftPayment.lead_name}
          clientNif={draftPayment.client_nif}
          amount={draftPayment.amount}
          paymentDate={draftPayment.payment_date}
          paymentMethod={draftPayment.payment_method}
          taxConfig={taxConfig}
          saleItems={draftSaleItems}
          saleTotal={draftPayment.sale.gross_value ?? draftPayment.sale.total_value}
        />
      )}

      <AddRevenueModal open={showRevenueModal} onOpenChange={setShowRevenueModal} />
    </>
  );
}

