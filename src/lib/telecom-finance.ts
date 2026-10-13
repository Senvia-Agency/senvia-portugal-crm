import type { TelecomStatus } from '@/types/sales';
import { addMonths, endOfDay, format, parseISO, startOfMonth } from 'date-fns';
import type { DateRange } from 'react-day-picker';

export const TELECOM_EARNED_STATUSES: TelecomStatus[] = ['ativo', 'instalado'];

/** Both lifecycle states earn commission; a cancelled sale never does. */
export function isTelecomCommissionEarned(sale: { status?: string; telecom_status?: string | null }): boolean {
  return sale.status !== 'cancelled'
    && TELECOM_EARNED_STATUSES.includes(sale.telecom_status as TelecomStatus);
}

export function telecomTeamCommission(sale: { comissao?: number | null; org_commission?: number | null }): number {
  return Math.max(Number(sale.comissao || 0) - Number(sale.org_commission || 0), 0);
}

interface CommissionTiming {
  scheduled_install_date?: string | null;
  commission_payment_month_offset?: number | null;
  commission_expected_date?: string | null;
  activation_date?: string | null;
  sale_date?: string | null;
}

export function telecomCommissionDate(sale: CommissionTiming): string | null {
  if (!sale.scheduled_install_date) return null;
  const installation = parseISO(sale.scheduled_install_date);
  if (Number.isNaN(installation.getTime())) return null;
  const day = /(?:Z|[+-]\d{2}:\d{2})$/.test(sale.scheduled_install_date)
    ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(installation)
    : sale.scheduled_install_date.slice(0, 10);
  return format(addMonths(startOfMonth(parseISO(day)), 1), 'yyyy-MM-dd');
}

/** Telecom commissions belong to the calendar month after installation. */
export function telecomCommissionInPeriod(sale: CommissionTiming, range?: DateRange, today = new Date()): boolean {
  const date = telecomCommissionDate(sale);
  if (!date) return false;
  const value = parseISO(date);
  if (!range?.from) return value <= endOfDay(today);
  return value >= startOfMonth(range.from) && (!range.to || value <= startOfMonth(range.to));
}

interface ProductCommissionSale extends CommissionTiming {
  comissao?: number | null;
  org_commission?: number | null;
  servicos_produtos?: string[] | null;
  servicos_details?: Record<string, { comissao?: number; activation_date?: string }> | null;
}

interface ProductSplit {
  product_name: string | null;
  amount: number;
}

export interface TelecomCommissionPart {
  product: string | null;
  date: string | null;
  gross: number;
  seller: number;
  org: number;
}

/** Preserve the frozen sale amounts; every product shares its installation month. */
export function telecomCommissionParts(
  sale: ProductCommissionSale,
  _splits: readonly ProductSplit[] = [],
): TelecomCommissionPart[] {
  const gross = Number(sale.comissao || 0);
  const org = Number(sale.org_commission || 0);
  return [{ product: null, date: telecomCommissionDate(sale), gross, seller: Math.max(gross - org, 0), org }];
}

export function telecomCommissionPartsInPeriod(
  sale: ProductCommissionSale,
  range?: DateRange,
  splits: readonly ProductSplit[] = [],
): TelecomCommissionPart[] {
  return telecomCommissionInPeriod(sale, range) ? telecomCommissionParts(sale, splits) : [];
}
