import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { usePersistedState } from "@/hooks/usePersistedState";
import { matchesSearch, cn } from "@/lib/utils";
import { ShoppingBag, Search, TrendingUp, Package, CheckCircle, Plus, Zap, Download, Loader2, Trash2, CalendarClock, SlidersHorizontal } from "lucide-react";
import { useProductTypes } from "@/hooks/useProductTypes";
import { useTeamMembers } from "@/hooks/useTeam";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CommissionsPanel } from "@/components/sales/CommissionsPanel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useSales } from "@/hooks/useSales";
import { useSalesRealtime } from "@/hooks/useRealtimeSubscription";
import { SaleDetailsModal } from "@/components/sales/SaleDetailsModal";
import { CreateSaleModal } from "@/components/sales/CreateSaleModal";
import { EditSaleModal } from "@/components/sales/EditSaleModal";
import { TeamMemberFilter } from "@/components/dashboard/TeamMemberFilter";
import { CommissionFiltersBar } from "@/components/finance/CommissionFilters";
import { PinnedPageBar } from "@/components/layout/PinnedPageBar";
import { useSaleTypeIds } from "@/hooks/useSaleTypeIds";
import {
  DEFAULT_COMMISSION_FILTERS,
  hasCommissionFilters,
  saleMatchesCommissionFilters,
  NO_OPERATOR,
  NO_TYPE,
  type CommissionFilters,
} from "@/lib/commission-filters";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { formatCurrency } from "@/lib/format";
import { exportToExcel, mapPerfect2GetherSalesForExport } from "@/lib/export";
import { hasPerfect2GetherAccess } from "@/lib/perfect2gether";
import { format, parseISO, startOfDay, endOfDay } from "date-fns";
import { pt } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import type { SaleWithDetails, SaleStatus, TelecomStatus } from "@/types/sales";
import {
  BILLING_PROVIDER_LABELS,
  BILLING_STATUS_COLORS,
  BILLING_STATUS_LABELS,
  SALE_STATUS_LABELS,
  SALE_STATUS_COLORS,
  SALE_STATUSES,
  TELECOM_STATUSES,
  TELECOM_STATUS_LABELS,
  TELECOM_STATUS_COLORS,
  SERVICE_STATUS_COLORS,
  SERVICE_STATUS_LABELS,
} from "@/types/sales";


import {
  TELECOM_VIEW_LABELS,
  isTelecomViewKey,
  isTelecomViewPeriodScoped,
  matchesTelecomView,
  type TelecomViewKey,
} from "@/lib/telecom-sale-views";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useTelecomSaleMetrics } from "@/hooks/useTelecomSaleMetrics";
import { useModules } from "@/hooks/useModules";
import { TELECOM_TECHNOLOGY_LABELS, type TelecomTechnology } from "@/types/proposals";
import { useOperators } from "@/hooks/useOperators";
import type { ServicosDetails } from "@/types/proposals";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatOperationalUnits, sumOperationalSaleUnits } from "@/lib/sale-units";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * The operators a sale is under, read off the lines frozen on it. A sale can
 * carry more than one, so this returns a de-duplicated list rather than a
 * single name. Falls back to the operators table for older lines that only
 * kept the id.
 */
function buildSaleOperatorNames(operatorNameById: Map<string, string>) {
  return (sale: SaleWithDetails): string[] => {
    const details = (sale.servicos_details ?? {}) as ServicosDetails;
    const names = Object.values(details)
      .map((d) => d?.operator_name || (d?.operator_id ? operatorNameById.get(d.operator_id) : undefined))
      .filter((n): n is string => !!n);
    return [...new Set(names)];
  };
}

/**
 * The technologies frozen on a sale's lines. Only products sold as both
 * Fibra and Satélite carry one, so most sales return an empty list.
 */
function saleTechnologies(sale: SaleWithDetails): TelecomTechnology[] {
  const details = (sale.servicos_details ?? {}) as ServicosDetails;
  const techs = Object.values(details)
    .map((d) => d?.tecnologia)
    .filter((t): t is TelecomTechnology => !!t);
  return [...new Set(techs)];
}

/**
 * The booked install slot as one line. The date column carries the start of
 * the window and scheduled_install_end its end; a midnight start means only
 * a day was agreed, so no hours are shown.
 */
