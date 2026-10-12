import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Receipt } from 'lucide-react';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { useCreateExpense } from '@/hooks/useExpenses';
import { useExpenseCategories } from '@/hooks/useExpenseCategories';
import { BankAccountSelect } from '@/components/finance/BankAccountSelect';
import { ExpenseRecurrenceFields } from '@/components/finance/ExpenseRecurrenceFields';
import { defaultSchedule, type RecurrenceSchedule } from '@/lib/expense-recurrence';

interface AddExpenseModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddExpenseModal({ open, onOpenChange }: AddExpenseModalProps) {
  const createExpense = useCreateExpense();
  const { data: categories } = useExpenseCategories();

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [date, setDate] = useState<Date>(new Date());
  const [isRecurring, setIsRecurring] = useState(false);
  const [schedule, setSchedule] = useState<RecurrenceSchedule>(() => defaultSchedule(new Date()));
  // Until the due day is picked by hand, it follows the expense's date.
  const [scheduleTouched, setScheduleTouched] = useState(false);
  const [notes, setNotes] = useState('');
  const [bankAccountId, setBankAccountId] = useState<string>('');

  const changeDate = (next: Date) => {
    setDate(next);
    if (!scheduleTouched) setSchedule(defaultSchedule(next, schedule.frequency));
  };

  const reset = () => {
    setDescription('');
    setAmount('');
    setCategoryId('');
    setDate(new Date());
    setIsRecurring(false);
    setSchedule(defaultSchedule(new Date()));
    setScheduleTouched(false);
    setNotes('');
    setBankAccountId('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const numericAmount = parseFloat(amount.replace(',', '.'));
    if (!description.trim() || isNaN(numericAmount) || numericAmount <= 0) return;

    createExpense.mutate(
      {
        description: description.trim(),
        amount: numericAmount,
        category_id: categoryId && categoryId !== 'none' ? categoryId : null,
        expense_date: format(date, 'yyyy-MM-dd'),
        is_recurring: isRecurring,
        recurrence: isRecurring ? schedule : null,
        notes: notes.trim() || null,
        bank_account_id: bankAccountId && bankAccountId !== 'none' ? bankAccountId : null,
      },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="flex flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-14 sm:px-6">
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            Adicionar Despesa
          </DialogTitle>
          <DialogDescription>
            Regista um custo. Se for recorrente, o Senvia lança-o sozinho em cada vencimento.
          </DialogDescription>
        </DialogHeader>

        <form id="add-expense-form" onSubmit={handleSubmit} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="mx-auto grid max-w-5xl items-start gap-6 lg:grid-cols-2">
            <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground">Despesa</h3>

              <div className="space-y-2">
                <Label htmlFor="exp-desc">Descrição *</Label>
                <Input
                  id="exp-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex: Renda do escritório"
                  required
                  autoFocus
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="exp-cat">Categoria</Label>
                  <Select value={categoryId} onValueChange={setCategoryId}>
                    <SelectTrigger id="exp-cat">
                      <SelectValue placeholder="Selecionar..." />
                    </SelectTrigger>
                    <SelectContent>
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
                </div>

                <div className="space-y-2">
                  <Label htmlFor="exp-amount">Valor (€) *</Label>
                  <Input
                    id="exp-amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0,00"
                    inputMode="decimal"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Data *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start sm:w-1/2">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(date, 'dd/MM/yyyy', { locale: pt })}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={date}
                      onSelect={(d) => d && changeDate(d)}
                      locale={pt}
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <BankAccountSelect value={bankAccountId} onChange={setBankAccountId} />

              <div className="space-y-2">
                <Label htmlFor="exp-notes">Notas</Label>
                <Textarea
                  id="exp-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notas adicionais..."
                  rows={3}
                />
              </div>
            </section>

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
            />
          </div>
        </form>

        <div className="flex shrink-0 justify-end gap-2 border-t px-4 py-3 sm:px-6">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="add-expense-form" disabled={createExpense.isPending || !description.trim() || !amount}>
            {createExpense.isPending ? 'A guardar...' : 'Guardar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
