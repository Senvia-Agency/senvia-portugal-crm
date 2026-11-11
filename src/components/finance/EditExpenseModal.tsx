import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Pencil, Repeat } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useLanguage, dateLocale } from '@/i18n';
import { useExpenses, useUpdateExpense } from '@/hooks/useExpenses';
import { useExpenseCategories } from '@/hooks/useExpenseCategories';
import { BankAccountSelect } from '@/components/finance/BankAccountSelect';
import { ExpenseRecurrenceFields } from '@/components/finance/ExpenseRecurrenceFields';
import { defaultSchedule, describeSchedule, pausedScheduleOf, recurrenceOrigin, storedSchedule, type RecurrenceSchedule } from '@/lib/expense-recurrence';
import { formatCurrency } from '@/lib/format';
import type { Expense } from '@/types/expenses';

interface EditExpenseModalProps {
  expense: Expense;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the recurrence this booked copy came from. */
  onEditOrigin?: (origin: Expense) => void;
}

// A paused expense resumes with the schedule it had.
function initialSchedule(expense: Expense): RecurrenceSchedule {
  return storedSchedule(expense) ?? defaultSchedule(parseISO(expense.expense_date));
}

export function EditExpenseModal({ expense, open, onOpenChange, onEditOrigin }: EditExpenseModalProps) {
  const { t } = useLanguage();
  const updateExpense = useUpdateExpense();
  const { data: categories } = useExpenseCategories();
  const { data: allExpenses = [] } = useExpenses();
  // A booked copy has no schedule of its own: the recurrence it came from is another row.
  const origin = recurrenceOrigin(expense, allExpenses);

  const [description, setDescription] = useState(expense.description);
  const [amount, setAmount] = useState(expense.amount.toString());
  const [categoryId, setCategoryId] = useState(expense.category_id || '');
  const [date, setDate] = useState<Date>(parseISO(expense.expense_date));
  const [isRecurring, setIsRecurring] = useState(expense.is_recurring);
  const [schedule, setSchedule] = useState<RecurrenceSchedule>(() => initialSchedule(expense));
  // A schedule already saved stays as it is; a new one follows the date
  // until its due day is picked by hand.
  const [scheduleTouched, setScheduleTouched] = useState(!!storedSchedule(expense));
  const paused = pausedScheduleOf(expense);
  // Paused and left off: stays paused unless "Remover a recorrência".
  const [forgetPaused, setForgetPaused] = useState(false);
  const [notes, setNotes] = useState(expense.notes || '');
  const [bankAccountId, setBankAccountId] = useState((expense as any).bank_account_id || '');

  useEffect(() => {
    setDescription(expense.description);
    setAmount(expense.amount.toString());
    setCategoryId(expense.category_id || '');
    setDate(parseISO(expense.expense_date));
    setIsRecurring(expense.is_recurring);
    setSchedule(initialSchedule(expense));
    setScheduleTouched(!!storedSchedule(expense));
    setForgetPaused(false);
    setNotes(expense.notes || '');
    setBankAccountId((expense as any).bank_account_id || '');
  }, [expense]);

  const changeDate = (next: Date) => {
    setDate(next);
    if (!scheduleTouched) setSchedule(defaultSchedule(next, schedule.frequency));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const numericAmount = parseFloat(amount.replace(',', '.'));
    if (!description.trim() || isNaN(numericAmount) || numericAmount <= 0) return;

    updateExpense.mutate(
      {
        id: expense.id,
        description: description.trim(),
        amount: numericAmount,
        category_id: categoryId && categoryId !== 'none' ? categoryId : null,
        expense_date: format(date, 'yyyy-MM-dd'),
        is_recurring: isRecurring,
        // On: this schedule. Off: a paused one keeps its schedule (undefined
        // leaves it alone) unless removed; anything else has none.
        recurrence: isRecurring ? schedule : paused && !forgetPaused ? undefined : null,
        notes: notes.trim() || null,
        bank_account_id: bankAccountId && bankAccountId !== 'none' ? bankAccountId : null,
      },
      {
        onSuccess: () => onOpenChange(false),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="flex flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-14 sm:px-6">
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5 text-primary" />
            {t("Editar Despesa")}
          </DialogTitle>
          <DialogDescription>{expense.description}</DialogDescription>
        </DialogHeader>

        <form id="edit-expense-form" onSubmit={handleSubmit} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="mx-auto grid max-w-5xl items-start gap-6 lg:grid-cols-2">
            <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground">{t("Despesa")}</h3>

              <div className="space-y-2">
                <Label htmlFor="edit-exp-desc">{t("Descrição *")}</Label>
                <Input
                  id="edit-exp-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("Ex: Renda do escritório")}
                  required
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-exp-cat">{t("Categoria")}</Label>
                  <Select value={categoryId} onValueChange={setCategoryId}>
                    <SelectTrigger id="edit-exp-cat">
                      <SelectValue placeholder={t("Selecionar...")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("Sem categoria")}</SelectItem>
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
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-exp-amount">{t("Valor (€) *")}</Label>
                  <Input
                    id="edit-exp-amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0,00"
                    inputMode="decimal"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("Data *")}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start sm:w-1/2">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(date, 'dd/MM/yyyy', { locale: dateLocale() })}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={date}
                      onSelect={(d) => d && changeDate(d)}
                      locale={dateLocale()}
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <BankAccountSelect value={bankAccountId} onChange={setBankAccountId} />

              <div className="space-y-2">
                <Label htmlFor="edit-exp-notes">{t("Notas")}</Label>
                <Textarea
                  id="edit-exp-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t("Notas adicionais...")}
                  rows={3}
                />
              </div>
            </section>

            <div className="space-y-4">
            {origin ? (
              <section className="space-y-3 rounded-2xl border border-border bg-card p-5" aria-labelledby="edit-exp-origin">
                <h3 id="edit-exp-origin" className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Repeat className="h-4 w-4 text-primary" aria-hidden="true" />
                  {origin.is_recurring ? t("Recorrente, ativa") : t("Recorrente, em pausa")}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t("Este é o lançamento do mês. A recorrência é gerida na despesa original, para não ficarem duas a lançar.")}
                </p>
                <p className="text-sm text-foreground">
                  {formatCurrency(origin.amount)} · {describeSchedule(storedSchedule(origin)!)}
                  {origin.is_recurring && origin.next_recurrence_date
                    ? ` · ${t("próximo")} ${format(parseISO(origin.next_recurrence_date), 'dd/MM/yyyy', { locale: dateLocale() })}`
                    : ''}
                </p>
                {onEditOrigin && (
                  <Button type="button" variant="outline" onClick={() => onEditOrigin(origin)}>
                    {t("Editar a recorrência")}
                  </Button>
                )}
              </section>
            ) : (
            <ExpenseRecurrenceFields
              enabled={isRecurring}
              onEnabledChange={setIsRecurring}
              schedule={schedule}
              onScheduleChange={(next) => {
                setSchedule(next);
                const fromDate = defaultSchedule(date, next.frequency);
                setScheduleTouched(next.day !== fromDate.day || next.month !== fromDate.month);
              }}
              date={date}
              nextScheduled={expense.is_recurring ? expense.next_recurrence_date : null}
              paused={paused}
              forget={forgetPaused}
              onForgetChange={setForgetPaused}
            />
            )}
            </div>
          </div>
        </form>

        <div className="flex shrink-0 justify-end gap-2 border-t px-4 py-3 sm:px-6">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancelar")}
          </Button>
          <Button type="submit" form="edit-expense-form" disabled={updateExpense.isPending || !description.trim() || !amount}>
            {updateExpense.isPending ? t('A guardar...') : t('Guardar')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
