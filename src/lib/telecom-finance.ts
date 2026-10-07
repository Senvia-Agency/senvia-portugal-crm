import type { TelecomStatus } from '@/types/sales';
import { addMonths, endOfDay, format, parseISO, startOfDay, startOfMonth } from 'date-fns';
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

/** Keep legacy sales as one unit. Explicit product dates split only that sale's
 * existing, frozen gross and beneficiary amounts across their own months. */
export function telecomCommissionParts(
  sale: ProductCommissionSale,
  splits: readonly ProductSplit[] = [],
): TelecomCommissionPart[] {
  const gross = Number(sale.comissao || 0);
  const org = Number(sale.org_commission || 0);
  const names = sale.servicos_produtos ?? [];
  const details = sale.servicos_details ?? {};
  const hasProductDates = names.some(name => Object.prototype.hasOwnProperty.call(details[name] ?? {}, 'activation_date'));
  if (!hasProductDates || names.length === 0) {
    return [{ product: null, date: telecomCommissionDate(sale), gross, seller: Math.max(gross - org, 0), org }];
  }

  const weights = names.map(name => Math.max(Number(details[name]?.comissao || 0), 0));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  if (weightTotal <= 0) {
    // A sale without a reliable product breakdown retains its original month.
    return [{ product: null, date: telecomCommissionDate(sale), gross, seller: Math.max(gross - org, 0), org }];
  }
  const byProduct = new Map<string, number>();
  for (const split of splits) {
    if (split.product_name) byProduct.set(split.product_name, (byProduct.get(split.product_name) || 0) + Number(split.amount || 0));
  }
  const hasProductSplits = byProduct.size > 0;
  let remainingGross = gross;
  let remainingSeller = Math.max(gross - org, 0);
  return names.map((name, index) => {
    const isLast = index === names.length - 1;
    const lineGross = isLast ? remainingGross : Math.round(gross * weights[index] / weightTotal * 100) / 100;
    const splitSeller = byProduct.get(name) || 0;
    const lineSeller = isLast ? remainingSeller : hasProductSplits
      ? splitSeller
      : Math.round((gross - org) * weights[index] / weightTotal * 100) / 100;
    remainingGross = Math.round((remainingGross - lineGross) * 100) / 100;
    remainingSeller = Math.round((remainingSeller - lineSeller) * 100) / 100;
    const activation = details[name]?.activation_date;
    const offset = Number(sale.commission_payment_month_offset || 0);
    const date = activation && offset > 0
      ? format(addMonths(parseISO(activation), offset), 'yyyy-MM-dd')
      : activation || null;
    return {
      product: name,
      date,
      gross: lineGross,
      seller: lineSeller,
      org: Math.round((lineGross - lineSeller) * 100) / 100,
    };
  });
}

export function telecomCommissionPartsInPeriod(
  sale: ProductCommissionSale,
  range?: DateRange,
  splits: readonly ProductSplit[] = [],
): TelecomCommissionPart[] {
  return telecomCommissionParts(sale, splits).filter(part => {
    if (!part.date) return false;
    const timing = {
      ...sale,
      activation_date: part.date,
      commission_expected_date: part.date,
    };
    return telecomCommissionInPeriod(timing, range);
  });
}
