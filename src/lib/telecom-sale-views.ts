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
    if (!sale.scheduled_install_date) return false;
    const d = new Date(sale.scheduled_install_date);
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
