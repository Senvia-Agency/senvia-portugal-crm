const VALUELESS = new Set(['exists', 'not_exists', 'in_clients', 'in_leads', 'in_crm', 'is_empty', 'is_not_empty']);
const NUMERIC = new Set(['greater_than', 'less_than', 'greater_or_equal', 'less_or_equal', 'older_than_days']);

function validDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() + 1 === month && calendar.getUTCDate() === day;
}

export function conditionValueIssue(operator: string, value: unknown): string | null {
  if (VALUELESS.has(operator)) return null;
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && value.length === 0)) return 'Preencha o valor da condição.';
  if (typeof value === 'string' && value.includes('{{') && value.includes('}}')) return null;
  if (NUMERIC.has(operator)) {
    if ((typeof value !== 'number' && typeof value !== 'string') || !Number.isFinite(Number(value))) return 'Preencha um número finito para a condição.';
    if (operator === 'older_than_days' && Number(value) < 0) return 'O número de dias deve ser zero ou superior.';
  }
  if ((operator === 'before' || operator === 'after') && !validDate(value)) return 'Preencha uma data válida no formato AAAA-MM-DD ou ISO.';
  if (operator === 'contains_any') {
    const values: readonly unknown[] = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\n]/) : [];
    if (!values.some(item => typeof item === 'string' && item.trim().length > 0)) return 'Preencha pelo menos um valor na lista da condição.';
  }
  return null;
}
