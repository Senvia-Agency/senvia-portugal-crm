import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useBankAccountTransactions, useBankAccountBalance } from '@/hooks/useBankAccounts';
import { formatCurrency, formatDate } from '@/lib/format';
import { TRANSACTION_TYPE_LABELS } from '@/types/bank-accounts';
import type { BankAccount, BankTransactionType } from '@/types/bank-accounts';
import { ArrowDownLeft, ArrowUpRight, Landmark, Printer, Settings2 } from 'lucide-react';
import { useLanguage } from '@/i18n';

interface Props {
  account: BankAccount | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const typeIcon: Record<BankTransactionType, React.ReactNode> = {
  initial_balance: <Landmark className="h-4 w-4 text-primary" />,
  payment_in: <ArrowDownLeft className="h-4 w-4 text-emerald-500" />,
  expense_out: <ArrowUpRight className="h-4 w-4 text-destructive" />,
  adjustment: <Settings2 className="h-4 w-4 text-muted-foreground" />,
};

export function BankAccountStatementDrawer({ account, open, onOpenChange }: Props) {
  const { t } = useLanguage();
  const { data: transactions, isLoading } = useBankAccountTransactions(account?.id || null);
  const { data: balance } = useBankAccountBalance(account?.id || null);

  if (!account) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="flex flex-row items-center justify-between pr-8">
          <div>
            <SheetTitle className="text-left">{account.name}</SheetTitle>
            {account.bank_name && (
              <p className="text-sm text-muted-foreground">{account.bank_name}</p>
            )}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => { const t = document.title; document.title = "Senvia OS"; window.print(); document.title = t; }} className="print:hidden">
            <Printer className="h-4 w-4" />
          </Button>
        </SheetHeader>

        <div id="bank-statement-print">
          <div className="mt-4 p-4 rounded-lg bg-muted/50 border print:bg-transparent print:border-border">
            <p className="text-sm text-muted-foreground">{t("Saldo Atual")}</p>
            <p className={`text-2xl font-bold ${(balance ?? 0) >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
              {formatCurrency(balance ?? 0)}
            </p>
          </div>

          <div className="mt-6 space-y-1">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">{t("Extrato")}</h3>
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
          ) : !transactions?.length ? (
            <p className="text-sm text-muted-foreground py-8 text-center">{t("Sem movimentos")}</p>
          ) : (
            transactions.map((tx) => {
              const isPositive = tx.amount >= 0;
              return (
                <div key={tx.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="flex-shrink-0">
                    {typeIcon[tx.type as BankTransactionType] || typeIcon.adjustment}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{tx.description || t(TRANSACTION_TYPE_LABELS[tx.type as BankTransactionType])}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(tx.transaction_date)}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-sm font-semibold ${isPositive ? 'text-emerald-600' : 'text-destructive'}`}>
                      {isPositive ? '+' : ''}{formatCurrency(tx.amount)}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatCurrency(tx.running_balance)}</p>
                  </div>
                </div>
              );
            })
          )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
