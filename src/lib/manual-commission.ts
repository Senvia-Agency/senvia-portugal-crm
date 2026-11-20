/**
 * Manual commission (BDS): the seller builds the commission sum on the sale.
 * Contract: docs/comissao-manual-contrato.md. The database
 * (evaluate_manual_commission) recomputes and validates the same sum from the
 * tokens and owns the final value; this mirror only gives the live result.
 */
import { addDays, format, getDay, parseISO } from 'date-fns';

export type FormulaOp = '+' | '-' | '*' | '/';

/** The database refuses a bad sum with HINT 'manual_commission' and a message ready to show. */
export function manualCommissionErrorMessage(error: unknown): string | null {
  const e = error as { hint?: string; message?: string } | null;
  return e?.hint === 'manual_commission' && e.message ? e.message : null;
}

/** Number, operator, or (in a service's model only) a box the seller fills. */
export type FormulaToken =
  | { t: 'num'; v: number; label?: string }
  | { t: 'op'; v: FormulaOp }
  | { t: 'slot'; label?: string };

export type CommissionPayout = 'monthly' | 'weekly';

/** While editing, a number box may still be empty. */
export type DraftToken =
  | { t: 'num'; v: number | null; label?: string; slot?: boolean }
  | { t: 'op'; v: FormulaOp };

export const MAX_FORMULA_NUMBERS = 25;
export const MAX_FORMULA_ABS = 1_000_000_000;

export const OP_SYMBOL: Record<FormulaOp, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };

export type FormulaError = 'empty' | 'shape' | 'too_long' | 'blank' | 'invalid_number' | 'division_by_zero' | 'negative' | 'too_large';

/** pt-PT i18n keys, same wording as the database errors. */
export const FORMULA_ERROR_MESSAGES: Record<FormulaError, string> = {
  empty: 'Monte a conta da comissão.',
  shape: 'A conta está incompleta ou mal formada.',
  too_long: 'A conta pode ter no máximo 25 números.',
  blank: 'Preencha todos os números da conta.',
  invalid_number: 'A conta tem um número inválido (até 4 casas decimais).',
  division_by_zero: 'A conta divide por zero.',
  negative: 'A comissão não pode ser negativa.',
  too_large: 'A comissão é demasiado alta.',
};

export type FormulaResult = { ok: true; amount: number; error?: undefined } | { ok: false; error: FormulaError; amount?: undefined };

/**
 * round(x, 2) as PostgreSQL does on numeric: half away from zero. toPrecision
 * first clears binary noise, so 72,1 × 0,35 = 25,235 rounds to 25,24 like the
 * database and not to 25,23.
 */
const round2 = (n: number) => {
  const cents = Number((Math.abs(n) * 100).toPrecision(12));
  return (Math.sign(n) * Math.round(cents)) / 100;
};
/** At most 4 decimal places, as the database accepts (1e-7 too). */
const hasAtMost4Decimals = (n: number) => Number(n.toFixed(4)) === n;

/** × ÷ before + −, left to right, no parentheses — as evaluate_manual_commission. */
export function evaluateFormula(tokens: readonly DraftToken[]): FormulaResult {
  if (tokens.length === 0) return { ok: false, error: 'empty' };
  if (tokens.length % 2 === 0) return { ok: false, error: 'shape' };
  if ((tokens.length + 1) / 2 > MAX_FORMULA_NUMBERS) return { ok: false, error: 'too_long' };
  for (let i = 0; i < tokens.length; i++) {
    if ((i % 2 === 0) !== (tokens[i].t === 'num')) return { ok: false, error: 'shape' };
  }
  let total = 0;
  let addOp: FormulaOp = '+';
  let mulOp: FormulaOp | null = null;
  let term: number | null = null;
  for (const token of tokens) {
    if (token.t === 'num') {
      if (token.v == null) return { ok: false, error: 'blank' };
      if (!Number.isFinite(token.v) || Math.abs(token.v) > MAX_FORMULA_ABS || !hasAtMost4Decimals(token.v)) return { ok: false, error: 'invalid_number' };
      if (term == null) term = token.v;
      else if (mulOp === '*') term *= token.v;
      else {
        if (token.v === 0) return { ok: false, error: 'division_by_zero' };
        term /= token.v;
      }
      mulOp = null;
    } else if (token.v === '+' || token.v === '-') {
      total += addOp === '+' ? (term as number) : -(term as number);
      addOp = token.v;
      term = null;
    } else {
      mulOp = token.v;
    }
  }
  const amount = round2(total + (addOp === '+' ? (term as number) : -(term as number)));
  if (amount < 0) return { ok: false, error: 'negative' };
  if (amount > MAX_FORMULA_ABS) return { ok: false, error: 'too_large' };
  return { ok: true, amount: amount === 0 ? 0 : amount };
}

