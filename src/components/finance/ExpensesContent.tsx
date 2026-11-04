import { useMemo, useState } from "react";
import { endOfDay, format, parseISO, startOfDay } from "date-fns";
import type { DateRange } from "react-day-picker";
import { Pencil, Plus, Receipt, RefreshCw, Tags, Trash2 } from "lucide-react";

import { AddExpenseModal } from "@/components/finance/AddExpenseModal";
import { EditExpenseModal } from "@/components/finance/EditExpenseModal";
import { RecurringExpensesTable, useRecurringExpenseCount } from "@/components/finance/RecurringExpensesTable";
import { ExportMenu, type ExportKind } from "@/components/shared/ExportMenu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
import { useDeleteExpense, useExpenses } from "@/hooks/useExpenses";
import { usePersistedState } from "@/hooks/usePersistedState";
import { describeSchedule, scheduleOf } from "@/lib/expense-recurrence";
import { exportToCsv, exportToExcel } from "@/lib/export";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn, matchesSearch } from "@/lib/utils";
import type { Expense } from "@/types/expenses";
import { useLanguage } from "@/i18n";

interface ExpensesContentProps {
  /** Typed in the finance page's filter line. */
  readonly search: string;
  readonly dateRange?: DateRange;
}

const NO_CATEGORY_COLOR = "#94a3b8";

