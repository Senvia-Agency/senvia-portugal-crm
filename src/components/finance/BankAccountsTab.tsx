import { useState } from 'react';
import { AlertTriangle, Eye, Landmark, Pencil, Plus, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useBankAccountBalance, useBankAccounts } from '@/hooks/useBankAccounts';
import { formatCurrency, formatIban } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { BankAccount } from '@/types/bank-accounts';
import { BankAccountStatementDrawer } from './BankAccountStatementDrawer';
import { CreateBankAccountModal } from './CreateBankAccountModal';
import { EditBankAccountModal } from './EditBankAccountModal';
import { useLanguage } from '@/i18n';

/** The organization's bank accounts, each with its balance, statement and settings. */
export function BankAccountsTab() {
  const { t } = useLanguage();
  const { data: accounts, isLoading, isError, refetch } = useBankAccounts();
  const [createOpen, setCreateOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<BankAccount | null>(null);
  const [statementAccount, setStatementAccount] = useState<BankAccount | null>(null);
  const active = accounts?.filter((account) => account.is_active).length ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">
          {t(accounts?.length === 1 ? '{{n}} conta' : '{{n}} contas', { n: accounts?.length ?? 0 })}{accounts && accounts.length !== active ? ` · ${t(active === 1 ? '{{n}} ativa' : '{{n}} ativas', { n: active })}` : ''}
        </p>
        <Button className="ml-auto h-9 rounded-full px-3" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />{t("Nova conta")}
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((key) => <Skeleton key={key} className="h-40 rounded-xl" />)}</div>
      ) : isError ? (
        // A failed load (network, RLS) is not the same as having no accounts.
        <div className="flex flex-col items-center gap-2 rounded-xl border bg-card py-12 text-center shadow-sm">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <p className="font-medium">{t("Não foi possível carregar as contas")}</p>
          <Button variant="outline" className="mt-2 rounded-full" onClick={() => refetch()}><RefreshCw className="h-4 w-4" />{t("Tentar novamente")}</Button>
        </div>
      ) : !accounts?.length ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border bg-card py-12 text-center shadow-sm">
          <Landmark className="h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium">{t("Sem contas bancárias")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("Junta a primeira conta para acompanhar o saldo e os movimentos.")}</p>
          <Button className="mt-2 rounded-full" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" />{t("Criar conta")}</Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {accounts.map((account) => (
            <BankAccountCard key={account.id} account={account} onEdit={() => setEditAccount(account)} onStatement={() => setStatementAccount(account)} />
          ))}
        </div>
      )}

      <CreateBankAccountModal open={createOpen} onOpenChange={setCreateOpen} />
      {editAccount && <EditBankAccountModal account={editAccount} open={!!editAccount} onOpenChange={(open) => !open && setEditAccount(null)} />}
      <BankAccountStatementDrawer account={statementAccount} open={!!statementAccount} onOpenChange={(open) => !open && setStatementAccount(null)} />
    </div>
  );
}

function BankAccountCard({ account, onEdit, onStatement }: { account: BankAccount; onEdit: () => void; onStatement: () => void }) {
  const { t } = useLanguage();
  const { data: balance, isLoading } = useBankAccountBalance(account.id);
  return (
    <section className={cn('flex flex-col rounded-xl border bg-card p-4 shadow-sm', !account.is_active && 'opacity-60')}>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Landmark className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate font-semibold">
            {account.name}
            {account.is_default && <span className="rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">{t("Principal")}</span>}
            {!account.is_active && <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">{t("Inativa")}</span>}
          </p>
          <p className="truncate text-xs text-muted-foreground">{[account.bank_name, account.holder_name].filter(Boolean).join(' · ') || t('Sem banco indicado')}</p>
        </div>
      </div>
      <div className="mt-4">
        <p className="text-[11px] font-medium text-muted-foreground">{t("Saldo")}</p>
        {isLoading ? <Skeleton className="mt-1 h-7 w-28" /> : (
          <p className={cn('text-2xl font-semibold tabular-nums', (balance ?? 0) < 0 && 'text-destructive')}>{formatCurrency(balance ?? 0)}</p>
        )}
        {account.iban && <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{formatIban(account.iban)}</p>}
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="outline" size="sm" className="h-8 flex-1 rounded-full" onClick={onStatement}><Eye className="h-3.5 w-3.5" />{t("Extrato")}</Button>
        <Button variant="outline" size="sm" className="h-8 flex-1 rounded-full" onClick={onEdit}><Pencil className="h-3.5 w-3.5" />{t("Editar")}</Button>
      </div>
    </section>
  );
}
