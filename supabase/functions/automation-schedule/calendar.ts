export class ScheduleConfigError extends Error {}
export type ScheduleConfig = Readonly<Record<string, unknown>>;

export function lisbonCalendar(now: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(part => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, time: `${parts.hour}:${parts.minute}`, weekday: new Date(`${date}T12:00:00Z`).getUTCDay(), day: Number(parts.day) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function scheduledOccurrence(config: ScheduleConfig, now: Date): string | null {
  const today = lisbonCalendar(now);
  const schedule = config.schedule;
  if (!isRecord(schedule)) throw new ScheduleConfigError('Configure a agenda.');
  const { frequency, time, weekday, day } = schedule;
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ScheduleConfigError('Hora inválida.');
  let matches: boolean;
  switch (frequency) {
    case 'daily': matches = true; break;
    case 'weekdays': matches = today.weekday > 0 && today.weekday < 6; break;
    case 'weekly':
      if (!Number.isInteger(weekday) || Number(weekday) < 0 || Number(weekday) > 6) throw new ScheduleConfigError('Dia da semana inválido.');
      matches = today.weekday === weekday; break;
    case 'monthly':
      if (!Number.isInteger(day) || Number(day) < 1 || Number(day) > 31) throw new ScheduleConfigError('Dia do mês inválido.');
      matches = today.day === day; break;
    default: throw new ScheduleConfigError('Frequência inválida.');
  }
  return matches && today.time >= time ? `${today.date}@${time}` : null;
}

export function recordDateOccurrence(config: ScheduleConfig, record: ScheduleConfig, now: Date): string | null {
  const field = config.date_field;
  if (typeof field !== 'string' || !/^[a-z][a-z0-9_]*$/.test(field)) throw new ScheduleConfigError('Campo de data inválido.');
  const raw = record[field];
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(raw) || !Number.isFinite(Date.parse(raw))) return null;
  const date = raw.includes('T') ? lisbonCalendar(new Date(raw)).date : raw.slice(0, 10);
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return null;
  const offset = Number(config.offset_days ?? 0);
  const time = String(config.time ?? '09:00');
  if (!Number.isInteger(offset) || Math.abs(offset) > 3660 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ScheduleConfigError('Data ou hora configurada inválida.');
  const target = new Date(`${date}T12:00:00Z`);
  target.setUTCDate(target.getUTCDate() + offset);
  const today = lisbonCalendar(now);
  return target.toISOString().slice(0, 10) === today.date && today.time >= time ? `${date}:${offset}@${time}` : null;
}
