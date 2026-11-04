import { useEffect, useMemo, useRef, useState } from "react";
import { endOfDay, format, parseISO, startOfDay } from "date-fns";
import type { DateRange } from "react-day-picker";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, FileDown, FileText, Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { CreditNoteInvoicePicker } from "@/components/finance/CreditNoteInvoicePicker";
import { SaleInvoicePicker } from "@/components/finance/SaleInvoicePicker";
import { InvoiceDetailsModal } from "@/components/sales/InvoiceDetailsModal";
import { isInvoiceXpressActive } from "@/components/sales/SaleFiscalInfo";
import { ExportMenu, type ExportKind } from "@/components/shared/ExportMenu";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useCreditNotes, useSyncCreditNotes } from "@/hooks/useCreditNotes";
import { useInvoices, useSyncInvoices } from "@/hooks/useInvoices";
import { useOrganization } from "@/hooks/useOrganization";
import { openPdfInNewTab } from "@/lib/download";
import { exportToCsv, exportToExcel } from "@/lib/export";
import { formatCurrency, formatDate } from "@/lib/format";
import { invoiceRelatedReferences } from "@/lib/invoice-display";
import { cn, matchesSearch } from "@/lib/utils";
import { tr, useLanguage } from "@/i18n";

type DocumentType = "invoice" | "invoice_receipt" | "receipt" | "credit_note";

interface UnifiedDocument {
  id: string;
  reference: string | null;
  document_type: string;
  date: string | null;
  created_at: string;
  client_name: string | null;
  status: string | null;
  total: number;
  sale_id: string | null;
  payment_id: string | null;
  pdf_path: string | null;
  invoicexpress_id: number | null;
  invoice_id: string | null;
  provider: string;
  related_doc_reference: string | null;
  email_status: string | null;
}

type SortField = "recent" | "reference" | "date" | "client_name" | "total";
type SortDirection = "asc" | "desc";
type TypeFilter = "all" | "invoice" | "invoice_receipt" | "receipt" | "credit_note";

const TYPE_FILTERS: readonly { key: TypeFilter; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "invoice", label: "Faturas" },
  { key: "invoice_receipt", label: "Faturas-recibo" },
  { key: "receipt", label: "Recibos" },
  { key: "credit_note", label: "Notas de crédito" },
];

