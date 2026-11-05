export class AutomationTimeError extends Error {}

type LocalParts = Readonly<{ year: number; month: number; day: number; hour: number; minute: number; second: number }>;
const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function localParts(date: Date): LocalParts {
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, Number(part.value)]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second };
}

function localMillis(parts: LocalParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function fromLocal(parts: LocalParts): Date {
  const target = localMillis(parts);
  let instant = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const difference = target - localMillis(localParts(new Date(instant)));
    if (difference === 0) return new Date(instant);
    instant += difference;
  }
  throw new AutomationTimeError('Esta hora não existe no fuso de Portugal devido à mudança de hora.');
}

function clock(value: unknown, fallback: string): readonly [number, number] {
  const text = value === undefined ? fallback : String(value);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
    throw new AutomationTimeError('A hora deve ter o formato HH:MM.');
  }
  const [hours, minutes] = text.split(':').map(Number);
  return [hours, minutes];
}

function offsetDate(parts: LocalParts, days: number): LocalParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { ...parts, year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function dateParts(raw: unknown): LocalParts {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(raw)) {
    throw new AutomationTimeError('O campo de data está vazio ou tem uma data inválida.');
  }
  const [year, month, day] = raw.slice(0, 10).split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() + 1 !== month || calendar.getUTCDate() !== day) {
    throw new AutomationTimeError('A data indicada não existe no calendário.');
  }
  if (raw.length === 10) return { year, month, day, hour: 0, minute: 0, second: 0 };
  // Timestamps must identify an instant; date-only values use the Lisbon calendar.
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw) || !Number.isFinite(Date.parse(raw))) {
    throw new AutomationTimeError('A data e hora precisam de indicar o fuso horário.');
  }
  return localParts(new Date(raw));
}

export function calculateAutomationWakeAt(
  config: Readonly<Record<string, unknown>>,
  variables: Readonly<Record<string, unknown>>,
  now: Date,
): Date {
  if (!Number.isFinite(now.getTime())) throw new AutomationTimeError('O instante atual é inválido.');
  switch (config.wait_mode ?? 'duration') {
    case 'duration': {
      const amount = Number(config.amount ?? config.duration ?? 0);
      const units: Readonly<Record<string, number>> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000, weeks: 604_800_000 };
      if (!Number.isFinite(amount)) throw new AutomationTimeError('A duração é inválida.');
      const result = new Date(now.getTime() + Math.max(0, amount) * (units[String(config.unit ?? 'minutes')] ?? 60_000));
      if (!Number.isFinite(result.getTime())) throw new AutomationTimeError('A duração ultrapassa o intervalo suportado.');
      return result;
    }
    case 'date': {
      const field = String(config.date_field ?? '');
      const parts = dateParts(variables[field]);
      const offset = Number(config.offset_days ?? 0);
      if (!Number.isInteger(offset)) throw new AutomationTimeError('O desvio de dias deve ser um número inteiro.');
      const [hour, minute] = config.at_time === undefined ? [parts.hour, parts.minute] : clock(config.at_time, '09:00');
      const result = fromLocal({ ...offsetDate(parts, offset), hour, minute, second: config.at_time === undefined ? parts.second : 0 });
      return result.getTime() <= now.getTime() ? new Date(now) : result;
    }
    case 'business': {
      const [startHour, startMinute] = clock(config.business_start, '09:00');
      const [endHour, endMinute] = clock(config.business_end, '18:00');
      const start = startHour * 60 + startMinute;
      const end = endHour * 60 + endMinute;
      if (end <= start) throw new AutomationTimeError('O fim do horário útil deve ser depois do início.');
      const parts = localParts(now);
      for (let days = 0; days < 8; days += 1) {
        const candidate = offsetDate(parts, days);
        const weekday = new Date(Date.UTC(candidate.year, candidate.month - 1, candidate.day)).getUTCDay();
        if (weekday === 0 || weekday === 6) continue;
        const minuteOfDay = parts.hour * 60 + parts.minute;
        if (days === 0 && minuteOfDay >= end) continue;
        if (days === 0 && minuteOfDay >= start) return new Date(now);
        return fromLocal({ ...candidate, hour: startHour, minute: startMinute, second: 0 });
      }
      throw new AutomationTimeError('Não foi encontrado um próximo dia útil.');
    }
    default:
      throw new AutomationTimeError('Modo de espera desconhecido.');
  }
}