function saleInstallSlot(sale: SaleWithDetails): { day: string; hours: string } | null {
  if (!sale.scheduled_install_date) return null;
  const day = format(new Date(sale.scheduled_install_date), "d MMM yyyy", { locale: pt });
  const start = (sale.scheduled_install_date.split('T')[1] ?? '').slice(0, 5);
  const end = (sale.scheduled_install_end?.split('T')[1] ?? '').slice(0, 5);
  if (!start || start === '00:00') return { day, hours: end ? `até ${end}` : '' };
  return { day, hours: end ? `${start} — ${end}` : `${start}` };
}

export default function Sales() {
  // Subscribe to realtime updates
  useSalesRealtime();
  const { profile, organization, organizations, isSuperAdmin } = useAuth();
  const { data: sales, isLoading } = useSales();

  const isTelecom = organization?.niche === 'telecom';
  const isPerfect2Gether = hasPerfect2GetherAccess({
    organizationId: organization?.id,
    memberships: organizations,
    isSuperAdmin,
  });
  const { modules } = useModules();
  const { data: telecomMetrics } = useTelecomSaleMetrics();
  const { data: operators = [] } = useOperators();
  const { byId: typeById } = useProductTypes();
  const { data: teamMembers = [] } = useTeamMembers();

  const { isAdmin } = usePermissions();
  // The commission a sale is worth. A sale shows what it pays the SELLER —
  // the same number the sale's own screen shows — never the operator gross,
  // which belongs to the organization's cards alone. A non-admin still only
  // ever sees his own row, so a sale someone else sold reads 0 for him.
  const { data: comissoesPorVenda } = useQuery({
    // Prefixed with "sales" on purpose: these amounts are rewritten by a
    // trigger whenever a sale is saved, so the query has to ride on every
    // existing sales invalidation instead of sitting stale on screen.
    queryKey: ["sales", "commission-by-sale", organization?.id, profile?.id, isAdmin],
    queryFn: async () => {
      const doVendedor = new Map<string, number>();
      const minha = new Map<string, number>();
      if (!organization?.id) return { doVendedor, minha };
      const { data, error } = await (supabase as any)
        .from("sale_commission_splits")
        .select("sale_id, user_id, amount")
        .eq("organization_id", organization.id);
      if (error) throw error;
      for (const row of (data ?? []) as { sale_id: string; user_id: string; amount: number }[]) {
        const v = Number(row.amount || 0);
        doVendedor.set(row.sale_id, (doVendedor.get(row.sale_id) ?? 0) + v);
        if (row.user_id === profile?.id) minha.set(row.sale_id, (minha.get(row.sale_id) ?? 0) + v);
      }
      return { doVendedor, minha };
    },
    enabled: !!organization?.id && isTelecom,
  });

  const saleOperatorNames = useMemo(
    () => buildSaleOperatorNames(new Map(operators.map((o) => [o.id, o.name]))),
    [operators],
  );
const queryClient = useQueryClient();
const [search, setSearch] = usePersistedState("sales-search-v1", "");
  const [statusFilter, setStatusFilter] = usePersistedState<SaleStatus | "all">("sales-status-v1", "all");
  // Sale → product-type ids, for the "Tipos" switches.
  const saleTypeIds = useSaleTypeIds();
  // Telecom: operators, states and seller as switches — the same bar and
  // the same rules as the Financeiro, so the two screens agree on what a
  // filter means. Replaces the old one-value pickers for state and operator.
  const [commissionFilters, setCommissionFilters] = usePersistedState<CommissionFilters>(
    "sales-commission-filters-v1",
    DEFAULT_COMMISSION_FILTERS,
  );

  const [dateRange, setDateRange] = usePersistedState<DateRange | undefined>("sales-date-range-v1", undefined);

  const activeFilterChips = useMemo(() => {
    const chips: string[] = [];
    if (search.trim()) chips.push(`“${search.trim()}”`);
    if (dateRange?.from) {
      chips.push(dateRange.to
        ? `${format(dateRange.from, "d MMM", { locale: pt })} – ${format(dateRange.to, "d MMM", { locale: pt })}`
        : format(dateRange.from, "d MMM yyyy", { locale: pt }));
    }
    const opName = new Map(operators.map((o) => [o.id, o.name]));
    for (const id of commissionFilters.excludedOperators) chips.push(`− ${id === NO_OPERATOR ? "Sem operadora" : (opName.get(id) ?? id)}`);
    for (const st of commissionFilters.excludedStatuses ?? []) chips.push(`− ${TELECOM_STATUS_LABELS[st as TelecomStatus] ?? st}`);
    for (const t of commissionFilters.excludedTypes ?? []) chips.push(`− ${t === NO_TYPE ? "Sem tipo" : (typeById.get(t)?.name ?? t)}`);
    if (commissionFilters.userId) chips.push(teamMembers.find((m) => m.user_id === commissionFilters.userId)?.full_name ?? "vendedor");
    return chips;
  }, [search, dateRange, operators, commissionFilters, typeById, teamMembers]);


  const [selectedSale, setSelectedSale] = useState<SaleWithDetails | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [salesTab, setSalesTab] = useState<'vendas' | 'comissoes'>('vendas');
  const [saleToEdit, setSaleToEdit] = useState<SaleWithDetails | null>(null);
  const [pendingSaleId, setPendingSaleId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  // Sale pending deletion — drives the confirmation dialog (admin only).
  const [saleToDelete, setSaleToDelete] = useState<SaleWithDetails | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // Filter arriving from a dashboard card (?telecom=ativos&from=…&to=…). Lives
  // in the URL, not in persisted state: it is a one-off drill-down, and coming
  // back to Vendas later should not still be filtered by last week's click.
  const telecomView: TelecomViewKey | null = isTelecomViewKey(searchParams.get("telecom"))
    ? (searchParams.get("telecom") as TelecomViewKey)
    : null;
  const telecomFrom = searchParams.get("from");
  const telecomTo = searchParams.get("to");

  // Delete sale mutation (admin only)
const deleteSale = useMutation({
  mutationFn: async (saleId: string) => {
    const { error } = await supabase.from("sales").delete().eq("id", saleId);
    if (error) throw error;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["sales"] });
    toast.success("Venda excluída com sucesso");
  },
  onError: (err) => {
    toast.error("Erro ao excluir venda: " + (err instanceof Error ? err.message : "Erro desconhecido"));
  },
});

