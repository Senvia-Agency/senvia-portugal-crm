import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { usePersistedState } from "@/hooks/usePersistedState";
import { cn } from "@/lib/utils";
import { matchesSaleSearch } from "@/lib/sales-search";
import { ShoppingBag, Plus, Download, Loader2, Upload, Layers, RadioTower, Tag, Users, ChevronDown, Search } from "lucide-react";
import { useProductTypes } from "@/hooks/useProductTypes";
import { useTeamMembers } from "@/hooks/useTeam";
import { EmptyState } from "@/components/ui/empty-state";
import { MinhasComissoesModal } from "@/components/finance/MinhasComissoesModal";
import { useMyCommissions } from "@/hooks/useSalesApproval";
import { commissionPortions } from "@/lib/commission-earnings";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSales } from "@/hooks/useSales";
import { useSalesRealtime } from "@/hooks/useRealtimeSubscription";
import { SaleDetailsModal } from "@/components/sales/SaleDetailsModal";
import { CreateSaleModal } from "@/components/sales/CreateSaleModal";
import { EditSaleModal } from "@/components/sales/EditSaleModal";
import { SalesTable } from "@/components/sales/SalesTable";
import { TeamMemberFilter } from "@/components/dashboard/TeamMemberFilter";
import { FilterRow, MultiFilterPill } from "@/components/shared/FilterPills";
import { filterChipClass, toggled } from "@/components/shared/filter-pills";
import { useSaleTypeIds } from "@/hooks/useSaleTypeIds";
import { useTeamFilter } from "@/hooks/useTeamFilter";
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
import { exportToCsv, exportToExcel, mapPerfect2GetherSalesForExport, mapSalesForExport } from "@/lib/export";
import { ExportMenu, type ExportKind } from "@/components/shared/ExportMenu";
import { ImportSalesDialog } from "@/components/sales/ImportSalesDialog";
import { hasPerfect2GetherAccess } from "@/lib/perfect2gether";
import { format, parseISO, startOfDay, endOfDay } from "date-fns";
import type { DateRange } from "react-day-picker";
import type { SaleWithDetails, SaleStatus } from "@/types/sales";
import { SALE_STATUS_LABELS, SALE_STATUSES, TELECOM_STATUSES, TELECOM_STATUS_LABELS } from "@/types/sales";
import {
  TELECOM_VIEW_LABELS,
  isTelecomViewKey,
  isTelecomViewPeriodScoped,
  matchesTelecomViewInPeriod,
  type TelecomViewKey,
} from "@/lib/telecom-sale-views";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useModules } from "@/hooks/useModules";
import { type TelecomTechnology } from "@/types/proposals";
import { useOperators } from "@/hooks/useOperators";
import type { ServicosDetails } from "@/types/proposals";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatOperationalUnits, sumOperationalSaleUnits } from "@/lib/sale-units";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageModuleIcon } from "@/components/layout/ModuleNavIcon";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLanguage, dateLocale, tr } from "@/i18n";

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
  const day = format(new Date(sale.scheduled_install_date), "d MMM yyyy", { locale: dateLocale() });
  const start = (sale.scheduled_install_date.split('T')[1] ?? '').slice(0, 5);
  const end = (sale.scheduled_install_end?.split('T')[1] ?? '').slice(0, 5);
  if (!start || start === '00:00') return { day, hours: end ? tr("até {{time}}", { time: end }) : '' };
  return { day, hours: end ? `${start} — ${end}` : `${start}` };
}

/**
 * The telecom switches are opt-out (CommissionFilters, shared with the Financeiro): they list
 * what is switched OFF. The pills here list what is shown, so the two are converted.
 */
const shownFromExcluded = (excluded: readonly string[] | undefined, all: readonly string[]) =>
  !excluded || excluded.length === 0 ? [] : all.filter((key) => !excluded.includes(key));
const excludedFromShown = (shown: readonly string[], all: readonly string[]) =>
  shown.length === 0 ? [] : all.filter((key) => !shown.includes(key));

