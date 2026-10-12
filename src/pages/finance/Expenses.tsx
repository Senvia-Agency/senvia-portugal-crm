import { useState, useMemo, useEffect } from 'react';
import { usePersistedState } from "@/hooks/usePersistedState";
import { matchesSearch } from "@/lib/utils";

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Plus, Search, X, Pencil, Trash2, ArrowLeft, Download, RefreshCw, Receipt } from 'lucide-react';
import { useExpenses, useDeleteExpense } from '@/hooks/useExpenses';
import { useExpenseCategories } from '@/hooks/useExpenseCategories';
import { AddExpenseModal } from '@/components/finance/AddExpenseModal';
import { EditExpenseModal } from '@/components/finance/EditExpenseModal';
import { formatCurrency, formatDate } from '@/lib/format';
import { describeSchedule, scheduleOf } from '@/lib/expense-recurrence';
import { RecurringExpensesTable, useRecurringExpenseCount } from '@/components/finance/RecurringExpensesTable';
import { cn } from '@/lib/utils';
import { parseISO, startOfDay, endOfDay } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Expense } from '@/types/expenses';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function Expenses() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: expenses, isLoading } = useExpenses();
  const { data: categories } = useExpenseCategories();
  const deleteExpense = useDeleteExpense();

  const [showAdd, setShowAdd] = useState(false);
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // "all" = every expense booked; "recurring" = the schedules themselves.
  const [view, setView] = usePersistedState<'all' | 'recurring'>('expenses-view-v1', 'all');

  // Filters
  const [search, setSearch] = usePersistedState('expenses-search-v1', '');
  const [dateRange, setDateRange] = usePersistedState<DateRange | undefined>('expenses-daterange-v1', undefined);
  const [categoryFilter, setCategoryFilter] = usePersistedState('expenses-category-v1', 'all');

  // Read date range from URL on mount
  useEffect(() => {
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    if (fromParam) {
      setDateRange({
        from: parseISO(fromParam),
        to: toParam ? parseISO(toParam) : undefined,
      });
    }
  }, [searchParams]);

  const filteredExpenses = useMemo(() => {
    if (!expenses) return [];
    
    return expenses.filter((expense) => {
      // Search
      if (search) {
        if (!matchesSearch(search, expense.description, expense.category?.name)) return false;
      }

      // Date range
      if (dateRange?.from) {
        const date = parseISO(expense.expense_date);
        if (date < startOfDay(dateRange.from)) return false;
        if (dateRange.to && date > endOfDay(dateRange.to)) return false;
      }

      // Category
      if (categoryFilter !== 'all') {
        if (categoryFilter === 'none' && expense.category_id) return false;
        if (categoryFilter !== 'none' && expense.category_id !== categoryFilter) return false;
      }

      return true;
    });
  }, [expenses, search, dateRange, categoryFilter]);

  const totalInPeriod = useMemo(() => {
    return filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
  }, [filteredExpenses]);

  const recurringCount = useRecurringExpenseCount();

  const deleting = expenses?.find((e) => e.id === deleteId);

  const hasFilters = search || dateRange?.from || categoryFilter !== 'all';

  const clearFilters = () => {
    setSearch('');
    setDateRange(undefined);
    setCategoryFilter('all');
  };

  const handleDelete = () => {
    if (deleteId) {
      deleteExpense.mutate(deleteId);
      setDeleteId(null);
    }
  };


  return (
    <>
      <div className="p-4 md:p-6 lg:p-8 space-y-6 pb-20 md:pb-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/financeiro')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <Receipt className="h-5 w-5 shrink-0 text-primary" />
                Despesas
              </h1>
              <p className="text-sm text-muted-foreground">Gerir custos e despesas</p>
            </div>
          </div>
          <Button onClick={() => setShowAdd(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Adicionar Despesa
          </Button>
        </div>

        {/* View */}
        <div className="inline-flex rounded-lg border border-border bg-card p-1">
          {([
            ['all', 'Todas as despesas'],
            ['recurring', `Recorrentes (${recurringCount})`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                view === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {key === 'recurring' && <RefreshCw className="h-3.5 w-3.5" />}
              {label}
            </button>
          ))}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
              <div className="relative flex-1 min-w-0 sm:min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Pesquisar..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              {view === 'all' && (
                <DateRangePicker
                  value={dateRange}
                  onChange={setDateRange}
                  placeholder="Período"
                  className="w-full sm:w-auto"
                />
              )}

              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Categoria" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas categorias</SelectItem>
                  <SelectItem value="none">Sem categoria</SelectItem>
                  {categories?.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full" style={{ backgroundColor: cat.color }} />
                        {cat.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
                  <X className="h-4 w-4" />
                  Limpar
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        {view === 'all' ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              {filteredExpenses.length} despesa(s) · Total: {formatCurrency(totalInPeriod)}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 md:p-6 md:pt-0">
            {isLoading ? (
              <div className="space-y-3 p-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : filteredExpenses.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>Nenhuma despesa encontrada.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead className="w-[80px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredExpenses.map((expense) => {
                      const schedule = scheduleOf(expense);
                      return (
                      <TableRow key={expense.id}>
                        <TableCell className="whitespace-nowrap">
                          {formatDate(expense.expense_date)}
                          {expense.is_recurring && (
                            <RefreshCw className="inline ml-1 h-3 w-3 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell className="max-w-[260px]">
                          <div className="truncate">{expense.description}</div>
                          {schedule && (
                            <div className="truncate text-xs text-muted-foreground">
                              {describeSchedule(schedule)}
                              {expense.next_recurrence_date && ` · próximo ${formatDate(expense.next_recurrence_date)}`}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {expense.category ? (
                            <Badge
                              variant="secondary"
                              style={{ backgroundColor: `${expense.category.color}20`, color: expense.category.color }}
                            >
                              {expense.category.name}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">--</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium text-destructive">
                          -{formatCurrency(expense.amount)}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => setEditExpense(expense)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setDeleteId(expense.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        ) : (
        <Card>
          <CardContent className="pt-6">
            <RecurringExpensesTable searchTerm={search} categoryFilter={categoryFilter} />
          </CardContent>
        </Card>
        )}
      </div>

      <AddExpenseModal open={showAdd} onOpenChange={setShowAdd} />

      {editExpense && (
        <EditExpenseModal
          expense={editExpense}
          open={!!editExpense}
          onOpenChange={(open) => !open && setEditExpense(null)}
        />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar despesa?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.is_recurring
                ? `Remove a despesa de ${formatDate(deleting.expense_date)} e deixa de lançar as próximas. As despesas que a recorrência já lançou ficam. Para só deixar de lançar, usa «Parar recorrência».`
                : 'Esta ação é irreversível. A despesa será permanentemente removida.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
