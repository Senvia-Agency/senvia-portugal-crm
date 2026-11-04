import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useUpdateBankAccount } from '@/hooks/useBankAccounts';
import { parseLocalizedNumber, formatIban, cleanIban } from '@/lib/format';
import type { BankAccount } from '@/types/bank-accounts';
import { useLanguage } from '@/i18n';

interface Props {
  account: BankAccount;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditBankAccountModal({ account, open, onOpenChange }: Props) {
  const { t } = useLanguage();
  const update = useUpdateBankAccount();
  const [name, setName] = useState(account.name);
  const [bankName, setBankName] = useState(account.bank_name || '');
  const [iban, setIban] = useState(formatIban(account.iban || ''));
  const [holderName, setHolderName] = useState(account.holder_name || '');
  const [initialBalance, setInitialBalance] = useState(
    account.initial_balance.toLocaleString('pt-PT', { minimumFractionDigits: 2 })
  );
  const [isDefault, setIsDefault] = useState(account.is_default);
  const [isActive, setIsActive] = useState(account.is_active);

  useEffect(() => {
    setName(account.name);
    setBankName(account.bank_name || '');
    setIban(formatIban(account.iban || ''));
    setHolderName(account.holder_name || '');
    setInitialBalance(account.initial_balance.toLocaleString('pt-PT', { minimumFractionDigits: 2 }));
    setIsDefault(account.is_default);
    setIsActive(account.is_active);
  }, [account]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    update.mutate(
      {
        id: account.id,
        name: name.trim(),
        bank_name: bankName.trim() || null,
        iban: cleanIban(iban) || null,
        holder_name: holderName.trim() || null,
        initial_balance: parseLocalizedNumber(initialBalance),
        is_default: isDefault,
        is_active: isActive,
      },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Editar Conta Corrente")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>{t("Nome da Conta *")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t("Banco")}</Label>
              <Input value={bankName} onChange={(e) => setBankName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("Nome do Titular")}</Label>
              <Input value={holderName} onChange={(e) => setHolderName(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>IBAN</Label>
            <Input value={iban} onChange={(e) => setIban(formatIban(e.target.value))} />
          </div>
          <div className="space-y-2">
            <Label>{t("Saldo Inicial (EUR)")}</Label>
            <Input
              value={initialBalance}
              onChange={(e) => setInitialBalance(e.target.value)}
              placeholder="0,00"
              inputMode="decimal"
            />
          </div>
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <Checkbox id="edit-default" checked={isDefault} onCheckedChange={(c) => setIsDefault(c === true)} />
              <Label htmlFor="edit-default" className="cursor-pointer">{t("Conta por defeito")}</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="edit-active" checked={isActive} onCheckedChange={(c) => setIsActive(c === true)} />
              <Label htmlFor="edit-active" className="cursor-pointer">{t("Ativa")}</Label>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("Cancelar")}</Button>
            <Button type="submit" disabled={update.isPending || !name.trim()}>
              {update.isPending ? t('A guardar...') : t('Guardar')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
