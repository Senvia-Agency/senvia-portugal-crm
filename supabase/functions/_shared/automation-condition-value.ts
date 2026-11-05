export class InvalidConditionValue extends Error {}

interface ConditionValueInput {
  readonly field: string;
  readonly operator: string;
  readonly actual: unknown;
  readonly expected: unknown;
  readonly now?: Date;
}

const normalized = (value: unknown): string => String(value ?? '').trim().toLowerCase();
const numeric = (value: unknown): number => {
  if ((typeof value !== 'number' && typeof value !== 'string') || normalized(value) === '') return Number.NaN;
  const result = Number(value);
  return Number.isFinite(result) ? result : Number.NaN;
};
const expectedNumber = (value: unknown): number => {
  const result = numeric(value);
  if (!Number.isFinite(result)) throw new InvalidConditionValue('Preencha um número válido na condição.');
  return result;
};
const instant = (value: unknown): number => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return Number.NaN;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() + 1 !== month || calendar.getUTCDate() !== day) return Number.NaN;
  return Date.parse(value);
};
const phone = (value: unknown): string | null => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : null;
};
const list = (value: unknown): string[] =>
  (Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\n]/) : [])
    .map(normalized).filter(Boolean);

export function evaluateConditionValue(input: ConditionValueInput): boolean {
  const { field, operator, actual, expected } = input;
  const same = /telefone|phone|whatsapp/i.test(field)
    ? phone(actual) !== null && phone(actual) === phone(expected)
    : normalized(actual) === normalized(expected);
  switch (operator) {
    case 'exists':
    case 'is_not_empty': return actual !== undefined && actual !== null && actual !== '';
    case 'not_exists':
    case 'is_empty': return actual === undefined || actual === null || actual === '';
    case 'equals': return same;
    case 'not_equals': return !same;
    case 'contains': return String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
    case 'greater_than': return numeric(actual) > expectedNumber(expected);
    case 'less_than': return numeric(actual) < expectedNumber(expected);
    case 'greater_or_equal': return numeric(actual) >= expectedNumber(expected);
    case 'less_or_equal': return numeric(actual) <= expectedNumber(expected);
    case 'before':
    case 'after': {
      const target = instant(expected);
      if (!Number.isFinite(target)) throw new InvalidConditionValue('Preencha uma data válida no formato AAAA-MM-DD ou ISO.');
      return operator === 'before' ? instant(actual) < target : instant(actual) > target;
    }
    case 'older_than_days': {
      const days = numeric(expected);
      if (!Number.isFinite(days) || days < 0) throw new InvalidConditionValue('O número de dias deve ser zero ou superior.');
      return (input.now ?? new Date()).getTime() - instant(actual) > days * 86_400_000;
    }
    case 'contains_any': {
      const choices = list(expected);
      if (!choices.length) throw new InvalidConditionValue('Preencha pelo menos um valor para comparar a lista.');
      return list(actual).some(item => choices.includes(item));
    }
    default: throw new InvalidConditionValue(`Condição desconhecida neste motor: «${operator}».`);
  }
}
