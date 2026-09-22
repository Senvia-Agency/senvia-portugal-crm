import { useMemo, useState } from 'react';
import { format, subMonths, startOfMonth } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import type { CommissionFilters } from '@/lib/commission-filters';
import { pt } from 'date-fns/locale';
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
      label: format(d, 'MMMM yyyy', { locale: pt }),
    });
  }
  return options;
}

export function TeamCommissionsTab({ financeOptions }: { financeOptions?: { dateRange?: DateRange; commissionFilters?: CommissionFilters } } = {}) {
  const { effectiveUserIds, canFilterByTeam } = useTeamFilter();
  const monthOptions = useMemo(() => generateMonthOptions(), []);
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0]?.value);
  const [searchTerm, setSearchTerm] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [payTarget, setPayTarget] = useState<CommercialCommission | null>(null);
  const [bankAccount, setBankAccount] = useState('none');
  // Which pending commissions are ticked for payment (keyed by `${kind}-${id}`).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data, isLoading } = useCommercialCommissions(selectedMonth, effectiveUserIds, financeOptions);
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
  const filtered = commercials.filter(c => matchesSearch(searchTerm, c.name));

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
    setSelectedIds(prev => {
      const next = new Set(prev);
      on ? next.add(key) : next.delete(key);
      return next;
    });
  };

  const confirmPay = () => {
    if (!payTarget || selectedItems.length === 0) return;
    payMutation.mutate(
      {
        fullName: payTarget.name,
        bankAccountId: bankAccount === 'none' ? null : bankAccount,
        saleIds: selectedItems.filter(i => i.kind === 'direct').map(i => i.id),
        recordIds: selectedItems.filter(i => i.kind === 'recurring').map(i => i.id),
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
        {canFilterByTeam && <TeamMemberFilter />}
        <div className="relative flex-1 sm:max-w-[300px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Pesquisar comercial..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {commercials.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileX className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium mb-1">Sem comissões neste mês</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Entram aqui as comissões de vendas entregues e de subscrições (recorrentes) deste período.
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
                  <p className="text-sm font-medium text-muted-foreground">Comissões do Mês</p>
                  <p className="text-2xl font-bold">{formatCurrency(total)}</p>
                </div>
              </div>
              {totalPending > 0 && (
                <Badge variant="outline" className="border-amber-500/30 bg-amber-500/20 text-amber-600 text-sm">
                  {formatCurrency(totalPending)} por pagar
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
                    <TableHead>Comercial</TableHead>
                    <TableHead className="text-right">Comissão</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
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
                                {formatCurrency(entry.totalPending)} pendente
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="border-green-500/30 bg-green-500/20 text-green-600">
                                Pago
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {isPending && (
                              <Button
                                size="sm"
                                onClick={(e) => { e.stopPropagation(); openPay(entry); }}
                              >
                                Pagar
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
                                      <TableHead>Tipo</TableHead>
                                      <TableHead>Cliente / Venda</TableHead>
                                      <TableHead>Data</TableHead>
                                      <TableHead className="text-right">Valor venda</TableHead>
                                      <TableHead className="text-right">Comissão</TableHead>
                                      <TableHead>Estado</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {entry.items.map(item => (
                                      <TableRow key={`${item.kind}-${item.id}`}>
                                        <TableCell className="text-xs">
                                          {item.kind === 'recurring' ? (
                                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                                              <RefreshCw className="h-3 w-3" /> Recorrente
                                            </span>
                                          ) : (
                                            <span className="text-muted-foreground">Direta</span>
                                          )}
                                          {item.proportional && (
                                            <span className="ml-1 inline-flex items-center rounded border border-blue-500/30 bg-blue-500/10 px-1 py-0.5 text-[9px] font-medium text-blue-600">
                                              Proporcional
                                            </span>
                                          )}
                                        </TableCell>
                                        <TableCell className="text-xs">{item.label}</TableCell>
                                        <TableCell className="text-xs">
                                          {item.date ? format(new Date(item.date), 'dd MMM yyyy', { locale: pt }) : '—'}
                                        </TableCell>
                                        <TableCell className="text-right text-xs">
                                          {item.saleValue != null ? formatCurrency(item.saleValue) : '—'}
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
                                              {item.paid ? 'Pago' : 'Pendente'}
                                            </Badge>
                                            {!item.paid && (
                                              <button
                                                type="button"
                                                title="Marcar como paga"
                                                disabled={markPaidMutation.isPending}
                                                onClick={() => markPaidMutation.mutate({ kind: item.kind, id: item.id })}
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pagar comissões — {payTarget?.name}</DialogTitle>
            <DialogDescription>
              Escolhe quais comissões pagar. As selecionadas são marcadas como pagas e é registada a despesa.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-medium text-muted-foreground">{pendingItems.length} pendente(s)</span>
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline"
                onClick={() =>
                  setSelectedIds(
                    selectedItems.length === pendingItems.length
                      ? new Set()
                      : new Set(pendingItems.map(itemKey)),
                  )
                }
              >
                {selectedItems.length === pendingItems.length ? 'Desmarcar todas' : 'Selecionar todas'}
              </button>
            </div>

            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2">
              {pendingItems.map(item => {
                const key = itemKey(item);
                return (
                  <label key={key} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50">
                    <Checkbox
                      checked={selectedIds.has(key)}
                      onCheckedChange={(v) => toggleSelected(key, v === true)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{item.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {item.kind === 'recurring' ? 'Recorrente' : 'Direta'}
                        {item.date ? ` · ${format(new Date(item.date), 'dd MMM yyyy', { locale: pt })}` : ''}
                      </span>
                    </span>
                    <span className="text-sm font-medium">{formatCurrency(item.amount)}</span>
                  </label>
                );
              })}
            </div>

            <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-4">
              <span className="text-sm font-medium text-muted-foreground">
                Selecionadas ({selectedItems.length}/{pendingItems.length})
              </span>
              <span className="text-xl font-bold text-primary">{formatCurrency(selectedTotal)}</span>
            </div>

            <BankAccountSelect value={bankAccount} onChange={setBankAccount} label="Conta de onde sai" />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)} disabled={payMutation.isPending}>
              Cancelar
            </Button>
            <Button onClick={confirmPay} disabled={payMutation.isPending || selectedItems.length === 0}>
              {payMutation.isPending ? 'A processar...' : `Pagar ${formatCurrency(selectedTotal)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
