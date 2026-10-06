import { useMemo } from "react";
import { endOfDay, format, parseISO, startOfDay } from "date-fns";
import { pt } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { ArrowDownRight, ArrowUpRight, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useExpenses } from "@/hooks/useExpenses";
import { useTeamCommissionTotal, type OrganizationCommissionSale } from "@/hooks/useCommercialCommissions";
import { formatCurrency } from "@/lib/format";
import { TELECOM_STATUS_COLORS, TELECOM_STATUS_LABELS, type TelecomStatus } from "@/types/sales";
import type { CommissionFilters } from "@/lib/commission-filters";

interface TelecomBalanceDetailProps {
  dateRange?: DateRange;
  commissionFilters?: CommissionFilters;
}

function includesDate(date: string, range?: DateRange): boolean {
  if (!range?.from) return true;
  const value = parseISO(date);
  return value >= startOfDay(range.from) && (!range.to || value <= endOfDay(range.to));
}

function SaleRow({ sale }: { sale: OrganizationCommissionSale }) {
  const date = sale.date
    ? sale.deferred ? format(parseISO(sale.date), "MMM yyyy", { locale: pt }) : format(parseISO(sale.date), "dd MMM yyyy", { locale: pt })
    : "—";

  return (
    <li className="flex min-w-0 items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{sale.clientName}</span>
          <Badge variant="outline" className={TELECOM_STATUS_COLORS[sale.telecomStatus as TelecomStatus]}>
            {TELECOM_STATUS_LABELS[sale.telecomStatus as TelecomStatus]}
          </Badge>
        </div>
        <p className="truncate text-xs text-muted-foreground">{sale.products.join(" · ") || "Produto não identificado"}</p>
        <p className="text-xs text-muted-foreground">{date}{sale.code ? ` · ${sale.code}` : ""}</p>
      </div>
      <span className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-emerald-700">{formatCurrency(sale.amount)}</span>
    </li>
  );
}

export function TelecomBalanceDetail({ dateRange, commissionFilters }: TelecomBalanceDetailProps) {
  const { data: teamCommission } = useTeamCommissionTotal(dateRange, commissionFilters);
  const { data: expenses = [] } = useExpenses();
  const organizationSales = teamCommission?.organizationSales ?? [];
  const expensesInPeriod = useMemo(
    () => expenses.filter((expense) => includesDate(expense.expense_date, dateRange)),
    [expenses, dateRange],
  );
  const organizationTotal = teamCommission?.orgTotal ?? 0;
  const expensesTotal = expensesInPeriod.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

  const balance = organizationTotal - expensesTotal;

  return (
    <div className="space-y-5">
      <Card className="border-primary/20 bg-primary/[0.035]">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary"><Scale className="size-5" /></span>
            <div><p className="text-sm font-medium">Saldo</p><p className="text-xs text-muted-foreground">Ganhos menos gastos no período</p></div>
          </div>
          <p className={`text-2xl font-semibold tabular-nums ${balance >= 0 ? "text-emerald-700" : "text-destructive"}`}>{formatCurrency(balance)}</p>
        </CardContent>
      </Card>

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <section className="min-w-0 overflow-hidden rounded-lg border border-emerald-200/70 bg-card">
          <header className="flex items-start justify-between gap-3 border-b bg-emerald-50/60 px-4 py-4">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-md bg-emerald-100 text-emerald-700"><ArrowUpRight className="size-5" /></span>
              <div><h3 className="font-semibold">Ganhos</h3><p className="text-xs text-muted-foreground">Valor da organização · {organizationSales.length} vendas</p></div>
            </div>
            <span className="shrink-0 text-lg font-semibold tabular-nums text-emerald-700">{formatCurrency(organizationTotal)}</span>
          </header>
          {organizationSales.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">Sem ganhos no período.</p>
          ) : (
            <ul className="divide-y">
              {organizationSales.map((sale) => <SaleRow key={sale.id} sale={sale} />)}
            </ul>
          )}
        </section>

        <section className="min-w-0 overflow-hidden rounded-lg border border-rose-200/70 bg-card">
          <header className="flex items-start justify-between gap-3 border-b bg-rose-50/50 px-4 py-4">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-md bg-rose-100 text-rose-700"><ArrowDownRight className="size-5" /></span>
              <div><h3 className="font-semibold">Gastos</h3><p className="text-xs text-muted-foreground">Despesas · {expensesInPeriod.length} registos</p></div>
            </div>
            <span className="shrink-0 text-lg font-semibold tabular-nums text-destructive">{formatCurrency(expensesTotal)}</span>
          </header>
          {expensesInPeriod.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">Sem gastos no período.</p>
          ) : (
            <ul className="divide-y">
              {expensesInPeriod.map((expense) => (
                <li key={expense.id} className="flex min-w-0 items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 space-y-1">
                    <p className="break-words text-sm font-medium">{expense.description}</p>
                    <p className="text-xs text-muted-foreground">{format(parseISO(expense.expense_date), "dd MMM yyyy", { locale: pt })} · {expense.category?.name || "Sem categoria"}</p>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-destructive">{formatCurrency(Number(expense.amount || 0))}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
