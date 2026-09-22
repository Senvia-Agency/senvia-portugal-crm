import { useMemo, useState } from 'react';
import { format, startOfMonth, endOfMonth, startOfDay, endOfDay, parseISO } from 'date-fns';
import { pt } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Wallet, Clock, CheckCircle2 } from 'lucide-react';
import { useMyCommissions } from '@/hooks/useSalesApproval';
import { formatCurrency } from '@/lib/format';
import { useAuth } from '@/contexts/AuthContext';
import { commissionPortions as portions } from '@/lib/commission-earnings';
import { telecomCommissionDate, telecomCommissionInPeriod } from '@/lib/telecom-finance';

type StatusFilter = 'pending' | 'confirmed' | 'cancelled' | 'all';

interface CommissionSale {
  status: string;
  is_paid: boolean;
  total_value: number;
  paid_amount: number;
  comissao: number | null;
  earned_by_operator?: boolean;
}

const EPS = 0.005;
const isConcluded = (s: CommissionSale) => s.status === 'delivered' || s.status === 'fulfilled';
const isCancelled = (s: CommissionSale) => s.status === 'cancelled';

// The shared calculation handles client receipts and operator-earned commission.
const hasConfirmed = (s: CommissionSale) => portions(s).confirmed > EPS;
const hasPending = (s: CommissionSale) => portions(s).pending > EPS;

function badgeMeta(s: CommissionSale): { label: string; className: string } {
  if (isCancelled(s)) return { label: 'Anulada', className: 'bg-red-500/10 text-red-700 dark:text-red-400' };
  const { fraction } = portions(s);
  if (fraction >= 0.999) return { label: 'Confirmada', className: 'bg-green-500/10 text-green-700 dark:text-green-400' };
  if (fraction > 0) return { label: `Parcial (${Math.round(fraction * 100)}%)`, className: 'bg-blue-500/10 text-blue-700 dark:text-blue-400' };
  // nothing earned: distinguish "concluded but awaiting payment" from "not concluded yet"
  return {
    label: isConcluded(s) ? 'Aguarda pagamento' : 'Pendente',
    className: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  };
}

export function MinhasComissoesContent({ dateRange }: { dateRange?: DateRange }) {
  const { organization } = useAuth();
  const isTelecom = organization?.niche === 'telecom';
  const dateOf = (s: Parameters<typeof telecomCommissionDate>[0]) =>
    isTelecom ? telecomCommissionDate(s) : s.sale_date;
  const { data: allSales = [], isLoading } = useMyCommissions();
  const [filter, setFilter] = useState<StatusFilter>('pending');

  // Whether a date falls in the selected period (no range → always true).
  const inPeriod = (dateStr?: string | null) => {
    if (!dateRange?.from) return true;
    if (!dateStr) return false;
    const d = parseISO(dateStr);
    return d >= startOfDay(dateRange.from)
      && (isTelecom && !dateRange.to || d <= endOfDay(dateRange.to ?? dateRange.from));
  };

  // Filter by sale date for the selected period. An outstanding (pending)
  // commission carries FORWARD: it stays visible in its own period and every LATER
  // one until settled — but never earlier than the sale itself (a July sale must
  // not show up when filtering June). Settled commissions show only in their period.
  const sales = useMemo(() => {
    if (isTelecom) return allSales.filter(s => telecomCommissionInPeriod(s, dateRange));
    if (!dateRange?.from) return allSales;
    const periodEnd = endOfDay(dateRange.to ?? dateRange.from);
    return allSales.filter((s) => {
      if (hasPending(s)) {
        if (!s.sale_date) return true;
        return parseISO(s.sale_date) <= periodEnd;
      }
      return inPeriod(s.sale_date);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSales, dateRange, isTelecom]);

  const stats = useMemo(() => {
    const monthStart = startOfMonth(new Date());
    let pendingTotal = 0;
    let pendingCount = 0;
    let confirmedTotal = 0;
    let confirmedCount = 0;
    let monthTotal = 0;

    for (const s of sales) {
      if (isCancelled(s)) continue;
      const { confirmed, pending } = portions(s);
      if (pending > EPS) {
        pendingTotal += pending;
        pendingCount++;
      }
      // Confirmed amounts count only within their own period, so a pending sale
      // carried forward from an earlier month never inflates this period's totals.
      if (confirmed > EPS && (isTelecom ? telecomCommissionInPeriod(s, dateRange) : inPeriod(dateOf(s)))) {
        confirmedTotal += confirmed;
        confirmedCount++;
        const ref = isTelecom ? (dateOf(s) ? new Date(dateOf(s)!) : null) : s.approved_at
          ? new Date(s.approved_at)
          : s.activation_date
            ? new Date(s.activation_date)
            : null;
        if (ref && ref >= monthStart && (!isTelecom || ref <= endOfMonth(monthStart))) monthTotal += confirmed;
      }
    }
    return { pendingTotal, pendingCount, confirmedTotal, confirmedCount, monthTotal };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, dateRange, isTelecom]);

  const filtered = useMemo(() => {
    if (filter === 'all') return sales;
    if (filter === 'pending') return sales.filter(s => hasPending(s));
    if (filter === 'confirmed') return sales.filter(s => hasConfirmed(s));
    if (filter === 'cancelled') return sales.filter(s => isCancelled(s));
    return sales;
  }, [sales, filter]);

  // In the pending/confirmed tabs, show only the relevant portion of the
  // commission for partially-paid sales; elsewhere show the full amount.
  const displayCommission = (s: CommissionSale): number => {
    const p = portions(s);
    if (filter === 'pending') return p.pending;
    if (filter === 'confirmed') return p.confirmed;
    return Number(s.comissao) || 0;
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Clock className="h-4 w-4 text-yellow-600" /> Pendentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.pendingTotal)}</div>
            <div className="text-xs text-muted-foreground">{stats.pendingCount} venda(s)</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-green-600" /> Confirmadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.confirmedTotal)}</div>
            <div className="text-xs text-muted-foreground">{stats.confirmedCount} venda(s)</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Wallet className="h-4 w-4" /> Confirmadas este mês
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.monthTotal)}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
        <TabsList>
          <TabsTrigger value="pending">Pendentes</TabsTrigger>
          <TabsTrigger value="confirmed">Confirmadas</TabsTrigger>
          <TabsTrigger value="cancelled">Anuladas</TabsTrigger>
          <TabsTrigger value="all">Tudo</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="overflow-hidden rounded-lg border bg-card">
        {isLoading ? (
          <div className="flex justify-center p-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">Sem vendas para mostrar.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{isTelecom ? 'Recebimento previsto' : 'Data'}</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead className="text-right">Valor venda</TableHead>
                  <TableHead className="text-right">Comissão</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(s => {
                  const meta = badgeMeta(s);
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="text-sm">
                        {dateOf(s)
                          ? format(new Date(dateOf(s)!), isTelecom && (s.commission_payment_month_offset ?? 0) > 0 ? 'MMM yyyy' : 'dd MMM yyyy', { locale: pt })
                          : '-'}
                      </TableCell>
                      <TableCell>
                        {s.client_name || <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">{s.code || '-'}</span>
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(s.total_value)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {s.comissao
                          ? formatCurrency(displayCommission(s))
                          : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={meta.className}>
                          {meta.label}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
