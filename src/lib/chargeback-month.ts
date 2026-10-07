import { endOfDay, endOfMonth, parseISO, startOfDay } from 'date-fns';
import type { DateRange } from 'react-day-picker';

/** A monthly deduction belongs to any selected period overlapping that month. */
export function applicationMonthInRange(month: string | null, range?: DateRange): boolean {
  if (!month) return false;
  const firstDay = parseISO(month);
  if (Number.isNaN(firstDay.getTime())) return false;
  if (range?.from && endOfMonth(firstDay) < startOfDay(range.from)) return false;
  if (range?.to && firstDay > endOfDay(range.to)) return false;
  return true;
}
