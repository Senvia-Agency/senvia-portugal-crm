import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import {
  AlertTriangle, ArrowRight, Banknote, CalendarClock, FileText, Inbox, Landmark, LayoutDashboard, Percent, Plus, Receipt, Wallet,
  type LucideIcon,
} from "lucide-react";
import type { DateRange } from "react-day-picker";
import { AddExpenseModal } from "@/components/finance/AddExpenseModal";
import { BankAccountsTab } from "@/components/finance/BankAccountsTab";
import { CommissionsContent } from "@/components/finance/CommissionsContent";
import { FinanceCardDetail, type FinanceDetailType } from "@/components/finance/FinanceCardDetail";
import { InvoicesContent } from "@/components/finance/InvoicesContent";
import { ExpensesContent } from "@/components/finance/ExpensesContent";
import { CashflowPanel, Figure, FinanceTabNav, Panel } from "@/components/finance/FinanceLayout";
import { ReceivablesContent, type ReceivableView } from "@/components/finance/ReceivablesContent";
import { RenewalAlertsWidget } from "@/components/finance/RenewalAlertsWidget";
import { PageModuleIcon } from "@/components/layout/ModuleNavIcon";
import { FilterRow } from "@/components/shared/FilterPills";
import { filterChipClass } from "@/components/shared/filter-pills";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CommercialCommissionsData } from "@/hooks/useCommercialCommissions";
import InternalRequests from "@/pages/finance/InternalRequests";
import type { FinanceStats, PaymentWithSale } from "@/types/finance";
import { useLanguage } from "@/i18n";

interface GenericFinanceDashboardProps {
  stats: FinanceStats;
  isLoading: boolean;
  payments: PaymentWithSale[];
  allPayments: PaymentWithSale[];
  dateRange?: DateRange;
  onDateRangeChange: (range?: DateRange) => void;
  detailView: FinanceDetailType | null;
  onDetailViewChange: (view: FinanceDetailType | null) => void;
  /** Commissions of the selected period, the same figures the Comissões tab shows. */
  commissions?: CommercialCommissionsData;
  commissionsLoading: boolean;
  myUserId?: string;
}

/** The finance page, organised by what one comes to do. ?tab= opens one directly. */
export type FinanceTab = "resumo" | "receber" | "faturas" | "despesas" | "comissoes" | "contas" | "pedidos";

const TABS: readonly { key: FinanceTab; label: string; icon: LucideIcon }[] = [
  { key: "resumo", label: "Resumo", icon: LayoutDashboard },
  { key: "receber", label: "A receber", icon: CalendarClock },
  { key: "faturas", label: "Faturas", icon: FileText },
  { key: "despesas", label: "Despesas", icon: Receipt },
  { key: "comissoes", label: "Comissões", icon: Percent },
  { key: "contas", label: "Contas", icon: Landmark },
  { key: "pedidos", label: "Pedidos", icon: Inbox },
];

const SEARCH_PLACEHOLDER: Record<FinanceTab, string> = {
  resumo: "Pesquisar pagamentos por cliente, venda ou referência",
  receber: "Pesquisar pagamentos por cliente, venda ou referência",
  faturas: "Pesquisar documentos por referência ou cliente",
  despesas: "Pesquisar despesas por descrição ou categoria",
  comissoes: "Pesquisar comissões por comercial ou venda",
  contas: "Pesquisar",
  pedidos: "Pesquisar",
};

const PaymentLine = ({ payment, tone, onClick }: { payment: PaymentWithSale; tone: "late" | "soon"; onClick: () => void }) => {
  const { t } = useLanguage();
  return (
  <button type="button" onClick={onClick}
    className="grid w-full grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5 text-left transition-colors hover:bg-muted/40">
    <span className={cn("text-xs tabular-nums", tone === "late" ? "font-medium text-destructive" : "text-muted-foreground")}>
      {format(parseISO(payment.payment_date), "dd/MM/yy")}
    </span>
    <span className="min-w-0">
      <span className="block truncate text-sm font-medium">{payment.client_name || t("Venda {{code}}", { code: payment.sale.code })}</span>
      <span className="block truncate text-xs text-muted-foreground">{payment.sale.invoice_reference || t("Venda {{code}}", { code: payment.sale.code })}</span>
    </span>
    <span className="whitespace-nowrap text-sm font-semibold tabular-nums">{formatCurrency(payment.amount)}</span>
  </button>
  );
};