/** Readable sum, e.g. "200 × 0,15". Empty boxes show their label. */
export function formulaToText(tokens: readonly DraftToken[], locale = 'pt-PT'): string {
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 });
  return tokens.map(token => {
    if (token.t === 'op') return OP_SYMBOL[token.v];
    if (token.v == null) return token.label ? `[${token.label}]` : '[ ]';
    return nf.format(token.v);
  }).join(' ');
}

/** What a person types in a number box: "1.234,5", "0,15", "12.5". */
export function parseFormulaNumber(raw: string): number | null {
  const text = raw.trim().replace(/\s|€/g, '');
  if (!text) return null;
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  // A comma is the decimal mark. Without one, dots in groups of three are
  // thousands ("1.500" = 1500, "1.234.567"); any other dot is a decimal point.
  const normalized = body.includes(',')
    ? body.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(\.\d{3})+$/.test(body) ? body.replace(/\./g, '') : body;
  if (!/^\d*\.?\d+$|^\d+\.$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

/** Model on the service → draft for a new sale (boxes empty, fixed numbers kept). */
export function draftFromTemplate(template: readonly FormulaToken[] | null | undefined): DraftToken[] {
  if (!template?.length) return [{ t: 'num', v: null }];
  return template.map(token => token.t === 'slot' ? { t: 'num', v: null, label: token.label, slot: true } : { ...token });
}

/** The saved sum has the model's shape (same operators, same fixed numbers). */
export function followsTemplate(formula: readonly FormulaToken[] | null | undefined, template: readonly FormulaToken[] | null | undefined): boolean {
  if (!template?.length) return true;
  if (!formula?.length || formula.length !== template.length) return false;
  return template.every((t, i) => {
    const f = formula[i];
    if (t.t === 'slot') return f.t === 'num';
    if (t.t === 'num') return f.t === 'num' && f.v === t.v;
    return f.t === 'op' && f.v === t.v;
  });
}

/**
 * Saved sale sum → draft, marking which numbers are the model's boxes so only
 * those stay editable. Without a model every number is free.
 */
export function draftFromSale(formula: readonly FormulaToken[] | null | undefined, template: readonly FormulaToken[] | null | undefined): DraftToken[] {
  // No sum yet, or the service's model changed since: start from the model,
  // keeping the numbers already typed in the boxes where they still fit.
  if (!formula?.length) return draftFromTemplate(template);
  if (!followsTemplate(formula, template)) {
    const filled = formula.filter((t): t is Extract<FormulaToken, { t: 'num' }> => t.t === 'num');
    let i = 0;
    return draftFromTemplate(template).map(token => token.t === 'num' && token.slot ? { ...token, v: filled[i++]?.v ?? null } : token);
  }
  return formula.map((token, i) => {
    if (token.t !== 'num') return token.t === 'op' ? { ...token } : { t: 'num', v: null, label: token.label, slot: true };
    return { ...token, slot: template?.length ? template[i]?.t === 'slot' : undefined };
  });
}

/** Draft → tokens to save on the sale. Null while any box is empty or the sum is invalid. */
export function draftToFormula(draft: readonly DraftToken[]): FormulaToken[] | null {
  if (!evaluateFormula(draft).ok) return null;
  return draft.map(token => token.t === 'op' ? { ...token } : { t: 'num', v: token.v as number, ...(token.label ? { label: token.label } : {}) });
}

/** Draft from the catalog editor → model to save on the service. */
export function draftToTemplate(draft: readonly DraftToken[]): FormulaToken[] | null {
  if (draft.length === 0 || draft.length % 2 === 0) return null;
  const out: FormulaToken[] = [];
  for (let i = 0; i < draft.length; i++) {
    const token = draft[i];
    if ((i % 2 === 0) !== (token.t === 'num')) return null;
    if (token.t === 'op') { out.push({ ...token }); continue; }
    if (token.slot) out.push({ t: 'slot', ...(token.label ? { label: token.label } : {}) });
    else if (token.v == null) return null;
    else out.push({ t: 'num', v: token.v });
  }
  return out;
}

/** True when nothing was typed yet: the sale may be saved and the sum entered later. */
export function isDraftEmpty(draft: readonly DraftToken[]): boolean {
  return draft.every(token => token.t === 'op' || token.v == null);
}

/** Weekly payout: the Friday closing the Saturday-to-Friday week of the date. */
export function weeklyPayoutDate(date: string): string {
  const day = parseISO(date.slice(0, 10));
  return format(addDays(day, (5 - getDay(day) + 7) % 7), 'yyyy-MM-dd');
}
