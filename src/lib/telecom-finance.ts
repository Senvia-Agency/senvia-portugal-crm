import type { TelecomStatus } from '@/types/sales';

export const TELECOM_EARNED_STATUSES: TelecomStatus[] = ['ativo', 'instalado'];

/** Both lifecycle states earn commission; a cancelled sale never does. */
export function isTelecomCommissionEarned(sale: { status?: string; telecom_status?: string | null }): boolean {
  return sale.status !== 'cancelled'
    && TELECOM_EARNED_STATUSES.includes(sale.telecom_status as TelecomStatus);
}

export function telecomTeamCommission(sale: { comissao?: number | null; org_commission?: number | null }): number {
  return Math.max(Number(sale.comissao || 0) - Number(sale.org_commission || 0), 0);
}