export function GenericFinanceDashboard(props: GenericFinanceDashboardProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as FinanceTab | null;
  const tab: FinanceTab = TABS.some((item) => item.key === tabParam) ? tabParam! : "resumo";
  const [search, setSearch] = useState("");
  const [expenseOpen, setExpenseOpen] = useState(false);
  const { stats, isLoading, dateRange } = props;

  // ?status= picks the view inside "A receber" (em atraso, recebidos…).
  const statusParam = searchParams.get("status") as ReceivableView | null;
  const openTab = (next: FinanceTab, status?: ReceivableView) => {
    props.onDetailViewChange(null);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next === "resumo") params.delete("tab"); else params.set("tab", next);
      if (status) params.set("status", status); else params.delete("status");
      return params;
    }, { replace: true });
  };

  // Searching from the summary means looking for a payment: go where payments are.
  const handleSearch = (value: string) => {
    setSearch(value);
    if (value.trim() && tab === "resumo") openTab("receber");
  };


  const today = format(new Date(), "yyyy-MM-dd");
  const overdue = useMemo(() => props.allPayments
    .filter((payment) => payment.status === "pending" && payment.payment_date < today)
    .sort((a, b) => a.payment_date.localeCompare(b.payment_date)), [props.allPayments, today]);
  const dueSoon = useMemo(() => [...stats.dueSoonPayments]
    .filter((payment) => payment.status === "pending")
    .sort((a, b) => a.payment_date.localeCompare(b.payment_date)), [stats.dueSoonPayments]);

  const filtered = !!dateRange?.from;
  const mine = props.commissions?.commercials.find((commercial) => commercial.userId === props.myUserId);
  const resultTone = stats.balance < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400";

  const detail = (type: FinanceDetailType, searchTerm = search) => (
    <FinanceCardDetail
      type={type}
      dateRange={dateRange}
      payments={props.payments}
      allPayments={props.allPayments}
      dueSoonPayments={stats.dueSoonPayments}
      searchTerm={searchTerm}
      onBack={() => (tab === "resumo" ? props.onDetailViewChange(null) : openTab("resumo"))}
    />
  );

  return (
    <div className="crm-page">
      <div className="space-y-4 p-4 sm:p-6 lg:px-8 lg:py-7">
        {/* One line: title, and the two things one comes to add. */}
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

        <FinanceTabNav tabs={TABS} current={tab} onSelect={(next) => openTab(next)} badges={{ receber: overdue.length }} />

        {tab !== "contas" && tab !== "pedidos" && (
          <FilterRow search={search} onSearch={handleSearch} placeholder={t(SEARCH_PLACEHOLDER[tab])}
            hasActive={!!search.trim() || filtered} onClear={() => { setSearch(""); props.onDateRangeChange(undefined); }}>
            <DateRangePicker value={dateRange} onChange={props.onDateRangeChange} placeholder={t("Todo o histórico")}
              className={cn(filterChipClass(filtered), "w-auto justify-start [&_svg]:mr-0")} />
          </FilterRow>
        )}

        {tab === "resumo" && (props.detailView ? detail(props.detailView) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              <Figure label={t("Faturado")} value={formatCurrency(stats.totalBilled)} hint={filtered ? t("no período") : t("todo o histórico")}
                loading={isLoading} onClick={() => props.onDetailViewChange("faturado")} />
              <Figure label={t("Recebido")} value={formatCurrency(stats.totalReceived)} tone="text-emerald-600 dark:text-emerald-400"
                hint={filtered ? t("no período") : t("todo o histórico")} loading={isLoading} onClick={() => openTab("receber", "paid")} />
              <Figure label={t("Por receber")} value={formatCurrency(stats.totalPending)} tone="text-amber-600 dark:text-amber-400"
                hint={t("{{value}} nos próximos 7 dias", { value: formatCurrency(stats.dueSoon) })} loading={isLoading} onClick={() => openTab("receber", "open")} />
              <Figure label={t("Em atraso")} value={formatCurrency(stats.totalOverdue)}
                tone={stats.overdueCount > 0 ? "text-destructive" : undefined}
                hint={t(stats.overdueCount === 1 ? "{{n}} pagamento" : "{{n}} pagamentos", { n: stats.overdueCount })} loading={isLoading}
                onClick={() => openTab("receber", "overdue")} />
              <Figure label={t("Despesas")} value={formatCurrency(stats.totalExpenses)} tone="text-rose-600 dark:text-rose-400"
                hint={filtered ? t("no período") : t("todo o histórico")} loading={isLoading} onClick={() => openTab("despesas")} />
              <Figure label={t("Balanço")} value={formatCurrency(stats.balance)} tone={resultTone}
                hint={t("recebido menos despesas")} loading={isLoading} onClick={() => props.onDetailViewChange("balance")} />
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div className="min-w-0 space-y-4">
                <CashflowPanel trend={stats.cashflowTrend} loading={isLoading} />

                {/* What comes in next and what the team earns, side by side under the chart. */}
                <div className="grid gap-4 md:grid-cols-2">
                  <Panel title={t("Próximos 7 dias")} icon={CalendarClock}
                    action={<Button variant="outline" size="sm" className="h-8 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary" onClick={() => openTab("receber", "open")}>{t("Ver tudo")}<ArrowRight className="h-3.5 w-3.5" /></Button>}>
                    {dueSoon.length ? (
                      <div className="divide-y">
                        {dueSoon.slice(0, 5).map((payment) => <PaymentLine key={payment.id} payment={payment} tone="soon" onClick={() => openTab("receber", "open")} />)}
                      </div>
                    ) : <p className="py-6 text-center text-sm text-muted-foreground">{t("Nada a receber nos próximos 7 dias.")}</p>}
                  </Panel>
                  <Panel title={t("Comissões")} icon={Banknote}
                    action={<Button variant="outline" size="sm" className="h-8 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary" onClick={() => openTab("comissoes")}>{t("Ver comissões")}<ArrowRight className="h-3.5 w-3.5" /></Button>}>
                    {props.commissionsLoading ? <Skeleton className="h-16 w-full" /> : (
                      <button type="button" onClick={() => openTab("comissoes")} className="w-full space-y-3 text-left">
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <p className="text-[11px] text-muted-foreground">{t("Ganhas")}</p>
                            <p className="text-lg font-semibold tabular-nums">{formatCurrency(props.commissions?.total ?? 0)}</p>
                          </div>
                          <div>
                            <p className="text-[11px] text-muted-foreground">{t("Por pagar")}</p>
                            <p className={cn("text-lg font-semibold tabular-nums", (props.commissions?.totalPending ?? 0) > 0.005 && "text-amber-600 dark:text-amber-400")}>
                              {formatCurrency(props.commissions?.totalPending ?? 0)}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] text-muted-foreground">{t("A ganhar")}</p>
                            <p className="text-lg font-semibold tabular-nums text-muted-foreground">{formatCurrency(props.commissions?.totalToEarn ?? 0)}</p>
                          </div>
                        </div>
                        {mine && (
                          <p className="border-t pt-2.5 text-xs text-muted-foreground">
                            {t("As minhas:")} <span className="font-medium text-foreground">{formatCurrency(mine.total)}</span> {t("ganhas")}
                            {mine.totalPending > 0.005 && <> · {t("{{value}} por pagar", { value: formatCurrency(mine.totalPending) })}</>}
                          </p>
                        )}
                      </button>
                    )}
                  </Panel>
                </div>
              </div>

              <div className="min-w-0 space-y-4">
                <Panel title={t("Em atraso")} icon={AlertTriangle}
                  className={overdue.length ? "border-destructive/30" : undefined}
                  action={overdue.length > 0 && <span className="text-sm font-semibold tabular-nums text-destructive">{formatCurrency(overdue.reduce((sum, p) => sum + Number(p.amount), 0))}</span>}>
                  {overdue.length ? (
                    <div className="divide-y">
                      {overdue.slice(0, 5).map((payment) => <PaymentLine key={payment.id} payment={payment} tone="late" onClick={() => openTab("receber", "overdue")} />)}
                      {overdue.length > 5 && (
                        <button type="button" onClick={() => openTab("receber", "overdue")} className="w-full pt-2.5 text-left text-xs font-medium text-primary hover:underline">
                          {t("Mais {{n}} em atraso", { n: overdue.length - 5 })}
                        </button>
                      )}
                    </div>
                  ) : <p className="py-4 text-center text-sm text-muted-foreground">{t("Nenhum pagamento em atraso.")}</p>}
                </Panel>

                <RenewalAlertsWidget />
              </div>
            </div>
          </>
        ))}

        {tab === "receber" && <ReceivablesContent key={statusParam ?? "default"} search={search} dateRange={dateRange} initialView={statusParam ?? undefined} />}
        {tab === "faturas" && <InvoicesContent search={search} dateRange={dateRange} />}
        {tab === "despesas" && <ExpensesContent search={search} dateRange={dateRange} />}
        {tab === "comissoes" && <CommissionsContent search={search} dateRange={dateRange} />}
        {tab === "contas" && <BankAccountsTab />}
        {tab === "pedidos" && <InternalRequests />}
      </div>
      <AddExpenseModal open={expenseOpen} onOpenChange={setExpenseOpen} />
    </div>
  );
}