/** What the organization spends: every expense, where the money goes, and the ones that repeat. */
export function ExpensesContent({ search, dateRange }: ExpensesContentProps) {
  const { t } = useLanguage();
  const { data: expenses, isLoading } = useExpenses();
  const { data: categories } = useExpenseCategories();
  const deleteExpense = useDeleteExpense();
  const recurringCount = useRecurringExpenseCount();
  const [view, setView] = usePersistedState<"all" | "recurring">("expenses-view-v1", "all");
  const [categoryFilter, setCategoryFilter] = usePersistedState("expenses-category-v1", "all");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);

  const inRangeAndSearch = useMemo(() => (expenses ?? []).filter((expense) => {
    if (search.trim() && !matchesSearch(search, expense.description, expense.category?.name)) return false;
    if (dateRange?.from) {
      const day = parseISO(expense.expense_date);
      if (day < startOfDay(dateRange.from)) return false;
      if (dateRange.to && day > endOfDay(dateRange.to)) return false;
    }
    return true;
  }), [expenses, search, dateRange]);

  const rows = useMemo(() => inRangeAndSearch.filter((expense) =>
    categoryFilter === "all" ? true
      : categoryFilter === "none" ? !expense.category_id
        : expense.category_id === categoryFilter), [inRangeAndSearch, categoryFilter]);

  const total = rows.reduce((sum, expense) => sum + Number(expense.amount), 0);

  // Where the money goes in this period (before the category filter, so the bar keeps every slice).
  const byCategory = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; color: string; amount: number }>();
    for (const expense of inRangeAndSearch) {
      const key = expense.category_id ?? "none";
      const current = groups.get(key) ?? { key, name: expense.category?.name ?? t("Sem categoria"), color: expense.category?.color ?? NO_CATEGORY_COLOR, amount: 0 };
      current.amount += Number(expense.amount);
      groups.set(key, current);
    }
    return [...groups.values()].sort((a, b) => b.amount - a.amount);
  }, [inRangeAndSearch, t]);
  const categoryTotal = byCategory.reduce((sum, group) => sum + group.amount, 0);

  const handleExport = (kind: ExportKind) => {
    const data = rows.map((expense) => ({
      [t("Data")]: formatDate(expense.expense_date),
      [t("Descrição")]: expense.description,
      [t("Categoria")]: expense.category?.name ?? "",
      [t("Recorrente")]: expense.is_recurring ? t("Sim") : t("Não"),
      [t("Valor")]: Number(expense.amount),
      [t("Notas")]: expense.notes ?? "",
    }));
    const name = `despesas_${format(new Date(), "yyyy-MM-dd")}`;
    if (kind === "excel") exportToExcel(data, name); else exportToCsv(data, name);
  };

  return (
    <div className="space-y-3">
      {/* Which expenses, how much they add up to, and what can be done here. */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t("Despesas a mostrar")} className="flex items-center gap-0.5 rounded-full border border-border bg-card p-1 shadow-sm">
          {([["all", t("Todas"), null], ["recurring", t("Recorrentes"), recurringCount]] as const).map(([key, label, count]) => (
            <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}
              className={cn("flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                view === key ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/30" : "text-foreground/75 hover:bg-muted")}>
              {key === "recurring" && <RefreshCw className="h-3.5 w-3.5" />}{label}
              {count !== null && <span className="rounded-full bg-muted px-1.5 text-[10px] leading-4 tabular-nums text-muted-foreground">{count}</span>}
            </button>
          ))}
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className={cn("h-9 w-auto gap-1.5 rounded-full px-3 text-[13px]", categoryFilter !== "all" && "border-primary/40 bg-primary/5 text-primary")}>
            <Tags className="h-3.5 w-3.5" /><SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Todas as categorias")}</SelectItem>
            <SelectItem value="none">{t("Sem categoria")}</SelectItem>
            {categories?.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: category.color }} />{category.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {view === "all" && (
          <p className="text-sm text-muted-foreground">
            {t(rows.length === 1 ? "{{n}} despesa" : "{{n}} despesas", { n: rows.length })} · <strong className="tabular-nums text-foreground">{formatCurrency(total)}</strong>
          </p>
        )}
        <div className="ml-auto flex items-center gap-2">
          {view === "all" && <ExportMenu count={rows.length} noun="despesas" onExport={handleExport} />}
          <Button className="h-9 rounded-full px-3" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /><span className="hidden sm:inline">{t("Nova despesa")}</span>
          </Button>
        </div>
      </div>

      {view === "all" && byCategory.length > 0 && categoryTotal > 0 && (
        // Where the money goes: one bar, each category its share; a click filters by it.
        <section className="rounded-xl border bg-card p-4 shadow-sm" aria-label={t("Despesas por categoria")}>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
            {byCategory.map((group) => (
              <span key={group.key} style={{ width: `${(group.amount / categoryTotal) * 100}%`, backgroundColor: group.color }} title={group.name} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {byCategory.slice(0, 8).map((group) => (
              <button key={group.key} type="button" onClick={() => setCategoryFilter(categoryFilter === group.key ? "all" : group.key)}
                className={cn("flex items-center gap-1.5 rounded-full text-xs transition-opacity",
                  categoryFilter !== "all" && categoryFilter !== group.key && "opacity-40")}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: group.color }} />
                <span className="font-medium">{group.name}</span>
                <span className="tabular-nums text-muted-foreground">{formatCurrency(group.amount)} · {Math.round((group.amount / categoryTotal) * 100)}%</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {view === "recurring" ? (
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <RecurringExpensesTable searchTerm={search} categoryFilter={categoryFilter} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          {isLoading ? (
            <div className="space-y-3 p-4">{[0, 1, 2].map((key) => <Skeleton key={key} className="h-10 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
              <Receipt className="h-10 w-10 text-muted-foreground/40" />{t("Nenhuma despesa encontrada.")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="hidden w-28 sm:table-cell">{t("Data")}</TableHead>
                  <TableHead>{t("Descrição")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("Categoria")}</TableHead>
                  <TableHead className="text-right">{t("Valor")}</TableHead>
                  <TableHead className="w-12 sm:w-24"><span className="sr-only">{t("Ações")}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((expense) => {
                  const schedule = scheduleOf(expense);
                  return (
                    <TableRow key={expense.id} className="cursor-pointer" onClick={() => setEditing(expense)}>
                      <TableCell className="hidden whitespace-nowrap tabular-nums sm:table-cell">{formatDate(expense.expense_date)}</TableCell>
                      <TableCell>
                        {/* On a phone the date moves under the description, so the amount keeps its room. */}
                        <p className="text-xs tabular-nums text-muted-foreground sm:hidden">{formatDate(expense.expense_date)}</p>
                        <p className="flex max-w-[9rem] items-center gap-1.5 truncate font-medium sm:max-w-[22rem]">
                          {expense.description}
                          {expense.is_recurring && <RefreshCw className="h-3 w-3 shrink-0 text-muted-foreground" aria-label={t("Recorrente")} />}
                        </p>
                        {schedule && (
                          <p className="truncate text-xs text-muted-foreground">
                            {describeSchedule(schedule)}{expense.next_recurrence_date && ` · ${t("próxima {{date}}", { date: formatDate(expense.next_recurrence_date) })}`}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {expense.category ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
                            style={{ backgroundColor: `${expense.category.color}1f`, color: expense.category.color }}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: expense.category.color }} />{expense.category.name}
                          </span>
                        ) : <span className="text-xs text-muted-foreground">{t("Sem categoria")}</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums text-rose-600 dark:text-rose-400">−{formatCurrency(expense.amount)}</TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <div className="flex justify-end gap-0.5">
                          <Button variant="ghost" size="icon" className="hidden h-8 w-8 sm:inline-flex" title={t("Editar")} aria-label={t("Editar {{name}}", { name: expense.description })} onClick={() => setEditing(expense)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" title={t("Eliminar")} aria-label={t("Eliminar {{name}}", { name: expense.description })} onClick={() => setDeleting(expense)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      <AddExpenseModal open={addOpen} onOpenChange={setAddOpen} />
      {editing && <EditExpenseModal expense={editing} open={!!editing} onOpenChange={(open) => !open && setEditing(null)} />}

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent variant="fullScreen" className="flex flex-col gap-0 p-0">
          <DialogHeader className="border-b px-4 py-4 md:px-6">
            <DialogTitle>{t("Eliminar despesa")}</DialogTitle>
            <DialogDescription>
              {deleting?.is_recurring
                ? t("Remove esta despesa e deixa de lançar as próximas. As que a recorrência já lançou ficam. Para só deixar de lançar, usa «Parar recorrência» em Recorrentes.")
                : t("A despesa é removida de vez e não pode ser recuperada.")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6">
            {deleting && (
              <div className="mx-auto grid max-w-xl grid-cols-2 gap-3 rounded-xl border bg-card p-4 text-sm shadow-sm">
                <div className="col-span-2"><p className="text-xs text-muted-foreground">{t("Descrição")}</p><p className="font-medium">{deleting.description}</p></div>
                <div><p className="text-xs text-muted-foreground">{t("Data")}</p><p className="font-medium">{formatDate(deleting.expense_date)}</p></div>
                <div><p className="text-xs text-muted-foreground">{t("Valor")}</p><p className="text-lg font-semibold tabular-nums text-rose-600">−{formatCurrency(deleting.amount)}</p></div>
              </div>
            )}
          </div>
          <DialogFooter className="border-t px-4 py-4 md:px-6">
            <Button variant="outline" onClick={() => setDeleting(null)}>{t("Cancelar")}</Button>
            <Button variant="destructive" onClick={() => { if (deleting) deleteExpense.mutate(deleting.id); setDeleting(null); }}>
              <Trash2 className="h-4 w-4" />{t("Eliminar despesa")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
