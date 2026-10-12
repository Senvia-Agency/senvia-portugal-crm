// How a recurring expense repeats. The next due date itself is worked out in
// the database (expense_recurrence_next), never here: this file only names
// the schedule and fills in sensible defaults for the form.

export type RecurrenceFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurrenceSchedule {
  frequency: RecurrenceFrequency;
  /** 1–7 (ISO weekday, 1 = Monday) when weekly, else 1–31. */
  day: number;
  /** 1–12, yearly only. */
  month: number | null;
}

export const RECURRENCE_FREQUENCIES: RecurrenceFrequency[] = ['weekly', 'monthly', 'quarterly', 'yearly'];

export const RECURRENCE_FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  weekly: 'Semanal',
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  yearly: 'Anual',
};

/** Index 0 is ISO day 1 (Monday). */
export const WEEKDAY_LABELS = [
  'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo',
];

/** Index 0 is month 1. */
export const MONTH_LABELS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

function isoWeekday(date: Date): number {
  return date.getDay() === 0 ? 7 : date.getDay();
}

/** The schedule a new recurring expense starts with: due on its own date. */
export function defaultSchedule(date: Date, frequency: RecurrenceFrequency = 'monthly'): RecurrenceSchedule {
  return {
    frequency,
    day: frequency === 'weekly' ? isoWeekday(date) : date.getDate(),
    month: frequency === 'yearly' ? date.getMonth() + 1 : null,
  };
}

/** Switching frequency keeps the due day when it still fits, else follows the date. */
export function withFrequency(
  schedule: RecurrenceSchedule,
  frequency: RecurrenceFrequency,
  date: Date,
): RecurrenceSchedule {
  if (frequency === schedule.frequency) return schedule;
  const wasWeekly = schedule.frequency === 'weekly';
  const isWeekly = frequency === 'weekly';
  const fallback = defaultSchedule(date, frequency);
  return {
    frequency,
    day: wasWeekly === isWeekly ? schedule.day : fallback.day,
    month: frequency === 'yearly' ? schedule.month ?? fallback.month : null,
  };
}

interface ScheduleColumns {
  is_recurring: boolean;
  recurrence_frequency?: string | null;
  recurrence_day?: number | null;
  recurrence_month?: number | null;
}

/** The schedule saved on an expense, running or paused. */
export function storedSchedule(expense: ScheduleColumns): RecurrenceSchedule | null {
  if (!expense.recurrence_frequency || expense.recurrence_day == null) return null;
  if (!RECURRENCE_FREQUENCIES.includes(expense.recurrence_frequency as RecurrenceFrequency)) return null;
  return {
    frequency: expense.recurrence_frequency as RecurrenceFrequency,
    day: expense.recurrence_day,
    month: expense.recurrence_month ?? null,
  };
}

/** The schedule of an expense that is being booked, or null. */
export function scheduleOf(expense: ScheduleColumns): RecurrenceSchedule | null {
  return expense.is_recurring ? storedSchedule(expense) : null;
}

/** Paused: the schedule is kept, nothing is booked until it is resumed. */
export function pausedScheduleOf(expense: ScheduleColumns): RecurrenceSchedule | null {
  return expense.is_recurring ? null : storedSchedule(expense);
}

/** "Mensal · dia 5", "Semanal · à segunda-feira", "Anual · 15 de março". */
export function describeSchedule(schedule: RecurrenceSchedule): string {
  const label = RECURRENCE_FREQUENCY_LABELS[schedule.frequency];
  if (schedule.frequency === 'weekly') {
    const weekday = WEEKDAY_LABELS[schedule.day - 1]?.toLowerCase() ?? '';
    return `${label} · ${schedule.day === 6 || schedule.day === 7 ? 'ao' : 'à'} ${weekday}`;
  }
  if (schedule.frequency === 'yearly' && schedule.month) {
    return `${label} · ${schedule.day} de ${MONTH_LABELS[schedule.month - 1]}`;
  }
  return `${label} · dia ${schedule.day}`;
}

/** What a schedule costs per month on average: 52 weeks, 4 quarters, 12 months a year. */
export function monthlyEquivalent(amount: number, frequency: RecurrenceFrequency): number {
  const perYear = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1 }[frequency];
  return Math.round(((amount * perYear) / 12) * 100) / 100;
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Highest due day the form offers: 7 weekdays, 31, or the chosen month's own length. */
export function maxDueDay(frequency: RecurrenceFrequency, month: number | null): number {
  if (frequency === 'weekly') return 7;
  if (frequency === 'yearly' && month) return DAYS_IN_MONTH[month - 1];
  return 31;
}

/** A due day not every period has: say what happens in the short ones. */
export function shortMonthNote(schedule: RecurrenceSchedule): string | null {
  if (schedule.frequency === 'weekly') return null;
  if (schedule.frequency === 'yearly') {
    return schedule.month === 2 && schedule.day === 29
      ? 'Nos anos que não são bissextos, vence a 28 de fevereiro.'
      : null;
  }
  if (schedule.day < 29) return null;
  return `Nos meses sem dia ${schedule.day}, vence no último dia do mês.`;
}
