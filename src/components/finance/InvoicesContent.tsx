import { matchesSearch } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Search, FileText, X, Loader2, ArrowUpDown, ArrowUp, ArrowDown, FileDown, Plus, RefreshCw } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SaleInvoicePicker } from "@/components/finance/SaleInvoicePicker";
import { CreditNoteInvoicePicker } from "@/components/finance/CreditNoteInvoicePicker";
import { isInvoiceXpressActive } from "@/components/sales/SaleFiscalInfo";
import { useInvoices, useSyncInvoices } from "@/hooks/useInvoices";
import { useCreditNotes, useSyncCreditNotes } from "@/hooks/useCreditNotes";
import { formatCurrency, formatDate } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useMemo, useEffect, useRef } from "react";
import { usePersistedState } from "@/hooks/usePersistedState";
import { exportToExcel } from "@/lib/export";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import { startOfDay, endOfDay, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { openPdfInNewTab } from "@/lib/download";
import { InvoiceDetailsModal } from "@/components/sales/InvoiceDetailsModal";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";

interface UnifiedDocument {
  id: string;
  reference: string | null;
  document_type: string;
  date: string | null;
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
}

type SortField = 'reference' | 'document_type' | 'date' | 'client_name' | 'status' | 'total';
type SortDirection = 'asc' | 'desc';

const SortIcon = ({ field, sortField, sortDirection }: { field: SortField; sortField: SortField; sortDirection: SortDirection }) => {
  if (field !== sortField) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
  return sortDirection === 'asc'
    ? <ArrowUp className="h-3 w-3 ml-1" />
    : <ArrowDown className="h-3 w-3 ml-1" />;
};

export function InvoicesContent() {
  const { data: invoicesData, isLoading: loadingInvoices } = useInvoices();
  const { data: creditNotesData, isLoading: loadingCreditNotes } = useCreditNotes();
  const { organization } = useAuth();
  const { data: orgData } = useOrganization();
  // Invoicing is active for both InvoiceXpress and KeyInvoice orgs (the old
  // check only looked at the invoicexpress flag, which is false for KeyInvoice).
  const isInvoicexpressEnabled = isInvoiceXpressActive(organization ?? orgData);
  const isVendusActive = organization?.billing_provider === 'vendus'
    && (organization.integrations_enabled as Record<string, boolean> | null)?.vendus === true
    && organization.tem_vendus_api_key === true;
  const syncInvoices = useSyncInvoices();
  const syncCreditNotes = useSyncCreditNotes();
  const hasSynced = useRef(false);
  const [searchTerm, setSearchTerm] = usePersistedState("invoices-search-v1", "");
  const [dateRange, setDateRange] = usePersistedState<DateRange | undefined>("invoices-daterange-v1", undefined);
  const [pickerMode, setPickerMode] = useState<'invoice' | 'credit-note' | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const SORT_KEY = 'finance-invoices-sort-v1';
  const VALID_FIELDS: SortField[] = ['reference', 'document_type', 'date', 'client_name', 'status', 'total'];

  const [sortField, setSortField] = useState<SortField>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SORT_KEY) || '{}');
      if (VALID_FIELDS.includes(saved.field)) return saved.field;
    } catch {}
    return 'date';
  });
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SORT_KEY) || '{}');
      if (saved.direction === 'asc' || saved.direction === 'desc') return saved.direction;
    } catch {}
    return 'desc';
  });
  const [selectedInvoice, setSelectedInvoice] = useState<{
    invoicexpress_id: number | null;
    invoice_id: string | null;
    provider: string;
    document_type: "invoice" | "invoice_receipt" | "receipt" | "credit_note";
    sale_id?: string;
    payment_id?: string;
  } | null>(null);

  useEffect(() => {
    try { localStorage.setItem(SORT_KEY, JSON.stringify({ field: sortField, direction: sortDirection })); } catch {}
  }, [sortField, sortDirection]);

  const isLoading = loadingInvoices || loadingCreditNotes;

  // Auto-sync both on mount (only if InvoiceXpress is enabled)
  useEffect(() => {
    if (!hasSynced.current && isInvoicexpressEnabled && !isVendusActive && !syncInvoices.isPending && !syncCreditNotes.isPending) {
      hasSynced.current = true;
      syncInvoices.mutate(undefined, { onError: () => {} });
      syncCreditNotes.mutate(undefined, { onError: () => {} });
    }
  }, [isInvoicexpressEnabled, isVendusActive]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection(field === 'date' ? 'desc' : 'asc');
    }
  };

  // Combine invoices + credit notes into unified list
  const allDocuments = useMemo((): UnifiedDocument[] => {
    const invoices: UnifiedDocument[] = (invoicesData || []).map(inv => ({
      id: inv.id,
      reference: inv.reference,
      document_type: inv.document_type || 'invoice',
      date: inv.date,
      client_name: inv.client_name,
      status: inv.status,
      total: inv.total,
      sale_id: inv.sale_id,
      payment_id: inv.payment_id,
      pdf_path: inv.pdf_path,
      invoicexpress_id: inv.invoicexpress_id,
      invoice_id: inv.id,
      provider: inv.provider,
      related_doc_reference: inv.credit_note_reference || null,
    }));

    const creditNotes: UnifiedDocument[] = (creditNotesData || []).map(cn => ({
      id: cn.id,
      reference: cn.reference,
      document_type: 'credit_note',
      date: cn.date,
      client_name: cn.client_name,
      status: cn.status,
      total: cn.total,
      sale_id: cn.sale_id,
      payment_id: cn.payment_id,
      pdf_path: cn.pdf_path,
      invoicexpress_id: cn.invoicexpress_id,
      invoice_id: null,
      provider: 'invoicexpress',
      related_doc_reference: cn.related_invoice_reference || null,
    }));

    return [...invoices, ...creditNotes];
  }, [invoicesData, creditNotesData]);

  const filteredDocuments = useMemo(() => {
    return allDocuments.filter(doc => {
      if (dateRange?.from) {
        if (!doc.date) return false;
        const docDate = parseISO(doc.date);
        if (docDate < startOfDay(dateRange.from)) return false;
        if (dateRange.to && docDate > endOfDay(dateRange.to)) return false;
      }
      if (searchTerm) {
        return matchesSearch(searchTerm, doc.reference, doc.client_name);
      }
      return true;
    });
  }, [allDocuments, searchTerm, dateRange]);

  const sortedDocuments = useMemo(() => {
    return [...filteredDocuments].sort((a, b) => {
      const dir = sortDirection === 'asc' ? 1 : -1;
      switch (sortField) {
        case 'reference':
          return dir * (a.reference || '').localeCompare(b.reference || '');
        case 'document_type':
          return dir * (a.document_type || '').localeCompare(b.document_type || '');
        case 'date':
          if (!a.date && !b.date) return 0;
          if (!a.date) return 1;
          if (!b.date) return -1;
          return dir * a.date.localeCompare(b.date);
        case 'client_name':
          return dir * (a.client_name || '').localeCompare(b.client_name || '');
        case 'status':
          return dir * (a.status || '').localeCompare(b.status || '');
        case 'total':
          return dir * (a.total - b.total);
        default:
          return 0;
      }
    });
  }, [filteredDocuments, sortField, sortDirection]);

  const hasActiveFilters = searchTerm || dateRange?.from;

  const clearFilters = () => {
    setSearchTerm("");
    setDateRange(undefined);
  };

  const getDocTypeLabel = (type: string, provider?: string) => {
    switch (type) {
      case 'invoice': return 'Fatura';
      case 'invoice_receipt': return 'Fatura-Recibo';
      case 'receipt': return provider === 'vendus' ? 'Recibo (RG)' : 'Recibo';
      case 'simplified_invoice': return 'Fatura Simplificada';
      case 'credit_note': return 'Nota de Crédito';
      default: return type;
    }
  };

  const getProviderLabel = (provider: string) => {
    switch (provider) {
      case 'vendus': return 'Vendus';
      case 'keyinvoice': return 'KeyInvoice';
      default: return 'InvoiceXpress';
    }
  };

  const getStatusLabel = (status: string | null, provider?: string) => {
    if ((status === 'canceled' || status === 'cancelled') && provider === 'keyinvoice') return 'Estornada';
    const map: Record<string, string> = {
      settled: 'Liquidada',
      final: 'Finalizada',
      draft: 'Rascunho',
      canceled: 'Anulada',
      sent: 'Enviada',
      second_copy: 'Segunda Via',
    };
    return map[status || ''] || status || '-';
  };

  const getStatusVariant = (status: string | null): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case 'settled': return 'default';
      case 'canceled': return 'destructive';
      case 'draft': return 'secondary';
      default: return 'outline';
    }
  };

  const handleExport = () => {
    const exportData = sortedDocuments.map(doc => ({
      Referência: doc.reference || '-',
      Tipo: getDocTypeLabel(doc.document_type, doc.provider),
      Origem: getProviderLabel(doc.provider),
      Data: doc.date ? formatDate(doc.date) : '-',
      Cliente: doc.client_name || '-',
      Estado: getStatusLabel(doc.status, doc.provider),
      Valor: doc.total,
    }));
    exportToExcel(exportData, 'documentos-fiscais');
  };

  const handleViewPdf = async (id: string, pdfPath: string | null) => {
    if (!pdfPath) return;
    setViewingId(id);
    try {
      await openPdfInNewTab(pdfPath);
    } catch {
      toast.error("Erro ao abrir PDF");
    } finally {
      setViewingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Faturas</h2>
          <p className="text-sm text-muted-foreground">
            Documentos fiscais da organização
          </p>
        </div>
        <div className="flex gap-2">
          {isVendusActive && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={syncInvoices.isPending}
              onClick={() => syncInvoices.mutate(undefined, {
                onSuccess: (result) => toast.success(result.failed
                  ? `${result.total} documento(s) sincronizado(s); ${result.failed} requer(em) revisão`
                  : `${result.total} documento(s) Vendus sincronizado(s)`),
              })}
            >
              <RefreshCw className={`h-4 w-4 ${syncInvoices.isPending ? 'animate-spin' : ''}`} />
              <span>Sincronizar Vendus</span>
            </Button>
          )}
          {(isInvoicexpressEnabled || isVendusActive) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="gap-2">
                  <Plus className="h-4 w-4" />
                  <span>Criar</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setPickerMode('invoice')}>Nova Fatura</DropdownMenuItem>
                {!isVendusActive && <DropdownMenuItem onClick={() => setPickerMode('credit-note')}>Nota de Crédito</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button onClick={handleExport} variant="outline" size="sm" className="gap-2">
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Exportar</span>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Pesquisar por referência ou cliente..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              <DateRangePicker
                value={dateRange}
                onChange={setDateRange}
                placeholder="Período"
                className="w-full xs:w-auto"
              />
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
          {sortedDocuments.length} documento(s) encontrado(s)
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-6">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : sortedDocuments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">Nenhum documento encontrado</p>
              {hasActiveFilters && (
                <Button variant="link" onClick={clearFilters} className="mt-2">Limpar filtros</Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort('reference')}>
                      <span className="flex items-center">Referência <SortIcon field="reference" sortField={sortField} sortDirection={sortDirection} /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort('document_type')}>
                      <span className="flex items-center">Tipo <SortIcon field="document_type" sortField={sortField} sortDirection={sortDirection} /></span>
                    </TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort('date')}>
                      <span className="flex items-center">Data <SortIcon field="date" sortField={sortField} sortDirection={sortDirection} /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort('client_name')}>
                      <span className="flex items-center">Cliente <SortIcon field="client_name" sortField={sortField} sortDirection={sortDirection} /></span>
                    </TableHead>
                    <TableHead className="text-center cursor-pointer select-none" onClick={() => handleSort('status')}>
                      <span className="flex items-center justify-center">Estado <SortIcon field="status" sortField={sortField} sortDirection={sortDirection} /></span>
                    </TableHead>
                    <TableHead className="text-center">Doc. Relacionado</TableHead>
                    <TableHead className="text-right cursor-pointer select-none" onClick={() => handleSort('total')}>
                      <span className="flex items-center justify-end">Valor <SortIcon field="total" sortField={sortField} sortDirection={sortDirection} /></span>
                    </TableHead>
                    <TableHead className="text-center w-[60px]">PDF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedDocuments.map((doc) => (
                    <TableRow
                      key={doc.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedInvoice({
                        invoicexpress_id: doc.invoicexpress_id,
                        invoice_id: doc.invoice_id,
                        provider: doc.provider,
                        document_type: (doc.document_type || 'invoice') as any,
                        sale_id: doc.sale_id || undefined,
                        payment_id: doc.payment_id || undefined,
                      })}
                    >
                      <TableCell className="font-medium">
                        {doc.reference || '-'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 whitespace-nowrap">
                          {getDocTypeLabel(doc.document_type, doc.provider)}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {getProviderLabel(doc.provider)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {doc.date ? formatDate(doc.date) : '-'}
                      </TableCell>
                      <TableCell className="max-w-[150px] truncate">
                        {doc.client_name || '-'}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={getStatusVariant(doc.status)} className="text-xs">
                          {getStatusLabel(doc.status, doc.provider)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {doc.related_doc_reference ? (
                          <Badge variant="outline" className="text-xs">
                            {doc.related_doc_reference}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold whitespace-nowrap">
                        {formatCurrency(doc.total)}
                      </TableCell>
                      <TableCell className="text-center">
                        {doc.pdf_path ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => { e.stopPropagation(); handleViewPdf(doc.id, doc.pdf_path); }}
                            disabled={viewingId === doc.id}
                          >
                            {viewingId === doc.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <FileDown className="h-4 w-4" />
                            )}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedInvoice && organization && (
        <InvoiceDetailsModal
          open={!!selectedInvoice}
          onOpenChange={(open) => !open && setSelectedInvoice(null)}
          documentId={selectedInvoice.invoicexpress_id}
          invoiceId={selectedInvoice.invoice_id}
          provider={selectedInvoice.provider}
          documentType={selectedInvoice.document_type}
          organizationId={organization.id}
          saleId={selectedInvoice.sale_id}
          paymentId={selectedInvoice.payment_id}
          initialDetails={{
            sequence_number: selectedInvoice.reference || '',
            status: selectedInvoice.status || 'final',
            date: selectedInvoice.date || '',
            sum: Number(selectedInvoice.total || 0),
            before_taxes: Number(selectedInvoice.total || 0),
            total: Number(selectedInvoice.total || 0),
            client: selectedInvoice.client_name ? {
              id: 0,
              name: selectedInvoice.client_name,
              fiscal_id: '',
              country: 'PT',
              address: null,
              postal_code: null,
              city: null,
              email: null,
              phone: null,
            } : null,
          }}
        />
      )}

      <SaleInvoicePicker open={pickerMode === 'invoice'} onOpenChange={(o) => !o && setPickerMode(null)} />
      <CreditNoteInvoicePicker open={pickerMode === 'credit-note'} onOpenChange={(o) => !o && setPickerMode(null)} />
    </div>
  );
}
