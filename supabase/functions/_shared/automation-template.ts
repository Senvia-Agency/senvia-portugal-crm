export interface AutomationTemplateResult {
  readonly text: string;
  readonly missing: readonly string[];
  readonly invalid: readonly string[];
}
const currency = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
const dateFormatter = new Intl.DateTimeFormat('pt-PT', { dateStyle: 'long', timeZone: 'Europe/Lisbon' });
function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function lookup(variables: Readonly<Record<string, unknown>>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(variables, key)) return variables[key];
  return key.split('.').reduce<unknown>((value, part) => record(value) && Object.prototype.hasOwnProperty.call(value, part) ? value[part] : undefined, variables);
}
function segments(expression: string): readonly string[] | null {
  const parts: string[] = [];
  let value = '', quoted = false, escaped = false;
  for (const character of expression) {
    if (escaped) { value += character; escaped = false; continue; }
    if (character.charCodeAt(0) === 92 && quoted) { value += character; escaped = true; continue; }
    if (character === '"') quoted = !quoted;
    if (character === '|' && !quoted) { parts.push(value.trim()); value = ''; } else value += character;
  }
  if (quoted || escaped) return null;
  parts.push(value.trim());
  return parts.length <= 3 ? parts : null;
}
function number(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim().replace(/\s/g, '').replace(/€$/, '');
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  return /^[+-]?\d+(?:\.\d+)?$/.test(normalized) && Number.isFinite(Number(normalized)) ? Number(normalized) : null;
}
function date(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return null;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) return null;
  if (value.length > 10 && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const result = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isFinite(result.getTime()) ? result : null;
}
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character] ?? character);
}
export function renderAutomationTemplate(
  template: string,
  variables: Readonly<Record<string, unknown>>,
  html = false,
): AutomationTemplateResult {
  const missing = new Set<string>(), invalid = new Set<string>();
  const text = template.replace(/\{\{([^{}]{1,512})\}\}/g, (_token, expression: string) => {
    const parts = segments(expression);
    if (!parts || !/^[\w:]+(?:\.[\w:]+)*$/.test(parts[0])) { invalid.add(expression.trim()); return ''; }
    const key = parts[0];
    let value = lookup(variables, key);
    let format: 'moeda' | 'data' | null = null;
    let defaultUsed = false;
    for (const part of parts.slice(1)) {
      if (part.startsWith('"') && !defaultUsed && format === null) {
        let fallback: unknown;
        try { fallback = JSON.parse(part); } catch { invalid.add(expression.trim()); return ''; }
        if (typeof fallback !== 'string') { invalid.add(expression.trim()); return ''; }
        defaultUsed = true;
        if (value === undefined || value === null || value === '' || (typeof value === 'string' && !value.trim())) value = fallback;
      } else if ((part === 'moeda' || part === 'data') && format === null) format = part;
      else { invalid.add(expression.trim()); return ''; }
    }
    if (value === undefined || value === null) { missing.add(key); return ''; }
    let rendered: string;
    switch (format) {
      case 'moeda': { const amount = number(value); if (amount === null) { missing.add(key); return ''; } rendered = currency.format(amount); break; }
      case 'data': { const instant = date(value); if (!instant) { missing.add(key); return ''; } rendered = dateFormatter.format(instant); break; }
      default: rendered = String(value);
    }
    return html ? escapeHtml(rendered) : rendered;
  });
  return { text, missing: [...missing], invalid: [...invalid] };
}
