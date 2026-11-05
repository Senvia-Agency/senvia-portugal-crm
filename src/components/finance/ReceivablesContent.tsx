import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { differenceInCalendarDays, endOfDay, format, parseISO, startOfDay } from "date-fns";
import type { DateRange } from "react-day-picker";
import { CheckCircle, CreditCard, Download, FileText, Plus, Receipt } from "lucide-react";
import { toast } from "sonner";

import { AddRevenueModal } from "@/components/finance/AddRevenueModal";
import { AutomaticReceiptBadge } from "@/components/finance/AutomaticReceiptBadge";
import { InvoiceDraftModal, type DraftSaleItem } from "@/components/sales/InvoiceDraftModal";
import { isBillingActive } from "@/components/sales/SaleFiscalInfo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useAllPayments } from "@/hooks/useAllPayments";
import { useAutomaticReceipts } from "@/hooks/useAutomaticReceipts";
import { useGenerateReceipt } from "@/hooks/useGenerateReceipt";
import { useIssueInvoiceReceipt } from "@/hooks/useIssueInvoiceReceipt";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useUpdateSalePayment } from "@/hooks/useSalePayments";
import { useSaleItems } from "@/hooks/useSaleItems";
import { exportToCsv, exportToExcel } from "@/lib/export";
import { automaticReceiptState } from "@/lib/fiscal-automation";
import { isSalePaidInFull } from "@/lib/fiscal-eligibility";
import { billingPeriodLabel, formatCurrency, formatDate } from "@/lib/format";
import { cn, matchesSearch } from "@/lib/utils";
import { ExportMenu, type ExportKind } from "@/components/shared/ExportMenu";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PaymentMethod } from "@/types/sales";
import type { PaymentWithSale } from "@/types/finance";
import { useLanguage } from "@/i18n";

/** Which payments the list shows. "open" = everything still to receive, late or not. */
export type ReceivableView = "open" | "overdue" | "paid" | "all";

const VIEWS: readonly { key: ReceivableView; label: string }[] = [
  { key: "open", label: "Por receber" },
  { key: "overdue", label: "Em atraso" },
  { key: "paid", label: "Recebidos" },
  { key: "all", label: "Todos" },
];

interface ReceivablesContentProps {
  /** Typed in the page's filter line. */
  readonly search: string;
  readonly dateRange?: DateRange;
  /** Opens on this view (from ?status= or a summary figure). */
  readonly initialView?: ReceivableView;
}

const isLate = (payment: PaymentWithSale, today: Date) =>
  payment.status === "pending" && parseISO(payment.payment_date) < today;

/**
 * Every payment of every sale: what is still to receive (late first), what came in,
 * and the two things done with them — confirm it was paid, issue its receipt.
 */
