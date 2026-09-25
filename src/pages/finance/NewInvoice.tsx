import { useMemo, useState } from "react";
import { ArrowLeft, FileText, Search } from "lucide-react";
import { endOfDay, format, parseISO, startOfDay } from "date-fns";
import { pt } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/PageHeader";
import { SaleDetailsModal } from "@/components/sales/SaleDetailsModal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useSales } from "@/hooks/useSales";
import { formatCurrency } from "@/lib/format";
import { SALE_STATUS_COLORS, SALE_STATUS_LABELS, type SaleStatus, type SaleWithDetails } from "@/types/sales";
import { supabase } from "@/integrations/supabase/client";

type SaleInvoiceLink = {
  sale_id: string | null;
  document_type: string | null;
  processing_status: string | null;
  payment_id: string | null;
};

type SaleStatusFilter = "all" | SaleStatus;
type SalePaymentFilter = "all" | "pending" | "partial" | "paid";

const PAYMENT_LABELS: Record<Exclude<SalePaymentFilter, "all">, string> = {
  pending: "Por receber",
  partial: "Parcialmente pago",
  paid: "Pago",
};

function isInDateRange(date: string, range?: DateRange) {
  if (!range?.from) return true;
  const value = parseISO(date);
  return value >= startOfDay(range.from) && (!range.to || value <= endOfDay(range.to));
}

export default function NewInvoice() {
  const navigate = useNavigate();
  const { organization } = useAuth();
  const { data: sales = [], isLoading: salesLoading } = useSales();
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>();
  const [statusFilter, setStatusFilter] = useState<SaleStatusFilter>("all");
  const [paymentFilter, setPaymentFilter] = useState<SalePaymentFilter>("all");
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);

  const { data: fiscalDocuments = [], isLoading: documentsLoading } = useQuery({
    queryKey: ["invoice-sale-picker-documents", organization?.id],
    queryFn: async (): Promise<SaleInvoiceLink[]> => {
      if (!organization?.id) return [];
      const { data, error } = await (supabase as any)
        .from("invoices")
        .select("sale_id,document_type,processing_status,payment_id")
        .eq("organization_id", organization.id)
        .in("document_type", ["invoice", "invoice_receipt"])
        .not("sale_id", "is", null);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organization?.id,
  });

  const issuedSaleIds = useMemo(() => new Set(
    fiscalDocuments
      .filter((document) => document.sale_id && document.payment_id == null
        && !["void", "cancelled", "failed"].includes((document.processing_status ?? "").toLowerCase()))
      .map((document) => document.sale_id as string),
  ), [fiscalDocuments]);

  const eligibleSales = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-PT");
    return sales.filter((sale) => {
      if (sale.status === "cancelled" || sale.invoicexpress_id || sale.invoice_reference || sale.credit_note_id || issuedSaleIds.has(sale.id)) return false;
      if (statusFilter !== "all" && sale.status !== statusFilter) return false;
      if (paymentFilter !== "all" && sale.payment_status !== paymentFilter) return false;
      if (!isInDateRange(sale.sale_date, dateRange)) return false;
      if (!term) return true;
      return [sale.code, sale.client?.name, sale.client?.company, sale.lead?.name, sale.lead?.email]
        .some((value) => value?.toLocaleLowerCase("pt-PT").includes(term));
    });
  }, [sales, issuedSaleIds, search, dateRange, statusFilter, paymentFilter]);

  const selectedSale = sales.find((sale) => sale.id === selectedSaleId) ?? null;
  const isLoading = salesLoading || documentsLoading;

  return (
    <div className="min-h-full space-y-5 p-4 pb-20 md:p-6 md:pb-8 lg:p-8">
      <PageHeader
        icon={FileText}
        title="Nova fatura"
        subtitle="Seleciona uma venda ainda sem documento fiscal para emitir a fatura."
        actions={<Button variant="outline" onClick={() => navigate("/financeiro")}><ArrowLeft className="mr-2 h-4 w-4" />Voltar ao Financeiro</Button>}
      />

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 md:flex-row md:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Pesquisar por cliente, empresa ou código da venda…"
            className="h-10 border-primary/35 bg-primary/[0.04] pl-10 shadow-sm focus-visible:ring-2 focus-visible:ring-primary/25"
            aria-label="Pesquisar vendas sem fatura"
          />
        </div>
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as SaleStatusFilter)}>
          <SelectTrigger className="h-10 w-full border-primary/25 md:w-[190px]" aria-label="Filtrar por estado da venda">
            <SelectValue placeholder="Estado da venda" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os estados</SelectItem>
            <SelectItem value="in_progress">Em progresso</SelectItem>
            <SelectItem value="fulfilled">Entregue</SelectItem>
            <SelectItem value="delivered">Concluída</SelectItem>
          </SelectContent>
        </Select>
        <Select value={paymentFilter} onValueChange={(value) => setPaymentFilter(value as SalePaymentFilter)}>
          <SelectTrigger className="h-10 w-full border-primary/25 md:w-[190px]" aria-label="Filtrar por estado do pagamento">
            <SelectValue placeholder="Pagamento" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os pagamentos</SelectItem>
            <SelectItem value="pending">Por receber</SelectItem>
            <SelectItem value="partial">Parcialmente pago</SelectItem>
            <SelectItem value="paid">Pago</SelectItem>
          </SelectContent>
        </Select>
        <DateRangePicker value={dateRange} onChange={setDateRange} placeholder="Todo o histórico" className="w-full md:w-[260px]" />
      </div>

      <div className="flex items-center justify-between gap-3 px-1">
        <div>
          <h2 className="font-semibold">Vendas sem fatura</h2>
          <p className="text-sm text-muted-foreground">Seleciona uma venda para rever os dados e emitir o documento.</p>
        </div>
        {!isLoading && <Badge variant="secondary">{eligibleSales.length}</Badge>}
      </div>

      {isLoading ? (
        <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : eligibleSales.length === 0 ? (
        <EmptyState icon={FileText} title="Nenhuma venda por faturar" description="Não há vendas sem fatura com os filtros selecionados." />
      ) : (
        <div className="space-y-3">
          {eligibleSales.map((sale) => (
            <Card key={sale.id} className="border-border/70 transition-colors hover:border-primary/30">
              <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between md:p-5">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{sale.client?.name || sale.lead?.name || "Cliente sem nome"}</span>
                    <Badge variant="outline" className={SALE_STATUS_COLORS[sale.status]}>{SALE_STATUS_LABELS[sale.status]}</Badge>
                    <Badge variant="secondary">Venda {sale.code}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span>{format(parseISO(sale.sale_date), "dd MMM yyyy", { locale: pt })}</span>
                    <span>{sale.payment_status === "paid" ? "Pago" : sale.payment_status === "partial" ? "Parcialmente pago" : "Por receber"}</span>
                    {sale.client?.company && <span>{sale.client.company}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center justify-between gap-4 sm:justify-end">
                  <span className="text-lg font-semibold tabular-nums">{formatCurrency(sale.gross_value ?? sale.total_value)}</span>
                  <Button onClick={() => setSelectedSaleId(sale.id)}>Selecionar venda</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <SaleDetailsModal
        sale={selectedSale}
        open={!!selectedSale}
        onOpenChange={(open) => !open && setSelectedSaleId(null)}
      />
    </div>
  );
}
