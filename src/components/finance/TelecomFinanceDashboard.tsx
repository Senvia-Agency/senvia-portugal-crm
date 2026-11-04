import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight, Banknote, Building2, FileText, Inbox, Landmark, LayoutDashboard, Percent, Plus, Receipt, SlidersHorizontal, Undo2,
  type LucideIcon,
} from "lucide-react";
import type { DateRange } from "react-day-picker";
import { AddExpenseModal } from "@/components/finance/AddExpenseModal";
import { BankAccountsTab } from "@/components/finance/BankAccountsTab";
import { ChargebacksTab } from "@/components/finance/ChargebacksTab";
import { CommissionAnalysisTab } from "@/components/finance/CommissionAnalysisTab";
import { CommissionFiltersBar, useCommissionFilterChips } from "@/components/finance/CommissionFilters";
import { ExpensesContent } from "@/components/finance/ExpensesContent";
import { FinanceCardDetail, type FinanceDetailType } from "@/components/finance/FinanceCardDetail";
import { CashflowPanel, Figure, FinanceTabNav, Panel } from "@/components/finance/FinanceLayout";
import { InvoicesContent } from "@/components/finance/InvoicesContent";
import { RenewalAlertsWidget } from "@/components/finance/RenewalAlertsWidget";
import { TeamCommissionsTab } from "@/components/finance/TeamCommissionsTab";
import { PageModuleIcon } from "@/components/layout/ModuleNavIcon";
import { FilterRow } from "@/components/shared/FilterPills";
import { filterChipClass } from "@/components/shared/filter-pills";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { usePersistedState } from "@/hooks/usePersistedState";
import { DEFAULT_COMMISSION_FILTERS, hasCommissionFilters, type CommissionFilters } from "@/lib/commission-filters";
import { formatCurrency } from "@/lib/format";
import { formatOperationalUnits } from "@/lib/sale-units";
import { cn } from "@/lib/utils";
import InternalRequests from "@/pages/finance/InternalRequests";
import type { FinanceStats, PaymentWithSale } from "@/types/finance";
import { useLanguage } from "@/i18n";

interface TelecomFinanceDashboardProps {
  stats: FinanceStats;
  isLoading: boolean;
  payments: PaymentWithSale[];
  allPayments: PaymentWithSale[];
  dateRange?: DateRange;
  onDateRangeChange: (range?: DateRange) => void;
  /** Operators, states, product types and seller: they narrow the commission figures. */
  commissionFilters: CommissionFilters;
  onCommissionFiltersChange: (filters: CommissionFilters) => void;
  detailView: FinanceDetailType | null;
  onDetailViewChange: (view: FinanceDetailType | null) => void;
  teamCommissionTotal: number;
  teamPaidTotal: number;
  commissionsLoading: boolean;
  orgMarginTotal: number;
  balance: number;
  chargebacksTotal: number;
  chargebacksCount: number;
  myConfirmedTotal: number;
  myPendingTotal: number;
}

/** The telecom finance page: what the operators pay, organised like the other finance pages. */
export type TelecomFinanceTab = "resumo" | "comissoes" | "chargebacks" | "despesas" | "faturas" | "contas" | "pedidos";

const TABS: readonly { key: TelecomFinanceTab; label: string; icon: LucideIcon }[] = [
  { key: "resumo", label: "Resumo", icon: LayoutDashboard },
  { key: "comissoes", label: "Comissões", icon: Percent },
  { key: "chargebacks", label: "Chargebacks", icon: Undo2 },
  { key: "despesas", label: "Despesas", icon: Receipt },
  { key: "faturas", label: "Faturas", icon: FileText },
  { key: "contas", label: "Contas", icon: Landmark },
  { key: "pedidos", label: "Pedidos", icon: Inbox },
];

// The filter line only makes sense where the period or the commission filters apply.
const FILTERED_TABS: readonly TelecomFinanceTab[] = ["resumo", "comissoes", "despesas", "faturas"];

const SEARCH_PLACEHOLDER: Partial<Record<TelecomFinanceTab, string>> = {
  resumo: "Pesquisar nas vendas e comissões",
  comissoes: "Pesquisar comercial",
  despesas: "Pesquisar despesas por descrição ou categoria",
  faturas: "Pesquisar documentos por referência ou cliente",
};

// Detail views that follow the seller filter; the others show the whole team.
const SELLER_DETAILS: readonly FinanceDetailType[] = ["faturado", "commissions", "myCommissions"];