/** One figure of the summary line under the filters. */
function Figure({ label, value, hint, tone, onClick }: { label: string; value: string; hint?: string; tone?: string; onClick?: () => void }) {
  const Box = onClick ? 'button' : 'div';
  return (
    <Box {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cn("min-w-0 rounded-xl border border-border/70 bg-card px-4 py-2.5 text-left shadow-sm", onClick && "transition-colors hover:border-primary/40 hover:bg-primary/5")}>
      <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("truncate text-lg font-semibold tabular-nums", tone)}>{value}</p>
      {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
    </Box>
  );
}

export default function Sales() {
  const { t } = useLanguage();
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
  const showEnergy = isTelecom && modules.energy;
  const { data: operators = [] } = useOperators();
  const { active: productTypes } = useProductTypes();
  const { data: teamMembers = [] } = useTeamMembers();
  const { selectedMemberId } = useTeamFilter();

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
      const { data, error } = await (supabase as unknown as { from: (table: string) => any })
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
  const commissionOf = (sale: SaleWithDetails) =>
    (isAdmin ? comissoesPorVenda?.doVendedor.get(sale.id) : comissoesPorVenda?.minha.get(sale.id)) ?? 0;

  const saleOperatorNames = useMemo(
    () => buildSaleOperatorNames(new Map(operators.map((o) => [o.id, o.name]))),
    [operators],
  );
  const queryClient = useQueryClient();
  const [search, setSearch] = usePersistedState("sales-search-v1", "");
  // v2: several states can be picked at once (empty = all), as on the other pages.
  const [statusFilter, setStatusFilter] = usePersistedState<SaleStatus[]>("sales-status-v2", []);
  // Sale → product-type ids, for the "Tipos" switches.
  const saleTypeIds = useSaleTypeIds();
  // Telecom: operators, states, types and seller — the same filters and rules
  // as the Financeiro, so the two screens agree on what a filter means.
  const [commissionFilters, setCommissionFilters] = usePersistedState<CommissionFilters>(
    "sales-commission-filters-v1",
    DEFAULT_COMMISSION_FILTERS,
  );

  const [dateRange, setDateRange] = usePersistedState<DateRange | undefined>("sales-date-range-v1", undefined);

  const [selectedSale, setSelectedSale] = useState<SaleWithDetails | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // What the person earned: one figure among the others, opening the detail. The
  // team's commissions and their payment live in Financeiro → Comissões.
  const { data: myCommissions } = useMyCommissions();
  const [myCommissionsOpen, setMyCommissionsOpen] = useState(false);
  const commissionByPayment = organization?.niche !== "telecom";
  const myConfirmed = (myCommissions || []).reduce((sum, sale) => sum + (commissionByPayment
    ? commissionPortions(sale).confirmed
    : sale.status === "delivered" || sale.status === "fulfilled" ? Number(sale.comissao) || 0 : 0), 0);
  const myPending = (myCommissions || []).reduce((sum, sale) => sum + (commissionByPayment
    ? commissionPortions(sale).pending
    : sale.status === "pending" || sale.status === "in_progress" ? Number(sale.comissao) || 0 : 0), 0);
  const showMyCommissions = (myCommissions || []).length > 0;
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
      toast.success(t("Venda eliminada com sucesso"));
    },
    onError: (err) => {
      toast.error(t("Erro ao eliminar venda: {{error}}", { error: err instanceof Error ? err.message : t("Erro desconhecido") }));
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
        // The card's own rule and dates (installation, activation, sale), so
        // the list shows exactly the sales the number on the card counted.
        const from = telecomFrom ? startOfDay(parseISO(telecomFrom)) : null;
        const to = telecomTo ? endOfDay(parseISO(telecomTo)) : null;
        if (!matchesTelecomViewInPeriod(sale, telecomView, from ?? startOfDay(telecomReference), to)) return false;
      }

      // Telecom: operator, state, type and seller go through the same
      // predicate the Financeiro uses (operators read off the sale's own
      // frozen lines; seller = who the sale is assigned to).
      const matchesStatus = isTelecom
        ? saleMatchesCommissionFilters(sale, commissionFilters, saleTypeIds)
        : (statusFilter.length === 0 || statusFilter.includes(sale.status));

      const matchesDate = (() => {
        // A dashboard card brings its own window (checked above, by the
        // card's dates). The page's saved sale-date filter would cut it again:
        // an October installation sold in September vanished from the list.
        if (telecomView) return true;
        if (!dateRange?.from) return true;
        const referenceDate = isPerfect2Gether ? sale.activation_date || sale.sale_date : sale.sale_date;
        if (!referenceDate) return false;
        const parsedDate = parseISO(referenceDate);
        if (parsedDate < startOfDay(new Date(dateRange.from))) return false;
        if (dateRange.to && parsedDate > endOfDay(new Date(dateRange.to))) return false;
        return true;
      })();

      if (!search.trim()) return matchesStatus && matchesDate;
      return matchesSaleSearch(sale, search, isTelecom) && matchesStatus && matchesDate;
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

  const filtering = !!search.trim() || !!dateRange?.from || (isTelecom ? hasCommissionFilters(commissionFilters) : statusFilter.length > 0);
  const clearFilters = () => {
    setSearch("");
    setDateRange(undefined);
    setStatusFilter([]);
    setCommissionFilters(DEFAULT_COMMISSION_FILTERS);
  };

  const handleExportSales = (kind: ExportKind) => {
    const data = mapSalesForExport(filteredSales, isTelecom);
    const name = `vendas_${format(new Date(), "yyyy-MM-dd")}`;
    if (kind === "excel") exportToExcel(data, name); else exportToCsv(data, name);
    toast.success(t("{{n}} vendas exportadas", { n: data.length }));
  };

  const handleExportPerfect2Gether = async () => {
    if (!isPerfect2Gether) return;
    if (!dateRange?.from) {
      toast.error(t("Selecione o período por Data de Adjudicação antes de exportar."));
      return;
    }

    const exportSales = filteredSales.filter((sale) => !!sale.activation_date);
    if (exportSales.length === 0) {
      toast.error(t("Não existem vendas adjudicadas no período selecionado."));
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

      exportToExcel(rows, `perfect2gether-vendas-${format(new Date(dateRange.from), "yyyy-MM")}`);
      toast.success(t("Exportação Perfect2Gether concluída."));
    } catch (error) {
      console.error("Error exporting Perfect2Gether sales:", error);
      toast.error(t("Não foi possível exportar o ficheiro Perfect2Gether."));
    } finally {
      setIsExporting(false);
    }
  };

  // Telecom pill options (all keys, so "shown" and "switched off" can be converted).
  const operatorKeys = [...operators.map((o) => o.id), NO_OPERATOR];
  const typeKeys = [...productTypes.map((t) => t.id), NO_TYPE];
  const telecomStatusKeys = TELECOM_STATUSES as readonly string[];
  const sellerName = commissionFilters.userId ? teamMembers.find((m) => m.user_id === commissionFilters.userId)?.full_name : null;

  return (
    <div className="crm-page">
      <div className="space-y-4 p-4 sm:p-6 lg:px-8 lg:py-7">
        {/* One line: title and count, the rare actions behind ⋯, and the main action. */}
        <header className="flex flex-wrap items-center gap-x-3 gap-y-3">
          <PageModuleIcon to="/sales" />
          <div className="flex items-baseline gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{t("Vendas")}</h1>
            <span className="text-sm tabular-nums text-muted-foreground">{formatOperationalUnits(stats.total)}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" className="h-9 shrink-0 rounded-full px-3" onClick={() => setImportOpen(true)} aria-label={t("Importar vendas")}>
              <Upload className="h-4 w-4" /><span className="hidden sm:inline">{t("Importar")}</span>
            </Button>
            <ExportMenu count={filteredSales.length} noun="vendas" onExport={handleExportSales} busy={isExporting}>
              {isPerfect2Gether && (
                <DropdownMenuItem onSelect={() => void handleExportPerfect2Gether()}>
                  <Download className="mr-2 h-4 w-4" />{t("Formato Perfect2Gether")}
                </DropdownMenuItem>
              )}
            </ExportMenu>
            <Button onClick={() => setShowCreateModal(true)} className="h-9 rounded-full px-4">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{t("Nova venda")}</span>
            </Button>
          </div>
        </header>

        <>
            <FilterRow search={search} onSearch={setSearch}
              placeholder={isTelecom ? t("Pesquisar nome, NIF, empresa ou código") : t("Pesquisar nome, empresa ou código")}
              hasActive={filtering} onClear={clearFilters}>
              <DateRangePicker
                value={dateRange}
                onChange={setDateRange}
                placeholder={isPerfect2Gether ? t("Data de adjudicação") : t("Todo o histórico")}
                className={cn(filterChipClass(!!dateRange?.from), 'w-auto justify-start [&_svg]:mr-0')}
              />
              {isTelecom ? (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger className={filterChipClass(!!commissionFilters.userId)}>
                      <Users className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="max-w-[10rem] truncate">{sellerName ?? t("Vendedor")}</span>
                      <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
                      <DropdownMenuRadioGroup value={commissionFilters.userId ?? 'all'}
                        onValueChange={(value) => setCommissionFilters({ ...commissionFilters, userId: value === 'all' ? null : value })}>
                        <DropdownMenuRadioItem value="all">{t("Todos os vendedores")}</DropdownMenuRadioItem>
                        {teamMembers.map((m) => <DropdownMenuRadioItem key={m.user_id} value={m.user_id}>{m.full_name}</DropdownMenuRadioItem>)}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <MultiFilterPill icon={Layers} empty={t("Estado")} plural={t("estados")} width="w-52"
                    options={TELECOM_STATUSES.map((s) => ({ value: s, label: t(TELECOM_STATUS_LABELS[s]) }))}
                    picked={shownFromExcluded(commissionFilters.excludedStatuses, telecomStatusKeys)}
                    onToggle={(value) => setCommissionFilters({ ...commissionFilters, excludedStatuses: excludedFromShown(toggled(shownFromExcluded(commissionFilters.excludedStatuses, telecomStatusKeys), value), telecomStatusKeys) })}
                    onClear={() => setCommissionFilters({ ...commissionFilters, excludedStatuses: [] })} clearLabel={t("Todos os estados")} />
                  <MultiFilterPill icon={RadioTower} empty={t("Operadora")} plural={t("operadoras")} width="w-56"
                    options={[...operators.map((o) => ({ value: o.id, label: o.name })), { value: NO_OPERATOR, label: t("Sem operadora") }]}
                    picked={shownFromExcluded(commissionFilters.excludedOperators, operatorKeys)}
                    onToggle={(value) => setCommissionFilters({ ...commissionFilters, excludedOperators: excludedFromShown(toggled(shownFromExcluded(commissionFilters.excludedOperators, operatorKeys), value), operatorKeys) })}
                    onClear={() => setCommissionFilters({ ...commissionFilters, excludedOperators: [] })} clearLabel={t("Todas as operadoras")} />
                  <MultiFilterPill icon={Tag} empty={t("Tipo")} plural={t("tipos")} width="w-52"
                    options={[...productTypes.map((t) => ({ value: t.id, label: t.name })), { value: NO_TYPE, label: t("Sem tipo") }]}
                    picked={shownFromExcluded(commissionFilters.excludedTypes, typeKeys)}
                    onToggle={(value) => setCommissionFilters({ ...commissionFilters, excludedTypes: excludedFromShown(toggled(shownFromExcluded(commissionFilters.excludedTypes, typeKeys), value), typeKeys) })}
                    onClear={() => setCommissionFilters({ ...commissionFilters, excludedTypes: [] })} clearLabel={t("Todos os tipos")} />
                </>
              ) : (
                <>
                  <TeamMemberFilter className={cn(filterChipClass(!!selectedMemberId), 'w-auto gap-1 [&>svg:first-child]:mr-0')} />
                  <MultiFilterPill icon={Layers} empty={t("Estado")} plural={t("estados")} width="w-48"
                    options={SALE_STATUSES.map((s) => ({ value: s, label: t(SALE_STATUS_LABELS[s]) }))}
                    picked={statusFilter} onToggle={(value) => setStatusFilter((current) => toggled(current, value as SaleStatus))}
                    onClear={() => setStatusFilter([])} clearLabel={t("Todos os estados")} />
                </>
              )}
            </FilterRow>

            {/* Drill-down chip: says which dashboard card brought you here, and clears back to the full list. */}
            {telecomView && (
              <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                <span className="text-muted-foreground">{t("A mostrar:")}</span>
                <span className="font-medium">{t(TELECOM_VIEW_LABELS[telecomView])}</span>
                {telecomFrom && telecomTo && isTelecomViewPeriodScoped(telecomView) && (
                  <span className="text-xs text-muted-foreground">
                    {format(parseISO(telecomFrom), "d MMM", { locale: dateLocale() })} – {format(parseISO(telecomTo), "d MMM yyyy", { locale: dateLocale() })}
                  </span>
                )}
                <Button variant="ghost" size="sm" className="ml-auto h-7 rounded-full px-2 text-xs" onClick={() => setSearchParams({}, { replace: true })}>
                  {t("Limpar filtro")}
                </Button>
              </div>
            )}

            {/* The figures that matter, in one compact row. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]">
              <Figure label={t("Vendas")} value={formatOperationalUnits(stats.total)} hint={isTelecom ? undefined : t("{{value}} em vendas", { value: formatCurrency(stats.totalValue) })} />
              <Figure label={t("Em progresso")} value={formatOperationalUnits(stats.inProgress)} tone="text-blue-600 dark:text-blue-400" />
              <Figure label={isTelecom ? t("Ativas") : t("Entregues")} value={formatOperationalUnits(stats.fulfilled)} tone="text-violet-600 dark:text-violet-400"
                hint={isTelecom ? undefined : formatCurrency(stats.fulfilledValue)} />
              <Figure label={isTelecom ? t("Instaladas") : t("Concluídas")} value={formatOperationalUnits(stats.delivered)} tone="text-emerald-600 dark:text-emerald-400"
                hint={isTelecom ? undefined : formatCurrency(stats.deliveredValue)} />
              {showMyCommissions && <Figure label={t("As minhas comissões")} value={formatCurrency(myConfirmed)} tone="text-emerald-600 dark:text-emerald-400"
                hint={myPending > 0 ? t("+ {{value}} por receber", { value: formatCurrency(myPending) }) : t("Ver detalhe")} onClick={() => setMyCommissionsOpen(true)} />}
            </div>

            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : filteredSales.length === 0 && (filtering || telecomView) ? (
              <div className="flex h-56 flex-col items-center justify-center gap-3 text-muted-foreground">
                <Search className="h-10 w-10 opacity-50" />
                <p className="text-base font-medium">{t("Nenhuma venda corresponde aos filtros")}</p>
                {filtering && <Button variant="outline" size="sm" className="rounded-full" onClick={clearFilters}>{t("Limpar filtros")}</Button>}
              </div>
            ) : filteredSales.length === 0 ? (
              <EmptyState
                icon={ShoppingBag}
                title={t("Ainda não tens vendas")}
                description={t("Regista a tua primeira venda ou aceita uma proposta para começares a faturar.")}
              >
                <Button onClick={() => setShowCreateModal(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t("Registar primeira venda")}
                </Button>
              </EmptyState>
            ) : (
              <div className="pb-nav-safe md:pb-0">
                <SalesTable
                  sales={filteredSales}
                  isTelecom={isTelecom}
                  showEnergy={showEnergy}
                  isAdmin={isAdmin}
                  commissionOf={commissionOf}
                  operatorNamesOf={saleOperatorNames}
                  technologiesOf={saleTechnologies}
                  installSlotOf={saleInstallSlot}
                  onOpen={setSelectedSale}
                  onEdit={setSaleToEdit}
                  onDelete={setSaleToDelete}
                />
              </div>
            )}
        </>
      </div>

      <MinhasComissoesModal open={myCommissionsOpen} onOpenChange={setMyCommissionsOpen} />

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
      <ImportSalesDialog open={importOpen} onOpenChange={setImportOpen} />
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
            <AlertDialogTitle>{t("Eliminar venda?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {saleToDelete && (
                <>
                  {t("Vais eliminar a venda de")}{" "}
                  <span className="font-medium text-foreground">
                    {saleToDelete.client?.name || saleToDelete.lead?.name || t("Sem identificação")}
                  </span>{" "}
                  ({formatCurrency(saleToDelete.total_value)}). {t("Esta ação não pode ser desfeita.")}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (saleToDelete) deleteSale.mutate(saleToDelete.id);
                setSaleToDelete(null);
              }}
            >
              {t("Eliminar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
