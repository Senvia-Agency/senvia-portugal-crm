import { addMonths, endOfMonth, startOfMonth } from 'date-fns';
import type { TelecomStatus } from '@/types/sales';

/**
 * The cards on the dashboard's "Análise do mês" panel, as filters.
 *
 * Defined here — not inside the panel — because each card is also a link into
 * the sales list: the count on the card and the rows the list then shows have
 * to be decided by the SAME predicate, or clicking "Ativos: 5" lands on a
 * list of 4 and the dashboard looks broken.
 */
export type TelecomViewKey =
  | 'ativos'
  | 'instalados'
  | 'por_instalar'
  | 'proximo_mes'
  | 'anulados'
  | 'cancelados'
  | 'por_assinar'
  | 'total';

export const TELECOM_VIEW_LABELS: Record<TelecomViewKey, string> = {
  ativos: 'Ativos',
  instalados: 'Instalados',
  por_instalar: 'Por instalar',
  proximo_mes: 'Instalações no próximo mês',
  anulados: 'Anulados',
  cancelados: 'Cancelados',
  por_assinar: 'Contratos por assinar',
  total: 'Vendas no total',
};

/** Just enough of a sale to decide which cards it belongs to. */
interface TelecomSaleLike {
  telecom_status?: string | null;
  scheduled_install_date?: string | null;
  contract_signed?: boolean | null;
  sale_date?: string | null;
  activation_date?: string | null;
  servicos_details?: Record<string, { activation_date?: string | null } | null> | null;
}

const validDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * The dates that put a sale in a month, card by card. A sale belongs to the
 * month things HAPPENED to it, not the month it was sold: one sold on 28
 * September and installed on 8 October is an October installation — counted
 * by sale date it vanished from both months' installed figures.
 *
 *  - instalados / por_instalar / proximo_mes: the installation date (an
 *    installed sale without one falls back to its activation date);
 *  - ativos: the activation date — the sale's, or any product's own (a gas
 *    contract activated a month after the electricity is that month's too);
 *  - anulados, cancelados, por_assinar, sem data: the sale date, the only date
 *    those have.
 */
export function telecomViewDates(sale: TelecomSaleLike, view: TelecomViewKey): Date[] {
  const install = validDate(sale.scheduled_install_date);
  const activation = validDate(sale.activation_date);
  const sold = validDate(sale.sale_date);
  switch (view) {
    case 'instalados':
      return [install ?? activation].filter((d): d is Date => !!d);
    case 'por_instalar':
    case 'proximo_mes':
      return install ? [install] : [];
    case 'ativos': {
      const products = Object.values(sale.servicos_details ?? {})
        .map((detail) => validDate(detail?.activation_date ?? null))
        .filter((d): d is Date => !!d);
      const dates = [activation, ...products].filter((d): d is Date => !!d);
      // An active sale with no activation date at all keeps its sale date,
      // rather than dropping out of every month.
      return dates.length ? dates : [sold].filter((d): d is Date => !!d);
    }
    default:
      return [sold].filter((d): d is Date => !!d);
  }
}

/** Sold, still to install and with no installation date: the "sem data" warning. */
export function isTelecomUndatedInstall(sale: TelecomSaleLike): boolean {
  return !sale.scheduled_install_date
    && (sale.telecom_status === 'pendente' || sale.telecom_status === 'em_instalacao');
}

const PERIOD_CARDS: TelecomViewKey[] = ['instalados', 'ativos', 'por_instalar', 'anulados', 'cancelados'];

/**
 * Does the sale count on this card for the period [from, to]? The ONE
 * predicate behind both the dashboard number and the sales list it opens.
 */
export function matchesTelecomViewInPeriod(
  sale: TelecomSaleLike,
  view: TelecomViewKey,
  from: Date | null,
  to: Date | null,
): boolean {
  const reference = from ?? new Date();
  const inRange = (dates: Date[]) => !from || !to || dates.some((d) => d >= from && d <= to);

  if (view === 'proximo_mes') return matchesTelecomView(sale, 'proximo_mes', reference);
  if (view === 'total') {
    // Everything the other cards show for this period, plus the undated ones
    // sold in it and next month's installations — each sale once.
    return PERIOD_CARDS.some((card) => matchesTelecomViewInPeriod(sale, card, from, to))
      || (isTelecomUndatedInstall(sale) && inRange(telecomViewDates(sale, 'anulados')))
      || matchesTelecomView(sale, 'proximo_mes', reference);
  }
  return matchesTelecomView(sale, view, reference) && inRange(telecomViewDates(sale, view));
}

/** Pending sales and unscheduled installations are not booked installations. */
export function isTelecomAwaitingScheduledInstall(sale: TelecomSaleLike): boolean {
  return sale.telecom_status === 'em_instalacao'
    && !!sale.scheduled_install_date
    && !Number.isNaN(Date.parse(sale.scheduled_install_date));
}

/**
 * "Próximo mês" is a forward look, not a slice of the selected period — it
 * always means the month after `reference`, whatever period is on screen.
 */
export function isTelecomViewPeriodScoped(view: TelecomViewKey): boolean {
  return view !== 'proximo_mes';
}

export function matchesTelecomView(
  sale: TelecomSaleLike,
  view: TelecomViewKey,
  reference: Date,
): boolean {
  const status = (sale.telecom_status ?? null) as TelecomStatus | null;

  const nextMonthStart = startOfMonth(addMonths(reference, 1));
  const nextMonthEnd = endOfMonth(nextMonthStart);
  const installedNextMonth = () => {
    const d = validDate(sale.scheduled_install_date);
    // Booked installations only: one already undone is not coming next month.
    if (!d || status === 'anulado' || status === 'cancelado') return false;
    return d >= nextMonthStart && d <= nextMonthEnd;
  };

  switch (view) {
    case 'ativos':
      return status === 'ativo';
    case 'instalados':
      return status === 'instalado';
    case 'por_instalar':
      return isTelecomAwaitingScheduledInstall(sale);
    case 'proximo_mes':
      return installedNextMonth();
    case 'anulados':
      return status === 'anulado';
    case 'cancelados':
      return status === 'cancelado';
    case 'por_assinar':
      // A cancelled/void sale no longer needs a signature, so those are out.
      return !sale.contract_signed
        && (status === 'ativo' || status === 'pendente' || status === 'em_instalacao');
    case 'total':
      // Everything still in play plus what is booked for next month. Counted
      // ONCE per sale — a sale that is both "por instalar" and booked for
      // next month is one sale, not two.
      return status === 'ativo'
        || status === 'instalado'
        || status === 'pendente'
        || status === 'em_instalacao'
        || status === 'anulado'
        || installedNextMonth();
  }
}

export function isTelecomViewKey(value: string | null | undefined): value is TelecomViewKey {
  return !!value && value in TELECOM_VIEW_LABELS;
}
