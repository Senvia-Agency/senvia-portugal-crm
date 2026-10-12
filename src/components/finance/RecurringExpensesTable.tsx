import { useMemo, useState } from 'react';
import { PauseCircle, Pencil, PlayCircle, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { EditExpenseModal } from '@/components/finance/EditExpenseModal';
import { useDeleteExpense, useExpenses, useUpdateExpense } from '@/hooks/useExpenses';
import { formatCurrency, formatDate } from '@/lib/format';
import { matchesSearch } from '@/lib/utils';
import { describeSchedule, monthlyEquivalent, storedSchedule, type RecurrenceSchedule } from '@/lib/expense-recurrence';
import type { Expense } from '@/types/expenses';

interface RecurringExpensesTableProps {
  searchTerm?: string;
  /** 'all', 'none' (no category) or a category id. */
  categoryFilter?: string;
}

/** Recurring expenses of the organization, running or paused, for the tab label. */
export function useRecurringExpenseCount(): number {
  const { data: expenses = [] } = useExpenses();
  return useMemo(() => expenses.filter((e) => storedSchedule(e)).length, [expenses]);
}

/**
 * The schedules themselves: every recurring expense, soonest next booking
 * first and the paused ones last, with edit / pause or resume / delete. No
 * date filter — a schedule set up in June still books October.
 */
export function RecurringExpensesTable({ searchTerm = '', categoryFilter = 'all' }: RecurringExpensesTableProps) {
  const { data: expenses = [], isLoading } = useExpenses();
  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();

  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [stopId, setStopId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const out: { expense: Expense; schedule: RecurrenceSchedule; paused: boolean }[] = [];
    for (const expense of expenses) {
      const schedule = storedSchedule(expense);
      if (!schedule) continue;
      if (searchTerm && !matchesSearch(searchTerm, expense.description, expense.category?.name)) continue;
      if (categoryFilter === 'none' && expense.category_id) continue;
      if (categoryFilter !== 'all' && categoryFilter !== 'none' && expense.category_id !== categoryFilter) continue;
      out.push({ expense, schedule, paused: !expense.is_recurring });
    }
    return out.sort((a, b) =>
      Number(a.paused) - Number(b.paused)
      || (a.expense.next_recurrence_date ?? '9999').localeCompare(b.expense.next_recurrence_date ?? '9999'));
  }, [expenses, searchTerm, categoryFilter]);

  const perMonth = useMemo(
    () => rows.reduce((sum, { expense, schedule, paused }) =>
      paused ? sum : sum + monthlyEquivalent(Number(expense.amount) || 0, schedule.frequency), 0),
    [rows],
  );

  const pausedCount = rows.filter((r) => r.paused).length;
  const stopping = expenses.find((e) => e.id === stopId);
  const deleting = expenses.find((e) => e.id === deleteId);

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{rows.length} recorrente(s)</span>
        {pausedCount > 0 && ` · ${pausedCount} em pausa`}
        {' · '}custo fixo ≈ <span className="font-medium text-foreground tabular-nums">{formatCurrency(perMonth)}</span>/mês
      </p>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Descrição</TableHead>
              <TableHead>Repete</TableHead>
              <TableHead>Próximo lançamento</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="w-[1%]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  Nenhuma despesa recorrente. Ao adicionar ou editar uma despesa, liga a «Recorrência».
                </TableCell>
              </TableRow>
            ) : (
              rows.map(({ expense, schedule, paused }) => (
                <TableRow key={expense.id} className={paused ? 'opacity-70' : undefined}>
                  <TableCell className="min-w-[180px]">
                    <div className="flex items-center gap-2 font-medium">
                      {expense.description}
                      {paused && <Badge variant="secondary" className="text-[10px]">Pausada</Badge>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      {expense.category && (
                        <span className="flex items-center gap-1">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: expense.category.color }} />
                          {expense.category.name}
                        </span>
                      )}
                      <span>desde {formatDate(expense.expense_date)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{describeSchedule(schedule)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {paused ? 'Em pausa' : expense.next_recurrence_date ? formatDate(expense.next_recurrence_date) : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="font-medium tabular-nums">{formatCurrency(expense.amount)}</div>
                    {schedule.frequency !== 'monthly' && (
                      <div className="text-xs text-muted-foreground tabular-nums">
                        ≈ {formatCurrency(monthlyEquivalent(Number(expense.amount) || 0, schedule.frequency))}/mês
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Editar" onClick={() => setEditExpense(expense)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {paused ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Retomar"
                          disabled={updateExpense.isPending}
                          onClick={() => updateExpense.mutate({ id: expense.id, is_recurring: true })}
                        >
                          <PlayCircle className="h-4 w-4 text-primary" />
                        </Button>
                      ) : (
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Pausar" onClick={() => setStopId(expense.id)}>
                          <PauseCircle className="h-4 w-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Eliminar" onClick={() => setDeleteId(expense.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {editExpense && (
        <EditExpenseModal
          expense={editExpense}
          open={!!editExpense}
          onOpenChange={(open) => !open && setEditExpense(null)}
        />
      )}

      <AlertDialog open={!!stopId} onOpenChange={(open) => !open && setStopId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pausar recorrência?</AlertDialogTitle>
            <AlertDialogDescription>
              {stopping
                ? `«${stopping.description}» deixa de ser lançada enquanto estiver em pausa${stopping.next_recurrence_date ? ` (a próxima seria a ${formatDate(stopping.next_recurrence_date)})` : ''}. Continua nesta lista; «Retomar» volta a lançá-la a partir do vencimento seguinte, sem os períodos em pausa.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                // Keeps the expense and its schedule; only the bookings stop.
                if (stopId) updateExpense.mutate({ id: stopId, is_recurring: false });
                setStopId(null);
              }}
            >
              Pausar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar despesa?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? `Remove a despesa de ${formatDate(deleting.expense_date)} e deixa de lançar as próximas. As despesas que a recorrência já lançou ficam. Para só deixar de lançar por agora, usa «Pausar».`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteId) deleteExpense.mutate(deleteId);
                setDeleteId(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