export function TelecomFinanceDashboard(props: TelecomFinanceDashboardProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as TelecomFinanceTab | null;
  const tab: TelecomFinanceTab = TABS.some((item) => item.key === tabParam) ? tabParam! : "resumo";
  const [search, setSearch] = useState("");
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [commissionView, setCommissionView] = usePersistedState<"equipa" | "analise">("telecom-commissions-view-v1", "equipa");
  const { stats, isLoading, dateRange, commissionFilters } = props;
  const filterChips = useCommissionFilterChips(commissionFilters);
  const filtered = !!dateRange?.from;
  const sellerFiltered = !!commissionFilters.userId;
  const generalFilters = { ...commissionFilters, userId: null };

  const openTab = (next: TelecomFinanceTab) => {
    props.onDetailViewChange(null);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next === "resumo") params.delete("tab"); else params.set("tab", next);
      params.delete("status");
      return params;
    }, { replace: true });
  };

  const detail = (type: FinanceDetailType) => (
    <FinanceCardDetail
      type={type}
      dateRange={dateRange}
      payments={props.payments}
      allPayments={props.allPayments}
      dueSoonPayments={stats.dueSoonPayments}
      searchTerm={search}
      commissionFilters={SELLER_DETAILS.includes(type) ? commissionFilters : generalFilters}
      onBack={() => props.onDetailViewChange(null)}
    />
  );

  const periodHint = filtered ? t("no período") : t("até ao mês atual");
  const resultTone = props.balance < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400";
  const toPay = Math.max(props.teamCommissionTotal - props.teamPaidTotal, 0);

  return (
    <div className="crm-page">
      <div className="space-y-4 p-4 sm:p-6 lg:px-8 lg:py-7">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-3">
          <PageModuleIcon to="/financeiro" />
          <h1 className="text-2xl font-semibold tracking-tight">{t("Financeiro")}</h1>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" className="h-9 rounded-full px-3" onClick={() => setExpenseOpen(true)}>
              <Plus className="h-4 w-4" /><span className="hidden sm:inline">{t("Nova despesa")}</span>
            </Button>
            <Button className="h-9 rounded-full px-4" onClick={() => navigate("/financeiro/nova-fatura")}>
              <Plus className="h-4 w-4" /><span className="hidden sm:inline">{t("Nova fatura")}</span>
            </Button>
          </div>
        </header>

        <FinanceTabNav tabs={TABS} current={tab} onSelect={openTab} />

        {FILTERED_TABS.includes(tab) && (
          <FilterRow search={search} onSearch={setSearch} placeholder={t(SEARCH_PLACEHOLDER[tab] ?? "Pesquisar")}
            hasActive={!!search.trim() || filtered || hasCommissionFilters(commissionFilters)}
            onClear={() => { setSearch(""); props.onDateRangeChange(undefined); props.onCommissionFiltersChange(DEFAULT_COMMISSION_FILTERS); }}>
            <DateRangePicker value={dateRange} onChange={props.onDateRangeChange} placeholder={t("Todo o histórico")}
              className={cn(filterChipClass(filtered), "w-auto justify-start [&_svg]:mr-0")} />
            {tab !== "despesas" && tab !== "faturas" && (
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className={cn(filterChipClass(filterChips.length > 0), "gap-1.5")}>
                    <SlidersHorizontal className="h-3.5 w-3.5" />{t("Operadoras e vendedor")}
                    {filterChips.length > 0 && (
                      <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground">{filterChips.length}</span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-4">
                  <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                    {t("Comissões por mês previsto de recebimento. Sem período, as diferidas de meses futuros ficam de fora.")}
                  </p>
                  <CommissionFiltersBar value={commissionFilters} onChange={props.onCommissionFiltersChange} className="gap-4" sidebar />
                </PopoverContent>
              </Popover>
            )}
          </FilterRow>
        )}

        {tab === "resumo" && (props.detailView ? detail(props.detailView) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              <Figure label={t("Comissão bruta")} value={formatCurrency(stats.totalCommission)} loading={isLoading}
                hint={<>{t("antes dos CB")} · {periodHint}{filterChips.length > 0 && ` · ${t("filtrado")}`}</>}
                onClick={() => props.onDetailViewChange("faturado")} />
              <Figure label={t("Por instalar")} value={formatCurrency(stats.telecomToInstall)} tone="text-amber-600 dark:text-amber-400" loading={isLoading}
                hint={t(stats.telecomToInstallCount === 1 ? "{{n}} venda com data marcada" : "{{n}} vendas com data marcada", { n: formatOperationalUnits(stats.telecomToInstallCount) })}
                onClick={() => props.onDetailViewChange("porInstalar")} />
              <Figure label={t("Ativos e instalados")} value={formatCurrency(stats.telecomInstalled)} tone="text-emerald-600 dark:text-emerald-400" loading={isLoading}
                hint={t("{{n}} unidades · comissão ganha", { n: formatOperationalUnits(stats.telecomInstalledCount) })}
                onClick={() => props.onDetailViewChange("instalado")} />
              <Figure label={t("Chargebacks")} value={formatCurrency(props.chargebacksTotal)} loading={isLoading}
                tone={props.chargebacksTotal > 0 ? "text-destructive" : undefined}
                hint={props.chargebacksCount === 0 ? t("nenhum no período") : t(props.chargebacksCount === 1 ? "{{n}} confirmado" : "{{n}} confirmados", { n: props.chargebacksCount })}
                onClick={() => openTab("chargebacks")} />
              <Figure label={t("Despesas")} value={formatCurrency(stats.totalExpenses)} tone="text-rose-600 dark:text-rose-400" loading={isLoading}
                hint={filtered ? t("no período") : t("todo o histórico")} onClick={() => openTab("despesas")} />
              <Figure label={t("Balanço")} value={formatCurrency(props.balance)} tone={resultTone} loading={isLoading || props.commissionsLoading}
                hint={t("valor da organização − despesas")} onClick={() => props.onDetailViewChange("balance")} />
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div className="min-w-0 space-y-4">
                <Panel title={t("Comissões")} icon={Banknote}
                  action={<Button variant="outline" size="sm" className="h-8 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary" onClick={() => openTab("comissoes")}>{t("Ver comissões")}<ArrowRight className="h-3.5 w-3.5" /></Button>}>
                  {props.commissionsLoading ? <Skeleton className="h-16 w-full" /> : (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <button type="button" onClick={() => props.onDetailViewChange("commissions")} className="text-left transition-colors hover:text-primary">
                        <p className="text-[11px] text-muted-foreground">{sellerFiltered ? t("Do vendedor") : t("Da equipa")}</p>
                        <p className="text-lg font-semibold tabular-nums">{formatCurrency(props.teamCommissionTotal)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {t("{{value}} pagas", { value: formatCurrency(props.teamPaidTotal) })} · <span className={cn(toPay > 0.005 && "text-amber-600 dark:text-amber-400")}>{t("{{value}} por pagar", { value: formatCurrency(toPay) })}</span>
                        </p>
                      </button>
                      <button type="button" onClick={() => props.onDetailViewChange("organizationValue")} className="text-left transition-colors hover:text-primary">
                        <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><Building2 className="h-3 w-3" />{t("Valor da organização")}</p>
                        <p className="text-lg font-semibold tabular-nums">{formatCurrency(props.orgMarginTotal)}</p>
                        <p className="text-[11px] text-muted-foreground">{t("o que fica depois dos vendedores")}</p>
                      </button>
                      <button type="button" onClick={() => props.onDetailViewChange("myCommissions")} className="text-left transition-colors hover:text-primary">
                        <p className="text-[11px] text-muted-foreground">{sellerFiltered ? t("Comissão do vendedor") : t("As minhas")}</p>
                        <p className="text-lg font-semibold tabular-nums">{formatCurrency(props.myConfirmedTotal)}</p>
                        {props.myPendingTotal > 0.005 && <p className="text-[11px] text-muted-foreground">{t("{{value}} pendentes", { value: formatCurrency(props.myPendingTotal) })}</p>}
                      </button>
                    </div>
                  )}
                </Panel>
                <CashflowPanel trend={stats.cashflowTrend} loading={isLoading} />
              </div>
              <div className="min-w-0 space-y-4">
                <RenewalAlertsWidget />
              </div>
            </div>
          </>
        ))}

        {tab === "comissoes" && (
          <div className="space-y-3">
            <div role="group" aria-label={t("Comissões a mostrar")} className="flex w-fit items-center gap-0.5 rounded-full border border-border bg-card p-1 shadow-sm">
              {([["equipa", "Da equipa"], ["analise", "Análise"]] as const).map(([key, label]) => (
                <button key={key} type="button" aria-pressed={commissionView === key} onClick={() => setCommissionView(key)}
                  className={cn("flex h-7 items-center rounded-full px-3 text-xs font-medium transition-colors",
                    commissionView === key ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/30" : "text-foreground/75 hover:bg-muted")}>
                  {t(label)}
                </button>
              ))}
            </div>
            {commissionView === "equipa"
              ? <TeamCommissionsTab financeOptions={{ dateRange, commissionFilters }} search={search} />
              : <CommissionAnalysisTab />}
          </div>
        )}
        {tab === "chargebacks" && <ChargebacksTab />}
        {tab === "despesas" && <ExpensesContent search={search} dateRange={dateRange} />}
        {tab === "faturas" && <InvoicesContent search={search} dateRange={dateRange} />}
        {tab === "contas" && <BankAccountsTab />}
        {tab === "pedidos" && <InternalRequests />}
      </div>
      <AddExpenseModal open={expenseOpen} onOpenChange={setExpenseOpen} />
    </div>
  );
}
