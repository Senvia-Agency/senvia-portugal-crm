import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { pt } from "date-fns/locale";
import {
  ArrowRight, CalendarClock, CalendarDays, Check, CircleDollarSign,
  CreditCard, FileText, Plus, Receipt, Search, Users, Wallet,
} from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AddExpenseModal } from "@/components/finance/AddExpenseModal";
import { BankAccountsTab } from "@/components/finance/BankAccountsTab";
import { FinanceCardDetail, type FinanceDetailType } from "@/components/finance/FinanceCardDetail";
import { InvoicesContent } from "@/components/finance/InvoicesContent";
import { RenewalAlertsWidget } from "@/components/finance/RenewalAlertsWidget";
import InternalRequests from "@/pages/finance/InternalRequests";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency } from "@/lib/format";
import type { FinanceStats, PaymentWithSale } from "@/types/finance";

interface GenericFinanceDashboardProps {
  stats: FinanceStats;
  isLoading: boolean;
  payments: PaymentWithSale[];
  allPayments: PaymentWithSale[];
  dateRange?: DateRange;
  onDateRangeChange: (range?: DateRange) => void;
  detailView: FinanceDetailType | null;
  onDetailViewChange: (view: FinanceDetailType | null) => void;
  myConfirmedTotal: number;
  myPendingTotal: number;
  teamCommissionTotal: number;
  teamSalesCount: number;
  onMyCommissions: () => void;
}

const moneyCards: Array<{
  title: string;
  icon: typeof Wallet;
  tone: "blue" | "green" | "amber" | "red" | "violet";
  detail: FinanceDetailType;
  value: (stats: FinanceStats) => number;
  foot: (stats: FinanceStats, filtered: boolean) => string;
}> = [
  { title: "Faturado", icon: FileText, tone: "blue", detail: "faturado", value: (s) => s.totalBilled, foot: (_s, filtered) => filtered ? "No período" : "Histórico total" },
  { title: "Recebido", icon: Check, tone: "green", detail: "received", value: (s) => s.totalReceived, foot: (_s, filtered) => filtered ? "No período" : "Total recebido" },
  { title: "Pendente", icon: CalendarClock, tone: "amber", detail: "pending", value: (s) => s.totalPending, foot: () => "Total por receber" },
  { title: "Despesas", icon: Receipt, tone: "red", detail: "expenses", value: (s) => s.totalExpenses, foot: (_s, filtered) => filtered ? "No período" : "Total registado" },
  { title: "Balanço", icon: CircleDollarSign, tone: "violet", detail: "balance", value: (s) => s.balance, foot: () => "Recebido menos despesas" },
  { title: "A vencer · 7 dias", icon: CalendarDays, tone: "blue", detail: "dueSoon", value: (s) => s.dueSoon, foot: (s) => `${s.dueSoonCount} pagamento${s.dueSoonCount === 1 ? "" : "s"}` },
];

const toneClasses = {
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300",
  green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  red: "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300",
  violet: "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300",
};