const TYPE_PILLS: Record<string, string> = {
  invoice: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  invoice_receipt: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  simplified_invoice: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  receipt: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  credit_note: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

// The email of each document, as the fiscal worker and Brevo report it.
const EMAIL_STATES: Record<string, { label: string; tone: string }> = {
  pending: { label: "A enviar", tone: "text-amber-700 dark:text-amber-300" },
  processing: { label: "A enviar", tone: "text-amber-700 dark:text-amber-300" },
  retry: { label: "A tentar de novo", tone: "text-amber-700 dark:text-amber-300" },
  sent: { label: "Enviado", tone: "text-emerald-700 dark:text-emerald-300" },
  delivered: { label: "Entregue", tone: "text-emerald-700 dark:text-emerald-300" },
  bounced: { label: "Devolvido", tone: "text-destructive" },
  blocked: { label: "Bloqueado", tone: "text-destructive" },
  failed: { label: "Falhou", tone: "text-destructive" },
  suppressed: { label: "Não enviado", tone: "text-destructive" },
};

const docTypeLabel = (type: string, provider?: string) => {
  switch (type) {
    case "invoice": return tr("Fatura");
    case "invoice_receipt": return tr("Fatura-recibo");
    case "receipt": return provider === "vendus" ? tr("Recibo (RG)") : tr("Recibo");
    case "simplified_invoice": return tr("Fatura simplificada");
    case "credit_note": return tr("Nota de crédito");
    default: return type;
  }
};

const providerLabel = (provider: string) => (provider === "vendus" ? "Vendus" : provider === "keyinvoice" ? "KeyInvoice" : "InvoiceXpress");

const statusLabel = (status: string | null, provider?: string) => {
  if ((status === "canceled" || status === "cancelled") && provider === "keyinvoice") return tr("Com nota de crédito");
  if (status === "final" && provider === "keyinvoice") return tr("Emitida");
  const map: Record<string, string> = {
    settled: "Liquidada", final: "Finalizada", queued: "Em fila", draft: "Rascunho", canceled: "Anulada", cancelled: "Anulada", sent: "Enviada", second_copy: "Segunda via",
  };
  const label = map[status || ""];
  return label ? tr(label) : status || "—";
};

const statusTone = (status: string | null) =>
  status === "settled" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
    : status === "canceled" || status === "cancelled" ? "bg-destructive/10 text-destructive"
      : status === "draft" ? "bg-muted text-muted-foreground"
        : "bg-blue-500/10 text-blue-700 dark:text-blue-300";

const SortIcon = ({ field, sortField, sortDirection }: { field: SortField; sortField: SortField; sortDirection: SortDirection }) => {
  if (field !== sortField) return <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />;
  return sortDirection === "asc" ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />;
};

interface InvoicesContentProps {
  /** Inside the finance page: search and period come from its filter line. */
  readonly search?: string;
  readonly dateRange?: DateRange;
}

/** Every fiscal document of the organization: invoices, invoice-receipts, receipts and credit notes. */
export function InvoicesContent({ search: outerSearch, dateRange: outerRange }: InvoicesContentProps = {}) {
  const embedded = outerSearch !== undefined;
  const { t } = useLanguage();
  const { data: invoicesData, isLoading: loadingInvoices } = useInvoices();
  const { data: creditNotesData, isLoading: loadingCreditNotes } = useCreditNotes();
  const { organization } = useAuth();
  const { data: orgData } = useOrganization();
  const billingOrganization = organization ?? orgData;
  const isBillingEnabled = isInvoiceXpressActive(billingOrganization);
  const isInvoiceXpressProvider = billingOrganization?.billing_provider === "invoicexpress";
  const isVendusActive = organization?.billing_provider === "vendus"
    && (organization.integrations_enabled as Record<string, boolean> | null)?.vendus === true
    && organization.tem_vendus_api_key === true;
  const syncInvoices = useSyncInvoices();
  const syncCreditNotes = useSyncCreditNotes();
  const hasSynced = useRef(false);
  const [ownSearch, setOwnSearch] = useState("");
  const [ownRange, setOwnRange] = useState<DateRange | undefined>(undefined);
  const search = embedded ? outerSearch : ownSearch;
  const dateRange = embedded ? outerRange : ownRange;
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [pickerMode, setPickerMode] = useState<"invoice" | "credit-note" | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("recent");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selected, setSelected] = useState<UnifiedDocument | null>(null);

  const isLoading = loadingInvoices || loadingCreditNotes;

  // These sync functions import InvoiceXpress documents only. KeyInvoice
  // documents are already persisted when issued and loaded by useInvoices.
  useEffect(() => {
    if (!hasSynced.current && isInvoiceXpressProvider && !syncInvoices.isPending && !syncCreditNotes.isPending) {
      hasSynced.current = true;
      syncInvoices.mutate(undefined, { onError: () => {} });
      syncCreditNotes.mutate(undefined, { onError: () => {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInvoiceXpressProvider]);

  const allDocuments = useMemo((): UnifiedDocument[] => {
    const relatedReferences = invoiceRelatedReferences(invoicesData || []);
    const invoices: UnifiedDocument[] = (invoicesData || []).map((inv) => ({
      id: inv.id,
      reference: inv.reference,
      document_type: inv.document_type || "invoice",
      date: inv.date,
      created_at: inv.created_at,
      client_name: inv.client_name,
      status: inv.status,
      total: inv.total,
      sale_id: inv.sale_id,
      payment_id: inv.payment_id,
      pdf_path: inv.pdf_path,
      invoicexpress_id: inv.invoicexpress_id,
      invoice_id: inv.id,
      provider: inv.provider,
      related_doc_reference: relatedReferences.get(inv.id) || null,
      email_status: inv.email_status,
    }));
    const creditNotes: UnifiedDocument[] = (creditNotesData || []).map((cn) => ({
      id: cn.id,
      reference: cn.reference,
      document_type: "credit_note",
      date: cn.date,
      created_at: cn.created_at,
      client_name: cn.client_name,
      status: cn.status,
      total: cn.total,
      sale_id: cn.sale_id,
      payment_id: cn.payment_id,
      pdf_path: cn.pdf_path,
      invoicexpress_id: cn.invoicexpress_id,
      invoice_id: null,
      provider: "invoicexpress",
      related_doc_reference: cn.related_invoice_reference || null,
      email_status: null,
    }));
    return [...invoices, ...creditNotes];
  }, [invoicesData, creditNotesData]);

  const inRangeAndSearch = useMemo(() => allDocuments.filter((doc) => {
    if (dateRange?.from) {
      if (!doc.date) return false;
      const day = parseISO(doc.date);
      if (day < startOfDay(dateRange.from)) return false;
      if (dateRange.to && day > endOfDay(dateRange.to)) return false;
    }
    return !search.trim() || matchesSearch(search, doc.reference, doc.client_name);
  }), [allDocuments, search, dateRange]);

  const typeOf = (doc: UnifiedDocument): TypeFilter =>
    doc.document_type === "simplified_invoice" ? "invoice_receipt" : (doc.document_type as TypeFilter);
  const counts = useMemo(() => {
    const result: Record<TypeFilter, number> = { all: inRangeAndSearch.length, invoice: 0, invoice_receipt: 0, receipt: 0, credit_note: 0 };
    for (const doc of inRangeAndSearch) if (typeOf(doc) in result) result[typeOf(doc)] += 1;
    return result;
  }, [inRangeAndSearch]);

  const rows = useMemo(() => {
    const shown = typeFilter === "all" ? inRangeAndSearch : inRangeAndSearch.filter((doc) => typeOf(doc) === typeFilter);
    const dir = sortDirection === "asc" ? 1 : -1;
    return [...shown].sort((a, b) => {
      switch (sortField) {
        case "reference": return dir * (a.reference || "").localeCompare(b.reference || "");
        case "date":
          if (!a.date || !b.date) return a.date ? -1 : b.date ? 1 : 0;
          return dir * a.date.localeCompare(b.date);
        case "client_name": return dir * (a.client_name || "").localeCompare(b.client_name || "");
        case "total": return dir * (a.total - b.total);
        default: return dir * a.created_at.localeCompare(b.created_at);
      }
    });
  }, [inRangeAndSearch, typeFilter, sortField, sortDirection]);

  const total = rows.reduce((sum, doc) => sum + (doc.document_type === "credit_note" ? -1 : 1) * Number(doc.total || 0), 0);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDirection(field === "date" ? "desc" : "asc"); }
  };

  const handleExport = (kind: ExportKind) => {
    const data = rows.map((doc) => ({
      Referência: doc.reference || "",
      Tipo: docTypeLabel(doc.document_type, doc.provider),
      Origem: providerLabel(doc.provider),
      Data: doc.date ? formatDate(doc.date) : "",
      Cliente: doc.client_name || "",
      Estado: statusLabel(doc.status, doc.provider),
      Email: doc.email_status ? EMAIL_STATES[doc.email_status]?.label ?? "" : "",
      Valor: Number(doc.total),
    }));
    const name = `documentos-fiscais_${format(new Date(), "yyyy-MM-dd")}`;
    if (kind === "excel") exportToExcel(data, name); else exportToCsv(data, name);
  };

  const handleViewPdf = async (id: string, pdfPath: string | null) => {
    if (!pdfPath) return;
    setViewingId(id);
    try { await openPdfInNewTab(pdfPath); } catch { toast.error(t("Erro ao abrir o PDF")); } finally { setViewingId(null); }
  };

  const sortableHead = (field: SortField, label: string, className?: string) => (
    <TableHead className={cn("cursor-pointer select-none", className)} onClick={() => handleSort(field)}>
      <span className={cn("flex items-center", className?.includes("text-right") && "justify-end")}>{label}<SortIcon field={field} sortField={sortField} sortDirection={sortDirection} /></span>
    </TableHead>
  );

  return (
    <div className="space-y-3">
      {!embedded && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
            <Input type="search" placeholder={t("Pesquisar por referência ou cliente")} value={ownSearch} onChange={(event) => setOwnSearch(event.target.value)}
              className="h-9 rounded-full pl-10 text-[13px]" />
          </div>
          <DateRangePicker value={ownRange} onChange={setOwnRange} placeholder={t("Todo o histórico")} className="h-9 w-auto rounded-full" />
        </div>
      )}

      {/* Which documents, how much they add up to, and what can be done here. */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t("Tipo de documento")} className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-border bg-card p-1 shadow-sm">
          {TYPE_FILTERS.map(({ key, label }) => (
            <button key={key} type="button" aria-pressed={typeFilter === key} onClick={() => setTypeFilter(key)}
              className={cn("flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                typeFilter === key ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/30" : "text-foreground/75 hover:bg-muted")}>
              {t(label)}<span className="rounded-full bg-muted px-1.5 text-[10px] leading-4 tabular-nums text-muted-foreground">{counts[key]}</span>
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {t(rows.length === 1 ? "{{n}} documento" : "{{n}} documentos", { n: rows.length })} · <strong className="tabular-nums text-foreground">{formatCurrency(total)}</strong>
        </p>
        <div className="ml-auto flex items-center gap-2">
          {isVendusActive && (
            <Button variant="outline" className="h-9 rounded-full px-3" disabled={syncInvoices.isPending}
              onClick={() => syncInvoices.mutate(undefined, {
                onSuccess: (result) => toast.success(result.failed
                  ? t("{{total}} documento(s) sincronizado(s); {{failed}} requer(em) revisão", { total: result.total, failed: result.failed })
                  : t("{{total}} documento(s) Vendus sincronizado(s)", { total: result.total })),
              })}>
              <RefreshCw className={cn("h-4 w-4", syncInvoices.isPending && "animate-spin")} /><span className="hidden sm:inline">{t("Sincronizar Vendus")}</span>
            </Button>
          )}
          <ExportMenu count={rows.length} noun={t("documentos")} onExport={handleExport} />
          {(isBillingEnabled || isVendusActive) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="h-9 rounded-full px-3"><Plus className="h-4 w-4" />{t("Emitir")}<ChevronDown className="h-3.5 w-3.5 opacity-70" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => setPickerMode("invoice")}><FileText className="mr-2 h-4 w-4" />{t("Fatura de uma venda")}</DropdownMenuItem>
                {!isVendusActive && <DropdownMenuItem onSelect={() => setPickerMode("credit-note")}><FileText className="mr-2 h-4 w-4" />{t("Nota de crédito")}</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {isLoading ? (
          <div className="space-y-3 p-4">{[0, 1, 2].map((key) => <Skeleton key={key} className="h-10 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
            <FileText className="h-10 w-10 text-muted-foreground/40" />{t("Nenhum documento encontrado.")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {sortableHead("reference", t("Documento"))}
                  {sortableHead("date", t("Data"))}
                  {sortableHead("client_name", t("Cliente"))}
                  <TableHead>{t("Estado")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t("Email")}</TableHead>
                  {sortableHead("total", t("Valor"), "text-right")}
                  <TableHead className="w-12"><span className="sr-only">PDF</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((doc) => {
                  const email = doc.email_status ? EMAIL_STATES[doc.email_status] : undefined;
                  return (
                    <TableRow key={doc.id} className="cursor-pointer" onClick={() => setSelected(doc)}>
                      <TableCell>
                        <p className="font-medium">{doc.reference || "—"}</p>
                        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className={cn("rounded-full px-1.5 py-px font-medium", TYPE_PILLS[doc.document_type] ?? "bg-muted")}>{docTypeLabel(doc.document_type, doc.provider)}</span>
                          {providerLabel(doc.provider)}
                          {doc.related_doc_reference && <span>· {t("liga a {{ref}}", { ref: doc.related_doc_reference })}</span>}
                        </p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{doc.date ? formatDate(doc.date) : "—"}</TableCell>
                      <TableCell className="max-w-[14rem] truncate">{doc.client_name || "—"}</TableCell>
                      <TableCell>
                        <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", statusTone(doc.status))}>{statusLabel(doc.status, doc.provider)}</span>
                      </TableCell>
                      <TableCell className={cn("hidden whitespace-nowrap text-xs lg:table-cell", email?.tone ?? "text-muted-foreground")}>{email?.label ? t(email.label) : "—"}</TableCell>
                      <TableCell className={cn("whitespace-nowrap text-right font-semibold tabular-nums", doc.document_type === "credit_note" && "text-rose-600 dark:text-rose-400")}>
                        {doc.document_type === "credit_note" ? "−" : ""}{formatCurrency(doc.total)}
                      </TableCell>
                      <TableCell>
                        {doc.pdf_path && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" title={t("Ver PDF")} aria-label={t("Ver PDF de {{ref}}", { ref: doc.reference ?? t("documento") })}
                            onClick={(event) => { event.stopPropagation(); void handleViewPdf(doc.id, doc.pdf_path); }} disabled={viewingId === doc.id}>
                            {viewingId === doc.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {selected && organization && (
        <InvoiceDetailsModal
          open={!!selected}
          onOpenChange={(open) => !open && setSelected(null)}
          documentId={selected.invoicexpress_id}
          invoiceId={selected.invoice_id}
          provider={selected.provider}
          documentType={(selected.document_type === "simplified_invoice" ? "invoice_receipt" : selected.document_type) as DocumentType}
          organizationId={organization.id}
          saleId={selected.sale_id || undefined}
          paymentId={selected.payment_id || undefined}
          initialDetails={{
            sequence_number: selected.reference || "",
            status: selected.status || "final",
            date: selected.date || "",
            sum: Number(selected.total || 0),
            before_taxes: Number(selected.total || 0),
            total: Number(selected.total || 0),
            client: selected.client_name ? {
              id: 0, name: selected.client_name, fiscal_id: "", country: "PT", address: null, postal_code: null, city: null, email: null, phone: null,
            } : null,
          }}
        />
      )}

      <SaleInvoicePicker open={pickerMode === "invoice"} onOpenChange={(open) => !open && setPickerMode(null)} />
      <CreditNoteInvoicePicker open={pickerMode === "credit-note"} onOpenChange={(open) => !open && setPickerMode(null)} />
    </div>
  );
}
