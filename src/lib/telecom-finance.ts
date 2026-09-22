import type { TelecomStatus } from '@/types/sales';
import { endOfDay, parseISO, startOfDay, startOfMonth } from 'date-fns';
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
  commission_payment_month_offset?: number | null;
  commission_expected_date?: string | null;
  activation_date?: string | null;
  sale_date?: string | null;
}

export function telecomCommissionDate(sale: CommissionTiming): string | null {
  return Number(sale.commission_payment_month_offset || 0) > 0
    ? sale.commission_expected_date || null
    : sale.activation_date || sale.sale_date || null;
}

/** Future months can be projected explicitly; unfiltered totals exclude deferred amounts not yet due. */
export function telecomCommissionInPeriod(sale: CommissionTiming, range?: DateRange, today = new Date()): boolean {
  const deferred = Number(sale.commission_payment_month_offset || 0) > 0;
  const date = telecomCommissionDate(sale);
  if (!date) return !deferred && !range?.from;
  const value = parseISO(date);
  if (Number.isNaN(value.getTime())) return false;
  if (!range?.from) return !deferred || value <= endOfDay(today);
  if (deferred) return value >= startOfMonth(range.from) && (!range.to || value <= startOfMonth(range.to));
  return value >= startOfDay(range.from) && (!range.to || value <= endOfDay(range.to));
}