// Deep-link: ?sale=<id> opens the sale modal directly
  useEffect(() => {
    const id = searchParams.get("sale");
    if (id) setPendingSaleId(id);
  }, [searchParams]);

  // Finance dashboard shortcut: open the normal sale flow so the user can
  // create a sale and issue its fiscal document from the sale details.
  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    setShowCreateModal(true);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("new");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  // Reactively open sale details when pendingSaleId matches a sale in cache
  useEffect(() => {
    if (pendingSaleId && sales) {
      const sale = sales.find(s => s.id === pendingSaleId);
      if (sale) {
        setSelectedSale(sale);
        setPendingSaleId(null);
      }
    }
  }, [sales, pendingSaleId]);


  // Sync selectedSale with fresh data from React Query cache
  useEffect(() => {
    if (selectedSale && sales) {
      const fresh = sales.find(s => s.id === selectedSale.id);
      if (fresh && fresh !== selectedSale) {
        setSelectedSale(fresh);
      }
    }
  }, [sales]);
  const filteredSales = useMemo(() => {
    if (!sales) return [];

    // Reference month for "próximo mês": the period the dashboard card was
    // showing when it was clicked, so both sides look at the same month.
    const telecomReference = telecomFrom ? parseISO(telecomFrom) : new Date();

    return sales.filter((sale) => {
      // Drill-down from the dashboard. Its own date window replaces the
      // page's date filter — except for "próximo mês", which is a forward
      // look and must not be cut down to the period being analysed.
      if (telecomView) {
        if (!matchesTelecomView(sale, telecomView, telecomReference)) return false;
        if (isTelecomViewPeriodScoped(telecomView) && telecomFrom && telecomTo) {
          if (!sale.sale_date) return false;
          const d = parseISO(sale.sale_date);
          if (d < startOfDay(parseISO(telecomFrom)) || d > endOfDay(parseISO(telecomTo))) return false;
        }
      }

      // Telecom: operator, state and seller come from the switch bar, through
      // the same predicate the Financeiro uses (operators read off the sale's
      // own frozen lines; seller = who the sale is assigned to).
      const matchesStatus = isTelecom
        ? saleMatchesCommissionFilters(sale, commissionFilters, saleTypeIds)
        : (statusFilter === "all" || sale.status === statusFilter);
      const matchesType = true;
      const matchesOperator = true;

      const matchesDate = (() => {
        if (!dateRange?.from) return true;
        const referenceDate = isPerfect2Gether ? sale.activation_date || sale.sale_date : sale.sale_date;
        if (!referenceDate) return false;
        const parsedDate = parseISO(referenceDate);
        if (parsedDate < startOfDay(dateRange.from)) return false;
        if (dateRange.to && parsedDate > endOfDay(dateRange.to)) return false;
        return true;
      })();

      if (!search.trim()) {
        return matchesStatus && matchesType && matchesOperator && matchesDate;
      }

      const matchesSearchTerm = matchesSearch(
        search,
        sale.lead?.name,
        sale.lead?.email,
        sale.client?.name,
        sale.client?.code,
        sale.code,
        sale.notes,
      );

      return matchesSearchTerm && matchesStatus && matchesType && matchesOperator && matchesDate;
    });
  }, [sales, search, statusFilter, commissionFilters, saleTypeIds, isTelecom, dateRange, isPerfect2Gether, telecomView, telecomFrom, telecomTo]);

  // Summary stats
  const stats = useMemo(() => {
    if (!filteredSales.length) return { total: 0, totalValue: 0, delivered: 0, deliveredValue: 0, inProgress: 0, fulfilled: 0, fulfilledValue: 0 };

    const delivered = filteredSales.filter(s => s.status === 'delivered');
    const inProgress = filteredSales.filter(s => s.status === 'in_progress');
    const fulfilled = filteredSales.filter(s => s.status === 'fulfilled');

    return {
      total: sumOperationalSaleUnits(filteredSales),
      totalValue: filteredSales.reduce((acc, s) => acc + (s.total_value || 0), 0),
      delivered: sumOperationalSaleUnits(delivered),
      deliveredValue: delivered.reduce((acc, s) => acc + (s.total_value || 0), 0),
      inProgress: sumOperationalSaleUnits(inProgress),
      fulfilled: sumOperationalSaleUnits(fulfilled),
      fulfilledValue: fulfilled.reduce((acc, s) => acc + (s.total_value || 0), 0),
    };
  }, [filteredSales]);

  const handleExportPerfect2Gether = async () => {
    if (!isPerfect2Gether) return;
    if (!dateRange?.from) {
      toast.error("Selecione o período por Data de Adjudicação antes de exportar.");
      return;
    }

    const exportSales = filteredSales.filter((sale) => !!sale.activation_date);
    if (exportSales.length === 0) {
      toast.error("Não existem vendas adjudicadas no período selecionado.");
      return;
    }

    setIsExporting(true);
    try {
      const proposalIds = Array.from(new Set(exportSales.map((sale) => sale.proposal_id).filter(Boolean))) as string[];
      const leadIds = Array.from(new Set(exportSales.map((sale) => sale.lead_id).filter(Boolean))) as string[];
      const consultantIds = Array.from(new Set(exportSales.flatMap((sale) => [sale.created_by, sale.lead?.assigned_to]).filter(Boolean))) as string[];
      const saleIds = exportSales.map((sale) => sale.id);

      const [proposalsResponse, cpesResponse, paymentsResponse, leadsResponse, consultantsResponse] = await Promise.all([
        proposalIds.length > 0
          ? supabase
              .from("proposals")
              .select("id, code, accepted_at, proposal_date, proposal_type, negotiation_type, kwp, margem, dbl, anos_contrato, comissao, total_value")
              .in("id", proposalIds)
          : Promise.resolve({ data: [], error: null }),
        proposalIds.length > 0
          ? supabase
              .from("proposal_cpes")
              .select("proposal_id, serial_number, consumo_anual, duracao_contrato, dbl, margem, comissao, contrato_inicio, contrato_fim")
              .in("proposal_id", proposalIds)
          : Promise.resolve({ data: [], error: null }),
        saleIds.length > 0
          ? supabase
              .from("sale_payments")
              .select("sale_id, amount, status")
              .in("sale_id", saleIds)
          : Promise.resolve({ data: [], error: null }),
        leadIds.length > 0
          ? supabase
              .from("leads")
              .select("id, source")
              .in("id", leadIds)
          : Promise.resolve({ data: [], error: null }),
        consultantIds.length > 0
          ? supabase
              .from("profiles")
              .select("id, full_name")
              .in("id", consultantIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      const firstError = [
        proposalsResponse.error,
        cpesResponse.error,
        paymentsResponse.error,
        leadsResponse.error,
        consultantsResponse.error,
      ].find(Boolean);

      if (firstError) throw firstError;

      const proposalsById = new Map((proposalsResponse.data || []).map((proposal) => [proposal.id, proposal]));
      const cpesByProposalId = new Map<string, Array<(typeof cpesResponse.data)[number]>>();
      for (const cpe of cpesResponse.data || []) {
        const current = cpesByProposalId.get(cpe.proposal_id) || [];
        current.push(cpe);
        cpesByProposalId.set(cpe.proposal_id, current);
      }

      const paymentsBySaleId = new Map<string, Array<(typeof paymentsResponse.data)[number]>>();
      for (const payment of paymentsResponse.data || []) {
        const current = paymentsBySaleId.get(payment.sale_id) || [];
        current.push(payment);
        paymentsBySaleId.set(payment.sale_id, current);
      }

      const consultantsById = new Map((consultantsResponse.data || []).map((profile) => [profile.id, profile.full_name || "Comercial"]));
      const leadSourcesById = new Map((leadsResponse.data || []).map((lead) => [lead.id, lead.source || ""]));

      const rows = mapPerfect2GetherSalesForExport(exportSales, {
        proposalsById,
        cpesByProposalId,
        paymentsBySaleId,
        consultantsById,
        leadSourcesById,
      });

      exportToExcel(rows, `perfect2gether-vendas-${format(dateRange.from, "yyyy-MM")}`);
      toast.success("Exportação Perfect2Gether concluída.");
    } catch (error) {
      console.error("Error exporting Perfect2Gether sales:", error);
      toast.error("Não foi possível exportar o ficheiro Perfect2Gether.");
    } finally {
      setIsExporting(false);
    }
  };

  // Cards, search and switches — what opens under the pinned bar.
  const salesPanel = salesTab === 'vendas' ? (
    <>
      {/* Summary Cards */}
      <div className="px-4 md:px-6 pt-3 pb-1 grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3">
        <Card className={`bg-card/50 border-border/50 ${isTelecom ? 'order-4' : ''}`}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Vendas</span>
            </div>
            <p className="text-xl font-bold leading-tight">{stats.total}</p>
            <p className="text-xs text-muted-foreground">{formatCurrency(stats.totalValue)}</p>
            {isTelecom && modules.energy && telecomMetrics && (
              <p className="text-xs text-muted-foreground mt-1">
                {telecomMetrics.totalMWh.toFixed(1)} MWh · {telecomMetrics.totalKWp.toFixed(1)} kWp
              </p>
            )}
          </CardContent>
        </Card>

        <Card className={`bg-card/50 border-border/50 ${isTelecom ? 'order-3' : ''}`}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Em Progresso</span>
            </div>
            <p className="text-xl font-bold leading-tight text-blue-500">{stats.inProgress}</p>
          </CardContent>
        </Card>

        <Card className={`bg-card/50 border-border/50 ${isTelecom ? 'order-2' : ''}`}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-4 w-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">{isTelecom ? 'Ativas' : 'Entregues'}</span>
            </div>
            <p className="text-xl font-bold leading-tight text-purple-500">{stats.fulfilled}</p>
            <p className="text-xs text-muted-foreground">{formatCurrency(stats.fulfilledValue)}</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">{isTelecom ? 'Instaladas' : 'Concluídas'}</span>
            </div>
            <p className="text-xl font-bold leading-tight text-green-500">{stats.delivered}</p>
            <p className="text-xs text-muted-foreground">{formatCurrency(stats.deliveredValue)}</p>
            {isTelecom && modules.energy && telecomMetrics && (
              <p className="text-xs text-muted-foreground mt-1">
                {telecomMetrics.deliveredMWh.toFixed(1)} MWh · {telecomMetrics.deliveredKWp.toFixed(1)} kWp
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filters — pinned while the list scrolls. Plain sticky on the
          window (the page is not inside a scroll box), opaque background,
          nothing hanging outside its own width. */}
      <div className="px-4 md:px-6 py-3 space-y-3">
        {/* Drill-down chip: says which dashboard card brought you here, and
            clears back to the full list. */}
        {telecomView && (
          <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            <span className="text-muted-foreground">A mostrar:</span>
            <span className="font-medium">{TELECOM_VIEW_LABELS[telecomView]}</span>
            {telecomFrom && telecomTo && isTelecomViewPeriodScoped(telecomView) && (
              <span className="text-xs text-muted-foreground">
                {format(parseISO(telecomFrom), "d MMM", { locale: pt })} – {format(parseISO(telecomTo), "d MMM yyyy", { locale: pt })}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 px-2 text-xs"
              onClick={() => setSearchParams({}, { replace: true })}
            >
              Limpar filtro
            </Button>
          </div>
        )}
        <div className="space-y-3">
        {/* Search gets its own row so it never fights the filter grid for
            width — that's what was squeezing every label down to "Todos
            as...". Everything below sits in a grid instead of a single flex
            row, so each control gets a real column instead of shrinking. */}
        <DateRangePicker value={dateRange} onChange={setDateRange} className="w-full sm:w-[260px]" />
        {/* Telecom: operators, states and seller as switches, same bar as the
            Financeiro. Its seller picker replaces the team filter here. */}
        {isTelecom && (
          <CommissionFiltersBar value={commissionFilters} onChange={setCommissionFilters} />
        )}
        {!isTelecom && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {!isTelecom && <TeamMemberFilter className="w-full bg-card/50 border-border/50" />}
        {!isTelecom && (
          <Select value={statusFilter} onValueChange={(val) => setStatusFilter(val as SaleStatus | "all")}>
            <SelectTrigger className="w-full bg-card/50 border-border/50">
              <SelectValue placeholder="Filtrar por estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os estados</SelectItem>
              {SALE_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {SALE_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* The old Energia / Outros Serviços pair is gone: the product
            types on the switch bar above are the real ones. */}
        </div>
        )}
        </div>
      </div>
    </>
  ) : undefined;
  return (
    <div className="flex flex-col min-h-dvh bg-background">
      {/* Title, tabs, cards and filters pinned together while the list
          scrolls. Plain sticky on the window, opaque, nothing outside its
          own width — the version that behaves. */}
      <PinnedPageBar
        icon={ShoppingBag}
        title="Vendas"
        storageKey="sales-filters-open-v1"
        search={
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Pesquisar por nome, empresa ou código..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-9 text-sm"
            />
          </div>
        }
        tabs={
          <Tabs value={salesTab} onValueChange={(v) => setSalesTab(v as 'vendas' | 'comissoes')}>
            <TabsList className="h-8">
              <TabsTrigger value="vendas" className="h-7 text-xs">Vendas</TabsTrigger>
              <TabsTrigger value="comissoes" className="h-7 text-xs">Comissões</TabsTrigger>
            </TabsList>
          </Tabs>
        }
        summary={salesTab === 'vendas'
          ? `${formatOperationalUnits(stats.total)} venda${stats.total === 1 ? '' : 's'} · ${formatCurrency(stats.totalValue)} · ${formatOperationalUnits(stats.inProgress)} em progresso${isTelecom ? ` · ${formatOperationalUnits(stats.fulfilled)} ativa${stats.fulfilled === 1 ? '' : 's'}` : ''} · ${formatOperationalUnits(stats.delivered)} ${isTelecom ? `instalada${stats.delivered === 1 ? '' : 's'}` : `concluída${stats.delivered === 1 ? '' : 's'}`}`
          : undefined}
        chips={salesTab === 'vendas' ? activeFilterChips : []}
        actions={
          <>
            {isPerfect2Gether && (
              <Button variant="outline" size="sm" className="h-8" onClick={handleExportPerfect2Gether} disabled={isExporting}>
                {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                <span className="hidden sm:inline">Exportar Perfect2Gether</span>
                <span className="sm:hidden">Exportar</span>
              </Button>
            )}
            <Button onClick={() => setShowCreateModal(true)} size="sm" className="h-8">
              <Plus className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Nova Venda</span>
              <span className="sm:hidden">Nova</span>
            </Button>
          </>
        }
        panel={salesPanel}
      />
      {salesTab === 'comissoes' && <CommissionsPanel />}

      {salesTab === 'vendas' && (
      <>
      {/* Sales List */}
      <div className="flex-1 px-4 md:px-6 pb-nav-safe md:pb-6 space-y-3">
        {isLoading ? (
          <>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </>
        ) : filteredSales.length === 0 ? (
          (search || statusFilter !== "all" || hasCommissionFilters(commissionFilters) || telecomView) ? (
            <EmptyState icon={ShoppingBag} title="Nenhuma venda encontrada" description="Tenta ajustar os filtros de pesquisa." />
          ) : (
            <EmptyState
              icon={ShoppingBag}
              title="Ainda não tens vendas"
              description="Regista a tua primeira venda ou aceita uma proposta para começares a faturar."
            >
              <Button onClick={() => setShowCreateModal(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Registar primeira venda
              </Button>
            </EmptyState>
          )
        ) : (
          filteredSales.map((sale) => (
            <Card 
              key={sale.id} 
              className="bg-card/50 border-border/50 hover:bg-accent/50 transition-colors cursor-pointer"
              onClick={() => setSelectedSale(sale)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {/* Telecom shows its own lifecycle; the generic status
                          is kept in sync behind it but never displayed here. */}
                      {isTelecom && sale.telecom_status ? (
                        <Badge
                          variant="outline"
                          className={`${TELECOM_STATUS_COLORS[sale.telecom_status as TelecomStatus]} text-xs`}
                        >
                          {TELECOM_STATUS_LABELS[sale.telecom_status as TelecomStatus]}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className={`${SALE_STATUS_COLORS[sale.status]} text-xs`}
                        >
                          {isTelecom ? 'Sem estado' : SALE_STATUS_LABELS[sale.status]}
                        </Badge>
                      )}
                      {isTelecom && modules.energy && (sale as any).proposal_type && (
                        <Badge 
                          variant="outline" 
                          className={(sale as any).proposal_type === 'energia' 
                            ? 'bg-yellow-500/20 text-yellow-600 border-yellow-500/30 text-xs' 
                            : 'bg-cyan-500/20 text-cyan-600 border-cyan-500/30 text-xs'}
                        >
                          {(sale as any).proposal_type === 'energia' ? '⚡ Energia' : '🔧 Serviços'}
                        </Badge>
                      )}
                      {sale.recurrence && (
                        <>
                          <Badge
                            variant="outline"
                            className={`${SERVICE_STATUS_COLORS[sale.recurrence.service_status]} text-xs`}
                          >
                            Serviço: {SERVICE_STATUS_LABELS[sale.recurrence.service_status]}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={`${BILLING_STATUS_COLORS[sale.recurrence.billing_status]} text-xs`}
                          >
                            Cobrança: {BILLING_STATUS_LABELS[sale.recurrence.billing_status]}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {BILLING_PROVIDER_LABELS[sale.recurrence.billing_provider]}
                          </Badge>
                        </>
                      )}
                      {sale.code && (
                        <span className="text-xs font-medium text-primary">{sale.code}</span>
                      )}
                      {/* Which operator(s) the sale is under, read off the lines
                          frozen on it — until now this needed opening the sale. */}
                      {saleOperatorNames(sale).map((op) => (
                        <Badge
                          key={op}
                          variant="outline"
                          className="bg-primary/10 text-primary border-primary/30 text-xs font-semibold"
                        >
                          {op}
                        </Badge>
                      ))}
                      {/* Which technology was sold — the same product pays a
                          different commission on Fibra and on Satélite. */}
                      {isTelecom && saleTechnologies(sale).map((tech) => (
                        <Badge
                          key={tech}
                          variant="outline"
                          className="bg-sky-500/10 text-sky-600 border-sky-500/30 text-xs font-medium"
                        >
                          {TELECOM_TECHNOLOGY_LABELS[tech]}
                        </Badge>
                      ))}
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(sale.created_at), "d MMM yyyy", { locale: pt })}
                      </span>
                    </div>
                    <p className="font-medium truncate">
                      {sale.client?.name || sale.lead?.name || "Sem identificação"}
                    </p>
                    {/* The booked install slot — the field the team chases
                        every day, until now only visible inside the sale. */}
                    {isTelecom && (() => {
                      const slot = saleInstallSlot(sale);
                      return (
                        <div
                          className={cn(
                            'mt-1.5 inline-flex items-center gap-1.5 rounded-md border px-2 py-1',
                            slot
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                              : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400',
                          )}
                        >
                          <CalendarClock className="h-4 w-4 shrink-0" />
                          <span className="text-[10px] uppercase tracking-wide font-semibold opacity-70">
                            Instalação
                          </span>
                          {slot ? (
                            <>
                              <span className="text-sm font-bold">{slot.day}</span>
                              {slot.hours && (
                                <span className="text-sm font-semibold tabular-nums">{slot.hours}</span>
                              )}
                            </>
                          ) : (
                            <span className="text-sm font-bold">Sem data marcada</span>
                          )}
                        </div>
                      );
                    })()}
                    {sale.notes && (
                      <p className="text-sm text-muted-foreground truncate mt-1">
                        {sale.notes}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    {/* Telecom bills the operator, not the client: total_value is
                        a number nobody acts on. Show the commission instead —
                        the gross for an admin, the person's own cut otherwise. */}
                    {isTelecom ? (
                      <>
                        <p className="text-lg font-semibold">
                          {formatCurrency(isAdmin
                            ? comissoesPorVenda?.doVendedor.get(sale.id) ?? 0
                            : comissoesPorVenda?.minha.get(sale.id) ?? 0)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">Comissão</p>
                      </>
                    ) : (
                      <p className="text-lg font-semibold">{formatCurrency(sale.total_value)}</p>
                    )}
                    {sale.recurrence && (
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(sale.recurrence.amount)}/mês
                      </p>
                    )}
                    {sale.proposal && (
                      <p className="text-xs text-muted-foreground">Via proposta</p>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSaleToDelete(sale);
                        }}
                        className="mt-2 rounded p-1 text-destructive/70 hover:bg-destructive/10 transition-colors"
                        title="Excluir venda"
                      >
                        <Trash2 className="h-3.5 w-3.5 mx-auto" />
                      </button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
      </>
      )}

        {/* Sale Details Modal */}
        <SaleDetailsModal
          sale={selectedSale}
          open={!!selectedSale}
          onOpenChange={(open) => !open && setSelectedSale(null)}
          onEdit={(sale) => {
            setSelectedSale(null);
            setSaleToEdit(sale);
          }}
        />

        {/* Edit Sale Modal */}
        {saleToEdit && (
          <EditSaleModal
            sale={saleToEdit}
            open={!!saleToEdit}
            onOpenChange={(open) => !open && setSaleToEdit(null)}
          />
        )}

        {/* Create Sale Modal */}
        <CreateSaleModal
          open={showCreateModal}
          onOpenChange={setShowCreateModal}
          onSaleCreated={(saleId) => {
            setShowCreateModal(false);
            setPendingSaleId(saleId);
          }}
        />

        {/* Delete confirmation (admin only) */}
        <AlertDialog open={!!saleToDelete} onOpenChange={(open) => !open && setSaleToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir venda?</AlertDialogTitle>
              <AlertDialogDescription>
                {saleToDelete && (
                  <>
                    Vais excluir a venda de{" "}
                    <span className="font-medium text-foreground">
                      {saleToDelete.client?.name || saleToDelete.lead?.name || "Sem identificação"}
                    </span>{" "}
                    ({formatCurrency(saleToDelete.total_value)}). Esta ação não pode ser desfeita.
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  if (saleToDelete) deleteSale.mutate(saleToDelete.id);
                  setSaleToDelete(null);
                }}
              >
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
    </div>
  );
}
