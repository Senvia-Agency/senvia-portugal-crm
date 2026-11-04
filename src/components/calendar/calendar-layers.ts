import { addDays } from 'date-fns';
import type { EventType } from '@/types/calendar';

/** What the "Calendários" panel can show or hide: each event type, task deadlines and holidays. */
export type CalendarLayer = EventType | 'deadlines' | 'holidays';

export const CALENDAR_LAYERS: readonly { key: CalendarLayer; label: string; dot: string }[] = [
  { key: 'meeting', label: 'Reuniões', dot: 'bg-blue-500' },
  { key: 'call', label: 'Chamadas', dot: 'bg-green-500' },
  { key: 'task', label: 'Tarefas agendadas', dot: 'bg-yellow-500' },
  { key: 'follow_up', label: 'Follow-ups', dot: 'bg-purple-500' },
  { key: 'deadlines', label: 'Prazos de tarefas', dot: 'bg-amber-600' },
  { key: 'holidays', label: 'Feriados', dot: 'bg-rose-400' },
];

/** Items shown on the calendar that are not calendar events. */
export interface CalendarMarker {
  readonly key: string;
  readonly layer: 'deadlines' | 'holidays';
  readonly title: string;
  readonly date: Date;
  readonly allDay: boolean;
  /** Where the item opens (task deadlines open their conversation in the Inbox). */
  readonly href?: string;
  readonly overdue?: boolean;
}

/** Easter Sunday by the anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Portuguese national public holidays (Código do Trabalho, art. 234.º). Municipal holidays are not included. */
export function portugueseHolidays(year: number): { date: Date; name: string }[] {
  const easter = easterSunday(year);
  const fixed: readonly [number, number, string][] = [
    [0, 1, 'Ano Novo'], [3, 25, 'Dia da Liberdade'], [4, 1, 'Dia do Trabalhador'], [5, 10, 'Dia de Portugal'],
    [7, 15, 'Assunção de Nossa Senhora'], [9, 5, 'Implantação da República'], [10, 1, 'Dia de Todos os Santos'],
    [11, 1, 'Restauração da Independência'], [11, 8, 'Imaculada Conceição'], [11, 25, 'Natal'],
  ];
  return [
    ...fixed.map(([month, day, name]) => ({ date: new Date(year, month, day), name })),
    { date: addDays(easter, -2), name: 'Sexta-feira Santa' },
    { date: easter, name: 'Páscoa' },
    { date: addDays(easter, 60), name: 'Corpo de Deus' },
  ].sort((first, second) => first.date.getTime() - second.date.getTime());
}
