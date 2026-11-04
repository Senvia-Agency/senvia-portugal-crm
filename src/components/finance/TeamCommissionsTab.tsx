import { useMemo, useState } from 'react';
import { format, subMonths, startOfMonth } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import type { CommissionFilters } from '@/lib/commission-filters';
import { useLanguage, dateLocale } from '@/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronDown, ChevronRight, FileX, Search, Wallet, RefreshCw, Check } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/format';
import { cn, matchesSearch } from '@/lib/utils';
import { useTeamFilter } from '@/hooks/useTeamFilter';
import { TeamMemberFilter } from '@/components/dashboard/TeamMemberFilter';
import { BankAccountSelect } from '@/components/finance/BankAccountSelect';
import {
  useCommercialCommissions, usePayCommercialCommissions, useMarkCommissionPaid, type CommercialCommission,
} from '@/hooks/useCommercialCommissions';

function generateMonthOptions() {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = startOfMonth(subMonths(now, i));
    options.push({
      value: format(d, 'yyyy-MM-dd'),
      label: format(d, 'MMMM yyyy', { locale: dateLocale() }),
    });
  }
  return options;
}

export function TeamCommissionsTab({ financeOptions, search }: {
  financeOptions?: { dateRange?: DateRange; commissionFilters?: CommissionFilters };
  /** Typed in the page's own filter line; the tab then hides its search box. */
  search?: string;
} = {}) {
  const { t, language } = useLanguage();
  const { effectiveUserIds, canFilterByTeam } = useTeamFilter();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const monthOptions = useMemo(() => generateMonthOptions(), [language]);
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0]?.value);
  const [searchTerm, setSearchTerm] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [payTarget, setPayTarget] = useState<CommercialCommission | null>(null);
  const [bankAccount, setBankAccount] = useState('none');
  // Which pending commissions are ticked for payment (keyed by `${kind}-${id}`).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // In the finance page the seller comes from its own filters, so the team filter stays out.
  const { data, isLoading } = useCommercialCommissions(selectedMonth, financeOptions ? null : effectiveUserIds, financeOptions);
  const payMutation = usePayCommercialCommissions();
  const markPaidMutation = useMarkCommissionPaid();

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const commercials = data?.commercials || [];
  const total = data?.total || 0;
  const totalPending = data?.totalPending || 0;
  const filtered = commercials.filter(c => matchesSearch(search ?? searchTerm, c.name));

  const itemKey = (item: { kind: string; id: string }) => `${item.kind}-${item.id}`;

  const openPay = (entry: CommercialCommission) => {
    setBankAccount('none');
    setPayTarget(entry);
    // Default: every pending commission ticked — user can untick the ones to skip.
    setSelectedIds(new Set(entry.items.filter(i => !i.paid).map(itemKey)));
  };

  // Pending commissions for the open target, and the subset ticked for payment.
  const pendingItems = payTarget ? payTarget.items.filter(i => !i.paid) : [];
  const selectedItems = pendingItems.filter(i => selectedIds.has(itemKey(i)));
  const selectedTotal = selectedItems.reduce((s, i) => s + i.amount, 0);

  const toggleSelected = (key: string, on: boolean) => {
    if (pendingItems.some(item => itemKey(item) === key && item.kind === 'chargeback')) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      on ? next.add(key) : next.delete(key);
      return next;
    });
  };

  const confirmPay = () => {
    if (!payTarget || selectedItems.length === 0 || selectedTotal < 0) return;
    payMutation.mutate(
      {
        fullName: payTarget.name,
        bankAccountId: bankAccount === 'none' ? null : bankAccount,
        saleIds: selectedItems.filter(i => i.kind === 'direct').map(i => i.id),
        recordIds: selectedItems.filter(i => i.kind === 'recurring').map(i => i.id),
        organizationSaleIds: selectedItems
          .filter(i => i.kind === 'organization')
          .flatMap(i => i.sourceSaleIds ?? []),
        saleChargebackIds: selectedItems.filter(i => i.kind === 'chargeback' && !i.manualChargeback).map(i => i.id),
        manualChargebackIds: selectedItems.filter(i => i.kind === 'chargeback' && i.manualChargeback).map(i => i.id),
        total: selectedTotal,
      },
      { onSuccess: () => setPayTarget(null) },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-3">
        {!financeOptions && <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>}
        {canFilterByTeam && !financeOptions && <TeamMemberFilter />}
        {search === undefined && <div className="relative flex-1 sm:max-w-[300px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("Pesquisar comercial...")}
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>}
      </div>

      {commercials.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileX className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium mb-1">{t("Sem comissões neste mês")}</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              {t("Entram aqui as comissões de vendas entregues e de subscrições (recorrentes) deste período.")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Wallet className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{financeOptions ? t("Comissões do período") : t("Comissões do Mês")}</p>
                  <p className="text-2xl font-bold">{formatCurrency(total)}</p>
                </div>
              </div>
              {totalPending > 0 && (
                <Badge variant="outline" className="border-amber-500/30 bg-amber-500/20 text-amber-600 text-sm">
                  {t("{{value}} por pagar", { value: formatCurrency(totalPending) })}
                </Badge>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>{t("Comercial")}</TableHead>
                    <TableHead className="text-right">{t("Comissão")}</TableHead>
                    <TableHead>{t("Estado")}</TableHead>
                    <TableHead className="text-right">{t("Ação")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(entry => {
                    const isPending = entry.totalPending > 0;
                    return (
                      <>
                        <TableRow
                          key={entry.userId}
                          className="cursor-pointer"
                          onClick={() => toggle(entry.userId)}
                        >
                          <TableCell>
                            {expanded.has(entry.userId)
                              ? <ChevronDown className="h-4 w-4" />
                              : <ChevronRight className="h-4 w-4" />}
                          </TableCell>
                          <TableCell className="font-medium">{entry.name}</TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatCurrency(entry.total)}
                          </TableCell>
                          <TableCell>
                            {isPending ? (
                              <Badge variant="outline" className="border-amber-500/30 bg-amber-500/20 text-amber-600">
                                {t("{{value}} por pagar", { value: formatCurrency(entry.totalPending) })}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="border-green-500/30 bg-green-500/20 text-green-600">
                                {t("Pago")}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {isPending && (
                              <Button
                                size="sm"
                                onClick={(e) => { e.stopPropagation(); openPay(entry); }}
                              >
                                {t("Pagar")}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                        {expanded.has(entry.userId) && (
                          <TableRow key={`${entry.userId}-detail`}>
                            <TableCell colSpan={5} className="bg-muted/30 p-0">
                              <div className="p-4">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>{t("Tipo")}</TableHead>
                                      <TableHead>{t("Cliente / Venda")}</TableHead>
                                      <TableHead>{t("Data")}</TableHead>
                                      <TableHead className="text-right">{t("Recebido / venda")}</TableHead>
                                      <TableHead className="text-right">{t("Comissão")}</TableHead>
                                      <TableHead>{t("Estado")}</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {entry.items.map(item => (
                                      <TableRow key={`${item.kind}-${item.id}`}>
                                        <TableCell className="text-xs">
                                          {item.kind === 'recurring' ? (
                                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                                              <RefreshCw className="h-3 w-3" /> {t("Recorrente")}
                                            </span>
                                          ) : item.kind === 'chargeback' ? (
                                            <span className="text-red-600">{t("Chargeback")}</span>
                                          ) : item.kind === 'organization' ? (
                                            <span className="text-muted-foreground">{t("Organização")}</span>
                                          ) : (
                                            <span className="text-muted-foreground">{t("Direta")}</span>
                                          )}
                                          {item.proportional && (
                                            <span className="ml-1 inline-flex items-center rounded border border-blue-500/30 bg-blue-500/10 px-1 py-0.5 text-[9px] font-medium text-blue-600">
                                              {t("Proporcional")}
                                            </span>
                                          )}
                                        </TableCell>
                                        <TableCell className="text-xs">{item.label}</TableCell>
                                        <TableCell className="text-xs">
                                          {/* Telecom: the installation day, and the month the commission falls in under it. */}
                                          {item.installDate ? (
                                            <>
                                              <span className="block">{t("Instalada {{date}}", { date: format(new Date(item.installDate), 'dd/MM/yyyy') })}</span>
                                              {item.date && <span className="block text-[11px] text-muted-foreground">{t("Comissão de {{month}}", { month: format(new Date(item.date), 'MMM yyyy', { locale: dateLocale() }) })}</span>}
                                            </>
                                          ) : item.date ? format(new Date(item.date), item.expectedMonth || item.kind === 'chargeback' ? 'MMM yyyy' : 'dd MMM yyyy', { locale: dateLocale() }) : '—'}
                                        </TableCell>
                                        <TableCell className="text-right text-xs">
                                          {/* A proportional commission shows what the client paid this month out of the sale. */}
                                          {item.saleValue == null ? '—'
                                            : item.proportional && item.received != null
                                              ? t("{{received}} de {{total}}", { received: formatCurrency(item.received), total: formatCurrency(item.saleValue) })
                                              : formatCurrency(item.saleValue)}
                                        </TableCell>
                                        <TableCell className="text-right text-xs font-medium">{formatCurrency(item.amount)}</TableCell>
                                        <TableCell>
                                          <div className="flex items-center gap-1.5">
                                            <Badge
                                              variant="outline"
                                              className={cn(
                                                'text-[10px]',
                                                item.paid
                                                  ? 'border-green-500/30 bg-green-500/20 text-green-600'
                                                  : 'border-amber-500/30 bg-amber-500/20 text-amber-600',
                                              )}
                                            >
                                              {item.kind === 'chargeback' ? (item.paid ? t('Aplicado') : t('Por aplicar')) : (item.paid ? t('Pago') : t('Por pagar'))}
                                            </Badge>
                                            {!item.paid && item.kind !== 'chargeback' && (
                                              <button
                                                type="button"
                                                title={t("Marcar como paga")}
                                                disabled={markPaidMutation.isPending}
                                                onClick={() => item.kind === 'organization'
                                                  ? markPaidMutation.mutate({ kind: item.kind, id: item.id, sourceSaleIds: item.sourceSaleIds ?? [] })
                                                  : markPaidMutation.mutate({ kind: item.kind, id: item.id })}
                                                className="inline-flex h-5 w-5 items-center justify-center rounded text-green-600 hover:bg-green-500/20 disabled:opacity-40"
                                              >
                                                <Check className="h-3 w-3" />
                                              </button>
                                            )}
                                          </div>
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={!!payTarget} onOpenChange={(o) => !o && setPayTarget(null)}>
        <DialogContent variant="fullScreen" className="flex flex-col gap-0 p-0">
          <DialogHeader className="border-b px-4 py-4 md:px-6">
            <DialogTitle>{t("Pagar comissões — {{name}}", { name: payTarget?.name ?? "" })}</DialogTitle>
            <DialogDescription>
              {t("Escolhe quais comissões pagar. As selecionadas são marcadas como pagas e é registada a despesa.")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6"><div className="mx-auto max-w-2xl space-y-4">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-medium text-muted-foreground">{t("{{n}} pendente(s)", { n: pendingItems.length })}</span>
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline"
                onClick={() =>
                  setSelectedIds(
                    selectedItems.length === pendingItems.length
                      ? new Set(pendingItems.filter(item => item.kind === 'chargeback').map(itemKey))
                      : new Set(pendingItems.map(itemKey)),
                  )
                }
              >
                {selectedItems.length === pendingItems.length ? t('Desmarcar todas') : t('Selecionar todas')}
              </button>
            </div>

            <div className="space-y-1 rounded-lg border p-2">
              {pendingItems.map(item => {
                const key = itemKey(item);
                return (
                  <label key={key} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50">
                    <Checkbox
                      checked={selectedIds.has(key)}
                      disabled={item.kind === 'chargeback'}
                      onCheckedChange={(v) => toggleSelected(key, v === true)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{item.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {item.kind === 'chargeback' ? t('Desconto obrigatório') : item.kind === 'recurring' ? t('Recorrente') : item.kind === 'organization' ? t('Organização') : t('Direta')}
                        {item.installDate ? ` · ${t('instalada {{date}}', { date: format(new Date(item.installDate), 'dd/MM/yyyy') })}`
                          : item.date ? ` · ${format(new Date(item.date), item.expectedMonth || item.kind === 'chargeback' ? 'MMM yyyy' : 'dd MMM yyyy', { locale: dateLocale() })}` : ''}
                      </span>
                    </span>
                    <span className="text-sm font-medium">{formatCurrency(item.amount)}</span>
                  </label>
                );
              })}
            </div>

            <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-4">
              <span className="text-sm font-medium text-muted-foreground">
                {t("Selecionadas ({{selected}}/{{total}})", { selected: selectedItems.length, total: pendingItems.length })}
              </span>
              <span className="text-xl font-bold text-primary">{formatCurrency(selectedTotal)}</span>
            </div>

            <BankAccountSelect value={bankAccount} onChange={setBankAccount} label={t("Conta de onde sai")} />
          </div></div>

          <DialogFooter className="border-t px-4 py-4 md:px-6">
            <Button variant="outline" onClick={() => setPayTarget(null)} disabled={payMutation.isPending}>
              {t("Cancelar")}
            </Button>
            <Button onClick={confirmPay} disabled={payMutation.isPending || selectedItems.length === 0 || selectedTotal < 0}>
              {payMutation.isPending ? t('A processar...') : t('Pagar {{value}}', { value: formatCurrency(selectedTotal) })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