export function GenericFinanceDashboard(props: GenericFinanceDashboardProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState("resumo");
  const [search, setSearch] = useState("");
  const [expenseOpen, setExpenseOpen] = useState(false);

  const chartData = useMemo(() => props.stats.cashflowTrend.map((point) => ({
    ...point,
    label: format(parseISO(point.date), "dd MMM", { locale: pt }),
  })), [props.stats.cashflowTrend]);

  const receivables = useMemo(() => {
    const rows = search.trim() ? props.allPayments : props.stats.dueSoonPayments;
    const term = search.trim().toLocaleLowerCase("pt-PT");
    return rows.filter((payment) => {
      if (search.trim() && payment.status !== "paid" && payment.status !== "pending") return false;
      if (!search.trim() && payment.status !== "pending") return false;
      if (!term) return true;
      return [payment.client_name, payment.sale.code, payment.invoice_reference, payment.sale.invoice_reference, payment.notes]
        .some((value) => value?.toLocaleLowerCase("pt-PT").includes(term));
    }).sort((a, b) => a.payment_date.localeCompare(b.payment_date)).slice(0, 5);
  }, [props.allPayments, props.stats.dueSoonPayments, search]);

  const selectedPeriod = props.dateRange?.from
    ? `${format(props.dateRange.from, "d MMM yyyy", { locale: pt })}${props.dateRange.to ? ` – ${format(props.dateRange.to, "d MMM yyyy", { locale: pt })}` : ""}`
    : "Todo o histórico";

  const handleNewInvoice = () => navigate("/sales?new=1");

  return (
    <div className="min-h-full space-y-5 p-4 pb-20 md:p-6 md:pb-8 lg:p-8">
      <header className="flex flex-col gap-4 border-b border-border/70 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-primary">Gestão financeira</p>
          <h1 className="text-3xl font-semibold tracking-tight md:text-[2.1rem]">Financeiro</h1>
          <p className="mt-1 text-sm text-muted-foreground">Acompanhe faturação, recebimentos e despesas num só lugar.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleNewInvoice} className="h-10 px-4">
            <Plus className="mr-1.5 h-4 w-4" /> Nova venda
          </Button>
          <Button variant="outline" onClick={() => setExpenseOpen(true)} className="h-10 px-4">
            <Plus className="mr-1.5 h-4 w-4" /> Nova despesa
          </Button>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-10 w-full justify-start gap-1 overflow-x-auto rounded-none border-b bg-transparent p-0 sm:w-auto">
          <TabsTrigger value="resumo" className="h-10 rounded-none border-b-2 border-transparent px-4 data-[state=active]:border-primary data-[state=active]:bg-transparent">Resumo</TabsTrigger>
          <TabsTrigger value="contas" className="h-10 rounded-none border-b-2 border-transparent px-4 data-[state=active]:border-primary data-[state=active]:bg-transparent">Contas</TabsTrigger>
          <TabsTrigger value="faturas" className="h-10 rounded-none border-b-2 border-transparent px-4 data-[state=active]:border-primary data-[state=active]:bg-transparent">Faturas</TabsTrigger>
          <TabsTrigger value="outros" className="h-10 rounded-none border-b-2 border-transparent px-4 data-[state=active]:border-primary data-[state=active]:bg-transparent">Outros</TabsTrigger>
        </TabsList>

        <TabsContent value="resumo" className="mt-5 space-y-5">
          <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 md:flex-row md:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Pesquisar recebimentos por cliente, venda ou referência…"
                className="h-10 border-0 bg-muted/40 pl-10 shadow-none focus-visible:ring-1"
                aria-label="Pesquisar recebimentos"
              />
            </div>
            <DateRangePicker value={props.dateRange} onChange={props.onDateRangeChange} placeholder="Todo o histórico" className="w-full md:w-[260px]" />
          </div>

          <nav aria-label="Atalhos financeiros" className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => { setTab("resumo"); setSearch(""); }}>Tudo</Button>
            <Button size="sm" variant="outline" onClick={() => setTab("faturas")}><FileText className="mr-1.5 h-4 w-4" />Faturas</Button>
            <Button size="sm" variant="outline" onClick={() => props.onDetailViewChange("expenses")}><Receipt className="mr-1.5 h-4 w-4" />Despesas</Button>
            <Button size="sm" variant="outline" onClick={() => navigate("/clients")}><Users className="mr-1.5 h-4 w-4" />Clientes</Button>
            <span className="ml-auto hidden items-center text-xs text-muted-foreground sm:flex">Período: {selectedPeriod}</span>
          </nav>

          {props.detailView ? (
            <FinanceCardDetail
              type={props.detailView}
              dateRange={props.dateRange}
              payments={props.payments}
              allPayments={props.allPayments}
              dueSoonPayments={props.stats.dueSoonPayments}
              onBack={() => props.onDetailViewChange(null)}
            />
          ) : (
            <>
              <section className="rounded-xl border bg-muted/20 p-3 md:p-4" aria-labelledby="finance-period-title">
                <div className="mb-3 flex items-center justify-between gap-3 px-1">
                  <div>
                    <h2 id="finance-period-title" className="font-semibold tracking-tight">Visão geral do período</h2>
                    <p className="text-xs text-muted-foreground">{selectedPeriod}</p>
                  </div>
                  <span className="hidden text-xs text-muted-foreground lg:inline">Selecione um indicador para ver os movimentos</span>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
                  {moneyCards.map(({ title, icon: Icon, tone, detail, value, foot }) => (
                    <Card key={title} role="button" tabIndex={0} onClick={() => props.onDetailViewChange(detail)}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); props.onDetailViewChange(detail); } }}
                      className="group cursor-pointer border-border/70 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <CardContent className="flex min-h-[116px] items-start gap-3 p-4">
                        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${toneClasses[tone]}`}><Icon className="h-5 w-5" /></span>
                        <div className="min-w-0 pt-0.5">
                          <p className="text-xs font-medium text-muted-foreground">{title}</p>
                          {props.isLoading ? <Skeleton className="mt-2 h-7 w-24" /> : <p className="mt-1 whitespace-nowrap text-xl font-semibold tracking-tight">{formatCurrency(value(props.stats))}</p>}
                          <p className="mt-1 text-[11px] text-muted-foreground">{foot(props.stats, !!props.dateRange?.from)}</p>
                        </div>
                        <ArrowRight className="ml-auto mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.8fr)]">
                <Card className="min-w-0 overflow-hidden">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
                    <div><CardTitle className="text-base">Fluxo de caixa</CardTitle><p className="mt-1 text-xs text-muted-foreground">Entradas e saídas ao longo do período</p></div>
                    <Wallet className="h-5 w-5 text-primary" />
                  </CardHeader>
                  <CardContent className="pt-3">
                    {props.isLoading ? <Skeleton className="h-[250px] w-full" /> : chartData.length === 0 ? (
                      <div className="grid h-[250px] place-items-center text-sm text-muted-foreground">Sem movimentos neste período.</div>
                    ) : (
                      <div className="h-[250px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={chartData} margin={{ top: 8, right: 10, left: -12, bottom: 0 }}>
                            <defs>
                              <linearGradient id="genericReceivedFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.24} /><stop offset="100%" stopColor="#10b981" stopOpacity={0.02} /></linearGradient>
                              <linearGradient id="genericExpenseFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f43f5e" stopOpacity={0.2} /><stop offset="100%" stopColor="#f43f5e" stopOpacity={0.02} /></linearGradient>
                            </defs>
                            <CartesianGrid vertical={false} strokeDasharray="3 5" className="stroke-border" />
                            <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={16} />
                            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(n) => `€${n}`} width={48} />
                            <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={{ borderRadius: 10, border: "1px solid hsl(var(--border))", background: "hsl(var(--background))" }} />
                            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                            <Area type="monotone" dataKey="received" name="Recebido" stroke="#059669" strokeWidth={2} fill="url(#genericReceivedFill)" />
                            <Area type="monotone" dataKey="expenses" name="Despesas" stroke="#e11d48" strokeWidth={2} fill="url(#genericExpenseFill)" />
                            <Area type="monotone" dataKey="scheduled" name="Agendado" stroke="#2563eb" strokeWidth={2} fill="none" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </CardContent>
                </Card>
                <RenewalAlertsWidget />
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.8fr)_minmax(270px,0.7fr)]">
                <Card className="min-w-0">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <div><CardTitle className="text-base">{search ? "Resultados" : "Próximos recebimentos"}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{search ? "Pagamentos encontrados" : "Pagamentos previstos para os próximos 7 dias"}</p></div>
                    <Button variant="ghost" size="sm" className="h-8" onClick={() => props.onDetailViewChange(search ? "pending" : "dueSoon")}>Ver todos <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>
                  </CardHeader>
                  <CardContent className="pt-1">
                    {receivables.length ? (
                      <div className="divide-y">
                        {receivables.map((payment) => (
                          <button key={payment.id} onClick={() => props.onDetailViewChange(payment.status === "paid" ? "received" : "pending")} className="grid w-full grid-cols-[76px_minmax(0,1fr)_auto] items-center gap-3 py-3 text-left transition-colors hover:bg-muted/40">
                            <span className="text-xs tabular-nums text-muted-foreground">{format(parseISO(payment.payment_date), "dd/MM/yy")}</span>
                            <span className="min-w-0"><span className="block truncate text-sm font-medium">{payment.client_name || `Venda ${payment.sale.code}`}</span><span className="block truncate text-xs text-muted-foreground">{payment.sale.invoice_reference || `Venda ${payment.sale.code}`}</span></span>
                            <span className="text-right"><span className="block whitespace-nowrap text-sm font-semibold">{formatCurrency(payment.amount)}</span><span className={`text-[11px] ${payment.status === "paid" ? "text-emerald-600" : "text-amber-600"}`}>{payment.status === "paid" ? "Pago" : "A vencer"}</span></span>
                          </button>
                        ))}
                      </div>
                    ) : <div className="py-8 text-center text-sm text-muted-foreground">{search ? "Não foram encontrados pagamentos." : "Não há pagamentos previstos para os próximos 7 dias."}</div>}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">Ações rápidas</CardTitle><p className="text-xs text-muted-foreground">Acesso às tarefas frequentes</p></CardHeader>
                  <CardContent className="grid grid-cols-2 gap-2 pt-1">
                    <Button variant="outline" className="h-auto justify-start gap-2 p-3" onClick={handleNewInvoice}><span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40"><Plus className="h-4 w-4" /></span><span className="text-left"><span className="block text-xs font-semibold">Nova venda</span><span className="block text-[10px] text-muted-foreground">Faturar depois</span></span></Button>
                    <Button variant="outline" className="h-auto justify-start gap-2 p-3" onClick={() => setExpenseOpen(true)}><span className="grid h-8 w-8 place-items-center rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-950/40"><Plus className="h-4 w-4" /></span><span className="text-left"><span className="block text-xs font-semibold">Nova despesa</span><span className="block text-[10px] text-muted-foreground">Registar custo</span></span></Button>
                    <Button variant="outline" className="h-auto justify-start gap-2 p-3" onClick={() => navigate("/clients")}><span className="grid h-8 w-8 place-items-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-950/40"><Users className="h-4 w-4" /></span><span className="text-left"><span className="block text-xs font-semibold">Clientes</span><span className="block text-[10px] text-muted-foreground">Ver carteira</span></span></Button>
                    <Button variant="outline" className="h-auto justify-start gap-2 p-3" onClick={() => setTab("faturas")}><span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40"><FileText className="h-4 w-4" /></span><span className="text-left"><span className="block text-xs font-semibold">Faturas</span><span className="block text-[10px] text-muted-foreground">Ver documentos</span></span></Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><CreditCard className="h-4 w-4 text-primary" />Comissões</CardTitle><p className="text-xs text-muted-foreground">Resumo da atividade comercial</p></CardHeader>
                  <CardContent className="space-y-3 pt-1">
                    <div><p className="text-2xl font-semibold tracking-tight text-primary">{formatCurrency(props.teamCommissionTotal)}</p><p className="text-xs text-muted-foreground">{props.teamSalesCount} venda{props.teamSalesCount === 1 ? "" : "s"} {props.dateRange?.from ? "no período" : "no total"}</p></div>
                    <div className="flex items-center justify-between border-t pt-3"><span className="text-xs text-muted-foreground">As minhas comissões</span><button onClick={props.onMyCommissions} className="text-sm font-semibold hover:text-primary">{formatCurrency(props.myConfirmedTotal)}</button></div>
                    {props.myPendingTotal > 0 && <p className="text-[11px] text-muted-foreground">{formatCurrency(props.myPendingTotal)} pendentes</p>}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="contas" className="mt-5"><BankAccountsTab /></TabsContent>
        <TabsContent value="faturas" className="mt-5"><InvoicesContent /></TabsContent>
        <TabsContent value="outros" className="mt-5"><InternalRequests /></TabsContent>
      </Tabs>
      <AddExpenseModal open={expenseOpen} onOpenChange={setExpenseOpen} />
    </div>
  );
}
