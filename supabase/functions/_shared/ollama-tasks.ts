import { z } from 'npm:zod@3.25.76';

export class OllamaTaskError extends Error {
  constructor(readonly code: string) { super(code); }
}
const decisionSchema = z.object({ tarefa: z.boolean(), titulo: z.string().max(100), confianca: z.number().min(0).max(1), prazo_texto: z.string().max(120).nullable(), prazo_explicito: z.boolean() }).strict();
type Input = { readonly sender: 'CLIENTE' | 'COMERCIAL'; readonly message: string; readonly messageDate: string };
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function resolveExplicitDeadline(text: string | null, messageDate: string): string | null {
  if (!text) return null;
  const source = new Date(messageDate);
  if (!Number.isFinite(source.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(source);
  const get = (name: string) => Number(parts.find(part => part.type === name)?.value);
  let civil = new Date(Date.UTC(get('year'), get('month') - 1, get('day'), 12));
  const value = normalize(text);
  const time = value.match(/(?:as\s+)?(\d{1,2})(?:h(?:(\d{2}))?|:(\d{2}))/);
  const hour = time ? Number(time[1]) : 23;
  const minute = time ? Number(time[2] ?? time[3] ?? 0) : 59;
  if (hour > 23 || minute > 59) return null;
  const date = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s|$)/);
  if (date) {
    const day = Number(date[1]), month = Number(date[2]), year = Number(date[3]);
    civil = new Date(Date.UTC(year, month - 1, day, 12));
    if (civil.getUTCDate() !== day || civil.getUTCMonth() !== month - 1 || civil.getUTCFullYear() !== year) return null;
  } else if (/^amanha(?:\s|$)/.test(value)) {
    civil.setUTCDate(civil.getUTCDate() + 1);
  } else if (!/^hoje(?:\s|$)/.test(value)) {
    const days = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'] as const;
    const weekday = days.findIndex(day => new RegExp(String.raw`^(?:proxima?\s+)?${day}(?:-feira)?(?:\s|$)`).test(value));
    if (weekday < 0) return null;
    const difference = (weekday - civil.getUTCDay() + 7) % 7;
    civil.setUTCDate(civil.getUTCDate() + (difference === 0 && /^proxima?/.test(value) ? 7 : difference));
  }
  const wallTime = Date.UTC(civil.getUTCFullYear(), civil.getUTCMonth(), civil.getUTCDate(), hour, minute);
  const formatter = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Lisbon', timeZoneName: 'shortOffset', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  let instant = wallTime;
  for (let attempt = 0; attempt < 4; attempt++) {
    const values = formatter.formatToParts(new Date(instant));
    const offset = values.find(part => part.type === 'timeZoneName')?.value.match(/^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/);
    if (!offset) return null;
    const minutes = (Number(offset[2] ?? 0) * 60 + Number(offset[3] ?? 0)) * (offset[1] === '-' ? -1 : 1);
    const next = wallTime - minutes * 60000;
    if (next === instant) break;
    instant = next;
  }
  const local = formatter.formatToParts(new Date(instant));
  const part = (name: string) => Number(local.find(value => value.type === name)?.value);
  if (part('year') !== civil.getUTCFullYear() || part('month') !== civil.getUTCMonth() + 1 || part('day') !== civil.getUTCDate() || part('hour') !== hour || part('minute') !== minute) return null;
  return new Date(instant).toISOString();
}

export async function classifyOllamaTask(input: Input, endpoint: string, key: string) {
  const target = z.string().url().safeParse(endpoint);
  if (!target.success || new URL(endpoint).protocol !== 'https:' || !key) throw new OllamaTaskError('AI_NOT_CONFIGURED');
  const response = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(100_000), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sender: input.sender, message: input.message }) });
  if (!response.ok) throw new OllamaTaskError(`AI_UNAVAILABLE_HTTP_${response.status}`);
  let value: unknown;
  try { value = await response.json(); } catch { throw new OllamaTaskError('AI_INVALID_RESPONSE'); }
  const parsed = decisionSchema.safeParse(value);
  if (!parsed.success) throw new OllamaTaskError('AI_INVALID_DECISION');
  const out = parsed.data;
  const explicit = out.prazo_explicito && out.prazo_texto && normalize(input.message).includes(normalize(out.prazo_texto));
  const deadline = explicit ? resolveExplicitDeadline(out.prazo_texto, input.messageDate) : null;
  return { tarefa: out.tarefa && out.confianca >= .85, titulo: out.titulo, confianca: out.confianca, prazo_iso: deadline, prazo_explicito: deadline !== null };
}
