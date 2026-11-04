import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useActiveBankAccounts, useCreateBankTransaction } from '@/hooks/useBankAccounts';
import { parseLocalizedNumber } from '@/lib/format';
import { format } from 'date-fns';
import { Landmark } from 'lucide-react';
import { useLanguage } from '@/i18n';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddRevenueModal({ open, onOpenChange }: Props) {
  const { t } = useLanguage();
  const { data: accounts } = useActiveBankAccounts();
  const createTransaction = useCreateBankTransaction();

  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [description, setDescription] = useState('');

  const resetForm = () => {
    setAccountId('');
    setAmount('');
    setDate(format(new Date(), 'yyyy-MM-dd'));
    setDescription('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseLocalizedNumber(amount);
    if (!accountId || parsedAmount <= 0 || !description.trim()) return;

    createTransaction.mutate(
      {
        bank_account_id: accountId,
        amount: parsedAmount,
        description: description.trim(),
        transaction_date: date,
      },
      {
        onSuccess: () => {
          resetForm();
          onOpenChange(false);
        },
      }
    );
  };

  const parsedAmount = parseLocalizedNumber(amount);
  const isValid = accountId && parsedAmount > 0 && description.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="md:inset-auto md:left-[50%] md:top-[50%] md:translate-x-[-50%] md:translate-y-[-50%] md:max-w-lg md:h-auto md:max-h-[90dvh] md:rounded-lg md:border md:p-6">
        <DialogHeader>
          <DialogTitle>{t("Adicionar Receita")}</DialogTitle>
          <DialogDescription>
            {t("Registar uma entrada manual (juros, transferências, etc.)")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Landmark className="h-4 w-4 text-muted-foreground" />
              {t("Conta Corrente")}
            </Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder={t("Selecionar conta...")} />
              </SelectTrigger>
              <SelectContent>
                {accounts?.map((acc) => (
                  <SelectItem key={acc.id} value={acc.id}>
                    {acc.name}{acc.bank_name ? ` (${acc.bank_name})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t("Valor (€)")}</Label>
            <Input
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("Data")}</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("Descrição")}</Label>
            <Input
              type="text"
              placeholder={t("Ex: Juros creditados, Transferência recebida...")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2 pt-4">
            <Button type="submit" disabled={!isValid || createTransaction.isPending}>
              {createTransaction.isPending ? t('A registar...') : t('Registar Receita')}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("Cancelar")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
