import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { addMonths, format, startOfMonth } from 'date-fns';
import { pt } from 'date-fns/locale';
import { CalendarClock, CheckCircle2, Wrench, XCircle, CalendarOff, Layers, FileSignature, ChevronRight, Building2, Banknote } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useSales } from '@/hooks/useSales';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency } from '@/lib/format';
import { isTelecomCommissionEarned } from '@/lib/telecom-finance';
import { formatOperationalUnits, sumOperationalSaleUnits } from '@/lib/sale-units';
import { useDashboardPeriod, formatPeriodLabel } from '@/stores/useDashboardPeriod';
import {
  TELECOM_VIEW_LABELS,
  isTelecomViewPeriodScoped,
  matchesTelecomView,
  type TelecomViewKey,
} from '@/lib/telecom-sale-views';

interface Metric {
  key: TelecomViewKey;
  hint: string;
  value: number;
  icon: typeof CheckCircle2;
  tone: string;
  href: string;
}

/**
 * Where the month's telecom sales actually stand: installed, still waiting,
 * booked for next month, cancelled before install — and the total those add
 * up to. Sales with no install date booked are counted separately instead of
 * being folded into a month they were never promised for.
 *
 * Every card links into the sales list carrying its own filter, so the number
 * can always be opened and checked. The counts and the list are decided by the
 * same predicate (see lib/telecom-sale-views.ts).
 */
export function TelecomLifecyclePanel() {
  const { data: sales = [], isLoading } = useSales();
  const { from, to } = useDashboardPeriod();
  const { isAdmin } = usePermissions();

  const { metrics, undated, operatorGross, orgMargin } = useMemo(() => {
    const start = from ? new Date(from) : null;
    const end = to ? new Date(to) : null;
    const reference = start ?? new Date();

    // The period picks WHICH sales are in play (by sale date); the lifecycle
    // counts below are then the state those sales are in right now.
    const inPeriod = sales.filter((s) => {
      if (!start || !end) return true;
      if (!s.sale_date) return false;
      const d = new Date(s.sale_date);
      return d >= start && d <= end;
    });

    const nextMonthStart = startOfMonth(addMonths(reference, 1));

    // Same date range the panel is showing, handed to the sales list so the
    // rows there match the number that was clicked.
    const periodQuery = start && end
      ? `&from=${format(start, 'yyyy-MM-dd')}&to=${format(end, 'yyyy-MM-dd')}`
      : '';
    const linkTo = (view: TelecomViewKey) =>
      `/sales?telecom=${view}${isTelecomViewPeriodScoped(view) ? periodQuery : ''}`;

    const count = (view: TelecomViewKey) => {
      // "Próximo mês" looks forward, so it is never limited to the period.
      const pool = isTelecomViewPeriodScoped(view) ? inPeriod : sales;
      return sumOperationalSaleUnits(pool.filter((s) => matchesTelecomView(s, view, reference)));
    };

    // Still to install and with no date agreed — the number that would
    // silently disappear if we only ever counted scheduled months.
    const semData = sumOperationalSaleUnits(inPeriod.filter(
      (s) => !s.scheduled_install_date &&
        (s.telecom_status === 'pendente' || s.telecom_status === 'em_instalacao'),
    ));

    const metrics: Metric[] = [
      { key: 'instalados', hint: 'Fechadas', value: count('instalados'), icon: CheckCircle2, tone: 'text-emerald-700', href: linkTo('instalados') },
      { key: 'ativos', hint: 'Operacionais', value: count('ativos'), icon: CheckCircle2, tone: 'text-green-600', href: linkTo('ativos') },
      { key: 'por_instalar', hint: 'Em instalação com data marcada', value: count('por_instalar'), icon: Wrench, tone: 'text-blue-600', href: linkTo('por_instalar') },
      { key: 'proximo_mes', hint: format(nextMonthStart, 'MMMM yyyy', { locale: pt }), value: count('proximo_mes'), icon: CalendarClock, tone: 'text-violet-600', href: linkTo('proximo_mes') },
      { key: 'anulados', hint: 'Antes da instalação — sem CB', value: count('anulados'), icon: XCircle, tone: 'text-slate-500', href: linkTo('anulados') },
      { key: 'cancelados', hint: 'Após instalação — geram CB', value: count('cancelados'), icon: XCircle, tone: 'text-red-500', href: linkTo('cancelados') },
      { key: 'por_assinar', hint: 'Ativos, pendentes e em instalação', value: count('por_assinar'), icon: FileSignature, tone: 'text-amber-600', href: linkTo('por_assinar') },
      { key: 'total', hint: `Ativos + instalados + pendentes + em instalação + anulados + ${format(nextMonthStart, 'MMMM', { locale: pt })}`, value: count('total'), icon: Layers, tone: 'text-foreground', href: linkTo('total') },
    ];

    // Money on the installed sales of the period. sales.comissao is the
    // operator's gross; org_commission is what no seller took.
    let operatorGross = 0;
    let orgMargin = 0;
    for (const s of inPeriod) {
      if (!isTelecomCommissionEarned(s)) continue;
      operatorGross += Number(s.comissao || 0);
      orgMargin += Number(s.org_commission || 0);
    }

    return { metrics, undated: semData, operatorGross, orgMargin };
  }, [sales, from, to]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader><Skeleton className="h-5 w-48" /></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-20" />)}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Análise do mês</CardTitle>
        <CardDescription>
          Estado das vendas de {formatPeriodLabel(from, to)}
          {undated > 0 && ` · ${formatOperationalUnits(undated)} instalaç${undated === 1 ? 'ão' : 'ões'} sem data marcada`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
          {metrics.map(({ key, hint, value, icon: Icon, tone, href }) => (
            <Link
              key={key}
              to={href}
              className={cn(
                'group rounded-lg border p-3 transition-colors hover:bg-accent/50 hover:border-primary/40',
                key === 'total' && 'bg-muted/40',
              )}
            >
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className={cn('h-3.5 w-3.5 shrink-0', tone)} />
                <span className="truncate">{TELECOM_VIEW_LABELS[key]}</span>
                <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <p className="mt-1 text-2xl font-semibold">{formatOperationalUnits(value)}</p>
              <p className="text-[11px] text-muted-foreground truncate">{hint}</p>
            </Link>
          ))}
        </div>

        {/* The operator's gross is only ever shown here and in Financeiro —
            never on a sale, where it reads as if it were the seller's pay. */}
        {isAdmin && operatorGross > 0 && (
          <div className="grid gap-3 grid-cols-2 rounded-lg border bg-muted/30 p-3">
            <div>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Building2 className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                Valor da Organização
              </p>
              <p className="mt-1 text-xl font-semibold text-amber-600">{formatCurrency(orgMargin)}</p>
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Banknote className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                Operadoras pagam
              </p>
              <p className="mt-1 text-xl font-semibold">{formatCurrency(operatorGross)}</p>
            </div>
          </div>
        )}

        {undated > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs text-amber-700 dark:text-amber-400">
            <CalendarOff className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              {formatOperationalUnits(undated)} venda{undated === 1 ? '' : 's'} sem instalação marcada — não entram em “Por instalar” nem na contagem do próximo mês.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