export function ReceivablesContent({ search, dateRange, initialView }: ReceivablesContentProps) {
  const { data: payments, isLoading } = useAllPayments();
  const { t } = useLanguage();
  const { organization } = useAuth();
  const updatePayment = useUpdateSalePayment();
  const generateReceipt = useGenerateReceipt();
  const issueInvoiceReceipt = useIssueInvoiceReceipt();
  const queryClient = useQueryClient();
  const { data: automaticReceipts } = useAutomaticReceipts(
    (payments ?? []).filter((payment) => payment.status === "paid").map((payment) => payment.id),
  );
  const [storedView, setView] = usePersistedState<ReceivableView>("receivables-view-v1", "open");
  const [viewTouched, setViewTouched] = useState(false);
  const view = !viewTouched && initialView ? initialView : storedView;
  const [methodFilter, setMethodFilter] = usePersistedState<string>("receivables-method-v1", "all");
  const [confirmPayment, setConfirmPayment] = useState<PaymentWithSale | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | "">("");
  // When the money actually came in: today by default, any past day if it is recorded late.
  const [receivedDate, setReceivedDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [draftPayment, setDraftPayment] = useState<PaymentWithSale | null>(null);
  const [draftMode, setDraftMode] = useState<"receipt" | "invoice_receipt">("receipt");
  const [revenueOpen, setRevenueOpen] = useState(false);
  const { data: saleItems } = useSaleItems(draftPayment?.sale_id);

  const hasFiscalIntegration = isBillingActive(organization);
  const taxConfig = organization?.tax_config as { tax_value?: number; tax_exemption_reason?: string } | null;
  const today = startOfDay(new Date());

  const inRangeAndSearch = useMemo(() => (payments ?? []).filter((payment) => {
    // Same rule as the summary figures: a cancelled sale has nothing to receive, and
    // Stripe collects plan payments by itself, so only their confirmed ones show.
    if (payment.sale.status === "cancelled") return false;
    if (payment.sale.client_org_id && payment.status !== "paid") return false;
    if (dateRange?.from) {
      const day = parseISO(payment.payment_date);
      if (day < startOfDay(dateRange.from)) return false;
      if (dateRange.to && day > endOfDay(dateRange.to)) return false;
    }
    if (methodFilter !== "all" && payment.payment_method !== methodFilter) return false;
    return !search.trim() || matchesSearch(search, payment.client_name, payment.lead_name, payment.sale.code, payment.invoice_reference);
  }), [payments, dateRange, methodFilter, search]);

  const counts = useMemo(() => ({
    open: inRangeAndSearch.filter((payment) => payment.status === "pending").length,
    overdue: inRangeAndSearch.filter((payment) => isLate(payment, today)).length,
    paid: inRangeAndSearch.filter((payment) => payment.status === "paid").length,
    all: inRangeAndSearch.length,
  }), [inRangeAndSearch, today]);

  const rows = useMemo(() => {
    const shown = inRangeAndSearch.filter((payment) =>
      view === "open" ? payment.status === "pending"
        : view === "overdue" ? isLate(payment, today)
          : view === "paid" ? payment.status === "paid"
            : true);
    // Still to receive: the oldest due first. Received or everything: the newest first.
    return shown.sort((a, b) => (view === "open" || view === "overdue")
      ? a.payment_date.localeCompare(b.payment_date)
      : b.payment_date.localeCompare(a.payment_date));
  }, [inRangeAndSearch, view, today]);

  const total = rows.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const methods = useMemo(() => Array.from(new Set((payments ?? []).map((p) => p.payment_method).filter(Boolean))) as PaymentMethod[], [payments]);

  const getDocumentMode = (payment: PaymentWithSale): "receipt" | "invoice_receipt" | null => {
    // A receipt only settles an existing FT; an existing FR is already both.
    if (payment.sale.invoicexpress_id) return payment.sale.invoicexpress_type === "FT" ? "receipt" : null;
    // An FR covers the whole sale: only once every confirmed payment adds up to it.
    const forSale = (payments ?? []).filter((candidate) => candidate.sale_id === payment.sale_id);
    return isSalePaidInFull(payment.sale.gross_value ?? payment.sale.total_value, forSale) ? "invoice_receipt" : null;
  };

  const canEmitDocument = (payment: PaymentWithSale) => {
    if (!hasFiscalIntegration || payment.status !== "paid" || payment.invoice_reference) return false;
    if ((payment.reversal_status ?? "none") !== "none" || Number(payment.reversed_amount ?? 0) > 0) return false;
    // An automatic receipt on its way (or waiting for review) owns this payment.
    const automatic = automaticReceipts?.get(payment.id);
    if (automatic && automaticReceiptState(automatic.processing_status) !== "cancelled") return false;
    const mode = getDocumentMode(payment);
    if (mode === "invoice_receipt") {
      // One FR per sale: offered on its newest confirmed payment only.
      const representative = (payments ?? []).find((candidate) => candidate.sale_id === payment.sale_id
        && candidate.status === "paid" && (candidate.reversal_status ?? "none") === "none" && Number(candidate.reversed_amount ?? 0) === 0);
      return representative?.id === payment.id;
    }
    return mode === "receipt";
  };

  const handleMarkAsPaid = () => {
    if (!confirmPayment) return;
    const updates: Record<string, unknown> = { status: "paid", payment_date: receivedDate || format(new Date(), "yyyy-MM-dd") };
    if (selectedMethod) updates.payment_method = selectedMethod;
    updatePayment.mutate({ paymentId: confirmPayment.id, saleId: confirmPayment.sale_id, updates }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["all-payments"] }); setConfirmPayment(null); },
      onError: () => setConfirmPayment(null),
    });
  };

  const handleConfirmDraft = (observations?: string) => {
    if (!draftPayment || !organization) return;
    if (draftPayment.status !== "paid" || (draftPayment.reversal_status ?? "none") !== "none"
      || Number(draftPayment.reversed_amount ?? 0) > 0 || getDocumentMode(draftPayment) !== draftMode) {
      toast.error(t("O estado do pagamento já não permite emitir este documento. Atualiza a página e tenta novamente."));
      return;
    }
    const done = { onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["all-payments"] }); setDraftPayment(null); } };
    if (draftMode === "receipt") {
      generateReceipt.mutate({ saleId: draftPayment.sale_id, paymentId: draftPayment.id, organizationId: organization.id }, done);
    } else {
      issueInvoiceReceipt.mutate({ saleId: draftPayment.sale_id, organizationId: organization.id, observations }, done);
    }
  };

  const handleExport = (kind: ExportKind) => {
    const data = rows.map((payment) => ({
      Data: formatDate(payment.payment_date),
      Venda: `#${payment.sale.code}`,
      Cliente: payment.client_name || payment.lead_name || "",
      Valor: Number(payment.amount),
      Método: payment.payment_method ? t(PAYMENT_METHOD_LABELS[payment.payment_method]) : "",
      Documento: payment.invoice_reference || "",
      Estado: payment.status === "paid" ? t("Recebido") : isLate(payment, today) ? t("Em atraso") : t("Por receber"),
    }));
    const name = `pagamentos_${format(new Date(), "yyyy-MM-dd")}`;
    if (kind === "excel") exportToExcel(data, name); else exportToCsv(data, name);
  };

  const draftSaleItems: DraftSaleItem[] = (saleItems || []).map((item) => ({
    name: item.name,
    quantity: item.quantity,
    unit_price: Number(item.unit_price),
    tax_value: (item.product as { tax_value?: number | null } | null)?.tax_value ?? null,
  }));

  return (
    <div className="space-y-3">
      {/* What to look at, how much it adds up to, and the two page actions. */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t("Pagamentos a mostrar")} className="flex items-center gap-0.5 overflow-x-auto rounded-full border border-border bg-card p-1 shadow-sm">
          {VIEWS.map(({ key, label }) => (
            <button key={key} type="button" aria-pressed={view === key}
              onClick={() => { setViewTouched(true); setView(key); }}
              className={cn("flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                view === key ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/30" : "text-foreground/75 hover:bg-muted")}>
              {t(label)}
              <span className={cn("rounded-full px-1.5 tabular-nums text-[10px] leading-4",
                key === "overdue" && counts.overdue > 0 ? "bg-destructive text-destructive-foreground" : "bg-muted text-muted-foreground")}>
                {counts[key]}
              </span>
            </button>
          ))}
        </div>
        {methods.length > 1 && (
          <Select value={methodFilter} onValueChange={setMethodFilter}>
            <SelectTrigger className={cn("h-9 w-auto gap-1.5 rounded-full px-3 text-[13px]", methodFilter !== "all" && "border-primary/40 bg-primary/5 text-primary")}>
              <CreditCard className="h-3.5 w-3.5" /><SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Todos os métodos")}</SelectItem>
              {methods.map((method) => <SelectItem key={method} value={method}>{t(PAYMENT_METHOD_LABELS[method])}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <p className="text-sm text-muted-foreground">
          {t(rows.length === 1 ? "{{n}} pagamento" : "{{n}} pagamentos", { n: rows.length })} · <strong className="tabular-nums text-foreground">{formatCurrency(total)}</strong>
        </p>
        <div className="ml-auto flex items-center gap-2">
          <ExportMenu count={rows.length} noun={t("pagamentos")} onExport={handleExport} />
          <Button variant="outline" className="h-9 rounded-full px-3" onClick={() => setRevenueOpen(true)}>
            <Plus className="h-4 w-4" /><span className="hidden sm:inline">{t("Adicionar receita")}</span>
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {isLoading ? (
          <div className="space-y-3 p-4">{[0, 1, 2].map((key) => <Skeleton key={key} className="h-10 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
            <CreditCard className="h-10 w-10 text-muted-foreground/40" />
            {view === "overdue" ? t("Nenhum pagamento em atraso.") : view === "open" ? t("Nada por receber.") : t("Nenhum pagamento encontrado.")}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-32">{t("Data")}</TableHead>
                <TableHead>{t("Cliente")}</TableHead>
                <TableHead className="text-right">{t("Valor")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("Método")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("Documento")}</TableHead>
                <TableHead>{t("Estado")}</TableHead>
                <TableHead className="text-right"><span className="sr-only">{t("Ações")}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((payment) => {
                const late = isLate(payment, today);
                const daysLate = late ? differenceInCalendarDays(today, parseISO(payment.payment_date)) : 0;
                const period = billingPeriodLabel(payment.billing_period_start, payment.billing_period_end);
                const automatic = automaticReceipts?.get(payment.id);
                const mode = canEmitDocument(payment) ? getDocumentMode(payment) : null;
                return (
                  <TableRow key={payment.id} className={cn(late && "bg-destructive/[0.03]")}>
                    <TableCell className="whitespace-nowrap">
                      <span className={cn("tabular-nums", late && "font-medium text-destructive")}>{formatDate(payment.payment_date)}</span>
                      {late && <span className="block text-[11px] text-destructive">{t(daysLate === 1 ? "há {{n}} dia" : "há {{n}} dias", { n: daysLate })}</span>}
                      {/* Stripe bills in advance: the cycle a charge covers is not its date's month. */}
                      {period && <span className="block text-[11px] text-muted-foreground">{t("Cobre {{period}}", { period })}</span>}
                    </TableCell>
                    <TableCell>
                      <p className="max-w-[16rem] truncate font-medium">{payment.client_name || payment.lead_name || "—"}</p>
                      <p className="text-xs text-muted-foreground">{t("Venda #{{code}}", { code: payment.sale.code })}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatCurrency(payment.amount)}</TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{payment.payment_method ? t(PAYMENT_METHOD_LABELS[payment.payment_method]) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">
                      {payment.invoice_reference || (automatic ? null : <span className="text-muted-foreground">—</span>)}
                      <AutomaticReceiptBadge job={automatic} className={payment.invoice_reference ? "mt-1 flex w-fit" : undefined} />
                    </TableCell>
                    <TableCell>
                      <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
                        payment.status === "paid" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : late ? "bg-destructive/10 text-destructive" : "bg-amber-500/15 text-amber-700 dark:text-amber-300")}>
                        {payment.status === "paid" ? t("Recebido") : late ? t("Em atraso") : t("Por receber")}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {payment.status === "pending" && (
                          <Button size="sm" variant="outline" className="h-8 rounded-full"
                            onClick={() => { setSelectedMethod(payment.payment_method || ""); setReceivedDate(format(new Date(), "yyyy-MM-dd")); setConfirmPayment(payment); }}>
                            <CheckCircle className="h-4 w-4" /><span className="hidden sm:inline">{t("Marcar pago")}</span>
                          </Button>
                        )}
                        {mode && (
                          <Button size="sm" variant="outline" className="h-8 rounded-full" disabled={generateReceipt.isPending || issueInvoiceReceipt.isPending}
                            onClick={() => { setDraftMode(mode); setDraftPayment(payment); }}>
                            {mode === "receipt" ? <Receipt className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                            <span className="hidden sm:inline">{mode === "receipt" ? t("Emitir recibo") : t("Emitir fatura-recibo")}</span>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={!!confirmPayment} onOpenChange={(open) => !open && setConfirmPayment(null)}>
        <DialogContent variant="fullScreen" className="flex flex-col gap-0 p-0">
          <DialogHeader className="border-b px-4 py-4 md:px-6">
            <DialogTitle>{t("Marcar como pago")}</DialogTitle>
            <DialogDescription>{t("Indique quando recebeu o pagamento e como.")}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6">
            {confirmPayment && (
              <div className="mx-auto max-w-xl space-y-5">
                <div className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-4 text-sm shadow-sm">
                  <div><p className="text-xs text-muted-foreground">{t("Cliente")}</p><p className="font-medium">{confirmPayment.client_name || confirmPayment.lead_name || "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">{t("Venda")}</p><p className="font-medium">#{confirmPayment.sale.code}</p></div>
                  <div><p className="text-xs text-muted-foreground">{t("Valor")}</p><p className="text-lg font-semibold tabular-nums">{formatCurrency(confirmPayment.amount)}</p></div>
                  <div><p className="text-xs text-muted-foreground">{t("Previsto para")}</p><p className="font-medium">{formatDate(confirmPayment.payment_date)}</p></div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="receivable-date">{t("Data de recebimento")}</label>
                  <Input id="receivable-date" type="date" value={receivedDate} max={format(new Date(), "yyyy-MM-dd")}
                    onChange={(event) => setReceivedDate(event.target.value)} className="h-10 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="receivable-method">{t("Método de pagamento")}</label>
                  <Select value={selectedMethod} onValueChange={(value) => setSelectedMethod(value as PaymentMethod)}>
                    <SelectTrigger id="receivable-method"><SelectValue placeholder={t("Selecionar método…")} /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((method) => <SelectItem key={method} value={method}>{t(PAYMENT_METHOD_LABELS[method])}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="border-t px-4 py-4 md:px-6">
            <Button variant="outline" onClick={() => setConfirmPayment(null)} disabled={updatePayment.isPending}>{t("Cancelar")}</Button>
            <Button onClick={handleMarkAsPaid} disabled={updatePayment.isPending}>
              <CheckCircle className="h-4 w-4" />{updatePayment.isPending ? t("A atualizar…") : t("Confirmar recebimento")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <AddRevenueModal open={revenueOpen} onOpenChange={setRevenueOpen} />
    </div>
  );
}
