import { usePersistedState } from "@/hooks/usePersistedState";
import { commissionPortions } from '@/lib/commission-earnings';
import { telecomCommissionInPeriod } from '@/lib/telecom-finance';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Wallet,
  TrendingUp,
  Clock,
  CalendarDays,
  TrendingDown,
  Scale,
  ExternalLink,
  AlertTriangle,
  Percent,
  Building2,
} from "lucide-react";
import { useFinanceStats } from "@/hooks/useFinanceStats";
import { PageHeader } from "@/components/layout/PageHeader";
import { formatCurrency } from "@/lib/format";
import { formatOperationalUnits } from "@/lib/sale-units";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { format, parseISO, startOfDay, endOfDay } from "date-fns";
import { pt } from "date-fns/locale";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import { InvoicesContent } from "@/components/finance/InvoicesContent";
import InternalRequests from "@/pages/finance/InternalRequests";
import { BankAccountsTab } from "@/components/finance/BankAccountsTab";
import { TeamCommissionsTab } from "@/components/finance/TeamCommissionsTab";
import { CommissionAnalysisTab } from "@/components/finance/CommissionAnalysisTab";
import { MinhasComissoesModal } from "@/components/finance/MinhasComissoesModal";
import { FinanceCardDetail, type FinanceDetailType } from "@/components/finance/FinanceCardDetail";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState } from "react";
import { useMyCommissions } from "@/hooks/useSalesApproval";
import { useTeamCommissionTotal } from "@/hooks/useCommercialCommissions";
import { RenewalAlertsWidget } from "@/components/finance/RenewalAlertsWidget";
import { GenericFinanceDashboard } from "@/components/finance/GenericFinanceDashboard";
import { ChargebacksTab } from "@/components/finance/ChargebacksTab";
import { hasPerfect2GetherAccess } from "@/lib/perfect2gether";
import { usePermissions } from "@/hooks/usePermissions";
import { CommissionFiltersBar, useCommissionFilterChips } from "@/components/finance/CommissionFilters";
import { PinnedPageBar } from "@/components/layout/PinnedPageBar";
import { useSaleChargebacks } from "@/hooks/useSaleChargebacks";
import { Hammer, PlugZap, SlidersHorizontal, Undo2 } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  DEFAULT_COMMISSION_FILTERS,
  hasCommissionFilters,
  type CommissionFilters,
} from "@/lib/commission-filters";

function TelecomFinanceFilters({
  dateRange,
  onDateRangeChange,
  filters,
  onFiltersChange,
}: {
  dateRange?: DateRange;
  onDateRangeChange: (range: DateRange | undefined) => void;
  filters: CommissionFilters;
  onFiltersChange: (filters: CommissionFilters) => void;
}) {
  const hasActiveFilters = !!dateRange?.from || hasCommissionFilters(filters);
  const renderFilters = () => (
    <CommissionFiltersBar
      value={filters}
      onChange={onFiltersChange}
      className="gap-5"
      sidebar
      periodFilter={
        <DateRangePicker
          value={dateRange}
          onChange={onDateRangeChange}
          placeholder="Todo o histórico"
          className="w-full"
        />
      }
    />
  );
  const description = "Comissões por mês previsto de recebimento. Sem período selecionado, as diferidas de meses futuros ficam excluídas.";

  return (
    <div className="contents">
      <aside className="hidden rounded-xl border border-border/70 bg-card p-3 2xl:sticky 2xl:top-4 2xl:block 2xl:max-h-[calc(100dvh-2rem)] 2xl:overflow-y-auto">
        <div className="mb-4 space-y-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <SlidersHorizontal className="h-4 w-4 text-primary" />Filtros
          </h2>
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        {renderFilters()}
      </aside>

      <div className="2xl:hidden">
        <Accordion type="single" collapsible className="rounded-xl border border-border/70 bg-card px-3">
          <AccordionItem value="finance-telecom-filters" className="border-0">
            <AccordionTrigger className="py-3 text-sm font-semibold hover:no-underline">
              <span className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                Filtros
                {hasActiveFilters && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Ativos</span>}
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pb-3">
              <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
              {renderFilters()}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  );
}

export default function Finance() {
  const { organization, organizations } = useAuth();
  const { isAdmin, isSuperAdmin } = usePermissions();
  const salesSettings = (organization?.sales_settings as { commissions_enabled?: boolean }) || {};
  const commissionsEnabled = !!salesSettings.commissions_enabled;
  const canViewCommissionAnalysis = hasPerfect2GetherAccess({
    organizationId: organization?.id,
    memberships: organizations,
    isSuperAdmin,
  }) && isAdmin;
  // Chargebacks only exist for telecom, where a sale cancelled after install
  // claws its commission back.
  const isTelecom = organization?.niche === 'telecom';
  const isGenericNiche = !organization?.niche || organization.niche === 'generic';
  // Commissions moved to the standalone /comissoes page (available with the
  // Vendas module), so they are no longer tabs here.
  const validTabs = [
    "resumo",
    "contas",
    "faturas",
    ...(isTelecom ? ["chargebacks"] : []),
    "outros",
  ];
  const [dateRange, setDateRange] = usePersistedState<DateRange | undefined>("finance-daterange-v1", undefined);
  const [activeTab, setActiveTab] = usePersistedState("finance-tab-v1", "resumo");
  // Operator switches + seller for the commission card (telecom only).
  const [commissionFilters, setCommissionFilters] = usePersistedState<CommissionFilters>(
    "finance-commission-filters-v1",
    DEFAULT_COMMISSION_FILTERS,
  );
  const [myCommissionsModalOpen, setMyCommissionsModalOpen] = useState(false);
  const [detailView, setDetailView] = useState<FinanceDetailType | null>(null);
  const { data: myCommissions } = useMyCommissions();

  // Commission cards respect the selected period (direct + recurring).
  const inPeriod = (dateStr?: string | null) => {
    if (!dateRange?.from) return true;
    if (!dateStr) return false;
    const d = parseISO(dateStr);
    if (d < startOfDay(dateRange.from)) return false;
    if (dateRange.to && d > endOfDay(dateRange.to)) return false;
    return true;
  };

  // Team commissions (admin Comissões card) — period-aware.
  const { data: teamCommission } = useTeamCommissionTotal(dateRange, isTelecom ? commissionFilters : undefined);
  const teamCommissionTotal = teamCommission?.total ?? 0;
  const teamSalesCount = teamCommission?.count ?? 0;
  // Telecom margin: what the operators paid, minus what the sellers took.
  const orgMarginTotal = teamCommission?.orgTotal ?? 0;

  // Personal commission totals ("As Minhas Comissões") — filtered by period (sale date).
  // Telecom is earned on installation, so the period must be read off the
  // activation date — the same reference the team card uses, otherwise a sale
  // sold in one month and installed in the next lands on two different months.
  const myInPeriod = (myCommissions || []).filter((s) =>
    isTelecom ? telecomCommissionInPeriod(s, dateRange) : inPeriod(s.sale_date),
  );
  const myPendingTotal = myInPeriod.reduce((sum, s) => {
    if (isTelecom) return sum + commissionPortions(s).pending;
    const isPending = s.status === 'pending' || s.status === 'in_progress';
    return isPending ? sum + (Number(s.comissao) || 0) : sum;
  }, 0);
  const myConfirmedTotal = myInPeriod.reduce((sum, s) => {
    if (isTelecom) return sum + commissionPortions(s).confirmed;
    const isConfirmed = s.status === 'delivered' || s.status === 'fulfilled';
    return isConfirmed ? sum + (Number(s.comissao) || 0) : sum;
  }, 0);

  useEffect(() => {
    if (organization && !validTabs.includes(activeTab)) {
      setActiveTab(validTabs[0]);
    }
  }, [organization, activeTab, setActiveTab, validTabs]);

  const { stats, isLoading, payments, allPayments } = useFinanceStats({
    dateRange,
    commissionFilters: isTelecom ? commissionFilters : undefined,
  });

  // Telecom: chargebacks are commission the operator takes back after a
  // cancellation post-install. Dismissed ones never happened.
  const { data: chargebacks = [] } = useSaleChargebacks();
  const chargebacksInPeriod = isTelecom
    ? chargebacks.filter((c) => c.status !== "dismissed" && inPeriod(c.created_at))
    : [];
  const chargebacksTotal = chargebacksInPeriod.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  // Telecom has no client receipts, so its balance is what the org keeps of
  // the installed commission, minus what it spends.
  const balanceShown = isTelecom ? orgMarginTotal - stats.totalExpenses : stats.balance;
  const teamPaidTotal = teamCommission?.paidTotal ?? 0;

  const commissionChips = useCommissionFilterChips(isTelecom ? commissionFilters : undefined);
  const financeChips = [...(dateRange?.from ? ["Período"] : []), ...commissionChips];

  const chartData = stats.cashflowTrend.map((point) => ({
    ...point,
    dateLabel: format(parseISO(point.date), "dd MMM", { locale: pt }),
  }));

  const hasFilters = dateRange?.from !== undefined;

  // Non-admin users only see their personal commissions card. The rest of the
  // Finance module (Resumo, Contas, Faturas, Outros, Comissões da equipa) is
  // restricted to admins.
  if (!isAdmin) {
    return (
      <div className="space-y-6 p-4 pb-20 md:p-6 md:pb-6 lg:p-8">
        <PageHeader icon={Wallet} title="Financeiro" subtitle="As tuas comissões." />

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          <Card
            className="group cursor-pointer transition-colors hover:bg-muted/50"
            onClick={() => setMyCommissionsModalOpen(true)}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">As Minhas Comissões</CardTitle>
              <div className="flex items-center gap-1">
                <Percent className="h-4 w-4 text-emerald-500" />
                <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-emerald-600 md:text-2xl">
                {formatCurrency(myConfirmedTotal)}
              </div>
              <p className="text-xs text-muted-foreground">
                Confirmadas
                {myPendingTotal > 0 && (
                  <span className="ml-1">· {formatCurrency(myPendingTotal)} pendentes</span>
                )}
              </p>
            </CardContent>
          </Card>
        </div>

        <MinhasComissoesModal open={myCommissionsModalOpen} onOpenChange={setMyCommissionsModalOpen} />
      </div>
    );
  }

  if (!isTelecom && isGenericNiche) {
    return (
      <>
        <GenericFinanceDashboard
          stats={stats}
          isLoading={isLoading}
          payments={payments}
          allPayments={allPayments}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          detailView={detailView}
          onDetailViewChange={setDetailView}
          myConfirmedTotal={myConfirmedTotal}
          myPendingTotal={myPendingTotal}
          teamCommissionTotal={teamCommissionTotal}
          teamSalesCount={teamSalesCount}
          onMyCommissions={() => setMyCommissionsModalOpen(true)}
        />
        <MinhasComissoesModal open={myCommissionsModalOpen} onOpenChange={setMyCommissionsModalOpen} />
      </>
    );
  }

  return (
    <div className="space-y-6 p-4 pb-20 md:p-6 md:pb-6 lg:p-8">
      <Tabs value={activeTab} onValueChange={setActiveTab} className={isTelecom ? "space-y-0" : "space-y-6"}>
        <PinnedPageBar
          icon={Wallet}
          title="Financeiro"
          storageKey="finance-filters-open-v1"
          tabs={
            <TabsList className="h-8 flex-wrap">
              <TabsTrigger value="resumo" className="h-7 text-xs">Resumo</TabsTrigger>
              <TabsTrigger value="contas" className="h-7 text-xs">Contas</TabsTrigger>
              <TabsTrigger value="faturas" className="h-7 text-xs">Faturas</TabsTrigger>
              {isTelecom && <TabsTrigger value="chargebacks" className="h-7 text-xs">Chargebacks</TabsTrigger>}
              <TabsTrigger value="outros" className="h-7 text-xs">Outros</TabsTrigger>
            </TabsList>
          }
          summary={!isTelecom && activeTab === "resumo"
            ? `Faturado ${formatCurrency(stats.totalBilled)} · Recebido ${formatCurrency(stats.totalReceived)}`
            : undefined}
          chips={activeTab === "resumo" ? financeChips : []}
          panel={!isTelecom && activeTab === "resumo" ? (
            <div className="space-y-3 px-4 md:px-6 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <span className="text-sm font-medium text-muted-foreground">Período:</span>
                <DateRangePicker
                  value={dateRange}
                  onChange={setDateRange}
                  placeholder="Todo o histórico"
                  className="w-full sm:w-auto"
                />
              </div>
            </div>
          ) : undefined}
          layout={isTelecom ? "dashboard" : "pinned"}
          subtitle={isTelecom ? "Comissões, instalações e despesas num só lugar." : undefined}
          className={isTelecom ? "p-0 md:p-0 lg:p-0 space-y-3" : undefined}
        />

        <TabsContent value="resumo" className={`mt-0 ${isTelecom ? "" : "space-y-6"}`}>
          <div className={isTelecom ? "mt-[30px] grid items-start gap-4 2xl:grid-cols-[252px_minmax(0,1fr)] 2xl:gap-6" : ""}>
            {isTelecom && (
              <TelecomFinanceFilters
                dateRange={dateRange}
                onDateRangeChange={setDateRange}
                filters={commissionFilters}
                onFiltersChange={setCommissionFilters}
              />
            )}
            <div className={isTelecom ? "min-w-0 space-y-6" : ""}>
          {detailView ? (
            <FinanceCardDetail
              type={detailView}
              dateRange={dateRange}
              payments={payments}
              allPayments={allPayments}
              dueSoonPayments={stats.dueSoonPayments}
              commissionFilters={isTelecom ? commissionFilters : undefined}
              onBack={() => setDetailView(null)}
            />
          ) : (
            <>
          <div className="grid grid-cols-1 xs:grid-cols-2 gap-4 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3 min-[1800px]:grid-cols-4">
            <Card
              className="group cursor-pointer transition-colors hover:bg-muted/50"
              onClick={() => setDetailView("faturado")}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{isTelecom ? "Total de Comissão" : "Total Faturado"}</CardTitle>
                <div className="flex items-center gap-1">
                  <Wallet className="h-4 w-4 text-muted-foreground" />
                  <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-xl font-bold md:text-2xl">{formatCurrency(isTelecom ? stats.totalCommission : stats.totalBilled)}</div>
                )}
                <p className="text-xs text-muted-foreground">
                  {hasFilters ? "No período" : isTelecom ? "Até ao mês atual" : "Histórico total"}
                  {isTelecom && hasCommissionFilters(commissionFilters) && " · filtrado"}
                </p>
              </CardContent>
            </Card>

            {/* The telecom lifecycle, in the operator's money: what still
                depends on an install, what is already earned, and what the
                operator took back. Replaces the client-billing cards, which
                have nothing to count in an org the client never pays. */}
            {isTelecom && (
              <>
                <Card
                  className="group cursor-pointer transition-colors hover:bg-muted/50"
                  onClick={() => setDetailView("porInstalar")}
                >
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Por instalar</CardTitle>
                    <div className="flex items-center gap-1">
                      <Hammer className="h-4 w-4 text-amber-500" />
                      <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {isLoading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <div className="text-xl font-bold text-amber-600 md:text-2xl">{formatCurrency(stats.telecomToInstall)}</div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {formatOperationalUnits(stats.telecomToInstallCount)} venda{stats.telecomToInstallCount === 1 ? "" : "s"} em instalação com data marcada
                    </p>
                  </CardContent>
                </Card>

                <Card
                  className="group cursor-pointer transition-colors hover:bg-muted/50"
                  onClick={() => setDetailView("instalado")}
                >
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Ativos e instalados</CardTitle>
                    <div className="flex items-center gap-1">
                      <PlugZap className="h-4 w-4 text-emerald-500" />
                      <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {isLoading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <div className="text-xl font-bold text-emerald-600 md:text-2xl">{formatCurrency(stats.telecomInstalled)}</div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {formatOperationalUnits(stats.telecomInstalledCount)} unidades ativas ou instaladas · comissão ganha
                    </p>
                  </CardContent>
                </Card>

                <Card
                  className="group cursor-pointer transition-colors hover:bg-muted/50"
                  onClick={() => setActiveTab("chargebacks")}
                >
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Chargebacks</CardTitle>
                    <div className="flex items-center gap-1">
                      <Undo2 className="h-4 w-4 text-destructive" />
                      <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xl font-bold text-destructive md:text-2xl">{formatCurrency(chargebacksTotal)}</div>
                    <p className="text-xs text-muted-foreground">
                      {chargebacksInPeriod.length === 0
                        ? "Nenhuma devolução"
                        : `${chargebacksInPeriod.length} devolvida${chargebacksInPeriod.length === 1 ? "" : "s"} pela operadora`}
                    </p>
                  </CardContent>
                </Card>
              </>
            )}

            {!isTelecom && (
            <Card
              className="group cursor-pointer transition-colors hover:bg-muted/50"
              onClick={() => setDetailView("received")}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Recebido</CardTitle>
                <div className="flex items-center gap-1">
                  <TrendingUp className="h-4 w-4 text-emerald-500" />
                  <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-xl font-bold text-emerald-600 md:text-2xl">{formatCurrency(stats.totalReceived)}</div>
                )}
                <p className="text-xs text-muted-foreground">{hasFilters ? "No período" : "Total recebido"}</p>
              </CardContent>
            </Card>
            )}

            {!isTelecom && (
            <Card
              className="group cursor-pointer transition-colors hover:bg-muted/50"
              onClick={() => setDetailView("pending")}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pendente</CardTitle>
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4 text-amber-500" />
                  <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-xl font-bold text-amber-600 md:text-2xl">{formatCurrency(stats.totalPending)}</div>
                )}
                <p className="text-xs text-muted-foreground">Total por receber</p>
              </CardContent>
            </Card>
            )}

            {!isTelecom && (
            <Card
              className="group cursor-pointer transition-colors hover:bg-muted/50"
              onClick={() => setDetailView("overdue")}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Atrasados</CardTitle>
                <div className="flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-xl font-bold text-orange-600 md:text-2xl">{formatCurrency(stats.totalOverdue)}</div>
                )}
                <p className="text-xs text-muted-foreground">{stats.overdueCount} pagamento(s)</p>
              </CardContent>
            </Card>
            )}

            <Card
              className="group cursor-pointer transition-colors hover:bg-muted/50"
              onClick={() => setDetailView("expenses")}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Despesas</CardTitle>
                <div className="flex items-center gap-1">
                  <TrendingDown className="h-4 w-4 text-destructive" />
                  <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-xl font-bold text-destructive md:text-2xl">{formatCurrency(stats.totalExpenses)}</div>
                )}
                <p className="text-xs text-muted-foreground">{hasFilters ? "No período" : "Total"}</p>
              </CardContent>
            </Card>

            <Card
              className="group cursor-pointer transition-colors hover:bg-muted/50"
              onClick={() => !isTelecom && setDetailView("balance")}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Balanço</CardTitle>
                <div className="flex items-center gap-1">
                  <Scale className="h-4 w-4 text-primary" />
                  <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className={`text-xl font-bold md:text-2xl ${balanceShown >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                    {formatCurrency(balanceShown)}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {isTelecom ? "Valor da Organização − Despesas" : "Recebido - Despesas"}
                </p>
              </CardContent>
            </Card>

            {!isTelecom && (
            <Card
              className="group cursor-pointer transition-colors hover:bg-muted/50"
              onClick={() => setDetailView("dueSoon")}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">A Vencer (7 dias)</CardTitle>
                <div className="flex items-center gap-1">
                  <CalendarDays className="h-4 w-4 text-blue-500" />
                  <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-xl font-bold text-blue-600 md:text-2xl">{formatCurrency(stats.dueSoon)}</div>
                )}
                <p className="text-xs text-muted-foreground">{stats.dueSoonCount} pagamento(s)</p>
              </CardContent>
            </Card>
            )}

            <Card
              className="group cursor-pointer transition-colors hover:bg-muted/50"
              onClick={() => setDetailView("myCommissions")}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">As Minhas Comissões</CardTitle>
                <div className="flex items-center gap-1">
                  <Percent className="h-4 w-4 text-emerald-500" />
                  <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold text-emerald-600 md:text-2xl">
                  {formatCurrency(myConfirmedTotal)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Confirmadas
                  {myPendingTotal > 0 && (
                    <span className="ml-1">· {formatCurrency(myPendingTotal)} pendentes</span>
                  )}
                </p>
              </CardContent>
            </Card>

            {isAdmin && (
              <Card
                className="group cursor-pointer transition-colors hover:bg-muted/50"
                onClick={() => setDetailView("commissions")}
              >
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Comissões</CardTitle>
                  <div className="flex items-center gap-1">
                    <Percent className="h-4 w-4 text-primary" />
                    <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-bold text-primary md:text-2xl">
                    {formatCurrency(teamCommissionTotal)}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {/* Telecom: "Marcar como paga" already exists on each sale, so
                        say how much of this has actually left the account. */}
                    {isTelecom && teamCommissionTotal > 0
                      ? `${formatCurrency(teamPaidTotal)} pagas · ${formatCurrency(Math.max(teamCommissionTotal - teamPaidTotal, 0))} por pagar`
                      : teamSalesCount > 0
                        ? `${teamSalesCount} venda(s) ${hasFilters ? "no período" : "no total"}`
                        : "Equipa"}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* The operator's gross belongs here and nowhere else: this is the
                only place the margin the organization keeps makes sense. */}
            {isAdmin && isTelecom && (
              <Card
                className="group cursor-pointer transition-colors hover:bg-muted/50"
                role="button"
                tabIndex={0}
                onClick={() => setDetailView("organizationValue")}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setDetailView("organizationValue");
                  }
                }}
              >
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Valor da Organização</CardTitle>
                  <div className="flex items-center gap-1">
                    <Building2 className="h-4 w-4 text-amber-500" />
                    <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-bold text-amber-600 md:text-2xl">
                    {formatCurrency(orgMarginTotal)}
                  </div>
                  {/* Same earned-sale basis as gross and team commission. */}
                  <p className="text-xs text-muted-foreground">
                    {teamSalesCount} vendas ativas ou instaladas
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Fluxo de Caixa {hasFilters ? "(período selecionado)" : "(últimos 30 dias)"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <div className="h-[180px] sm:h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorReceived" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorScheduled" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorOverdue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="dateLabel"
                        tick={{ fontSize: 12 }}
                        tickLine={false}
                        axisLine={false}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tick={{ fontSize: 12 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `€${value}`}
                      />
                      <Tooltip
                        formatter={(value: number) => formatCurrency(value)}
                        labelFormatter={(label) => label}
                        contentStyle={{
                          backgroundColor: "hsl(var(--background))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="received"
                        name="Recebido"
                        stroke="#10b981"
                        fillOpacity={1}
                        fill="url(#colorReceived)"
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="scheduled"
                        name="Agendado"
                        stroke="#3b82f6"
                        fillOpacity={1}
                        fill="url(#colorScheduled)"
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="overdue"
                        name="Atrasados"
                        stroke="#f97316"
                        fillOpacity={1}
                        fill="url(#colorOverdue)"
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="expenses"
                        name="Despesas"
                        stroke="#ef4444"
                        fillOpacity={0.3}
                        fill="#ef4444"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <RenewalAlertsWidget />
          </div>
            </>
          )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="contas" className="mt-0">
          <BankAccountsTab />
        </TabsContent>

        <TabsContent value="faturas" className="mt-0">
          <InvoicesContent />
        </TabsContent>

        {isTelecom && (
          <TabsContent value="chargebacks" className="mt-0">
            <ChargebacksTab />
          </TabsContent>
        )}

        <TabsContent value="outros" className="mt-0">
          <InternalRequests />
        </TabsContent>

      </Tabs>
    </div>
  );
}
