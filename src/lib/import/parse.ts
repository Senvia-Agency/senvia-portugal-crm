// Reading the cells of an imported spreadsheet: headers, numbers, dates and identifiers
// written the many ways people write them in Portugal.

/** "Data de Venda" → "datadevenda": what headers are compared by. */
export function normalizeHeader(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface ImportFieldAliases {
  readonly key: string;
  readonly aliases: readonly string[];
}

/** Picks, for each field, the file column whose header is one of its aliases. */
export function autoMapColumns(fields: readonly ImportFieldAliases[], headers: readonly string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const taken = new Set<string>();
  for (const field of fields) {
    const aliases = field.aliases.map(normalizeHeader);
    const match = headers.find((header) => !taken.has(header) && aliases.includes(normalizeHeader(header)));
    if (match) {
      mapping[field.key] = match;
      taken.add(match);
    }
  }
  return mapping;
}

/** "1.234,56 €", "1234.56", "1 234" → number; null when the cell is empty or not a number. */
export function parseImportNumber(raw: string | null | undefined): number | null {
  const text = String(raw ?? '').replace(/[€\s]/g, '');
  if (!text) return null;
  let normalized = text;
  if (text.includes(',') && text.includes('.')) {
    // Whichever comes last is the decimal mark.
    normalized = text.lastIndexOf(',') > text.lastIndexOf('.')
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  } else if (text.includes(',')) {
    normalized = text.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    // "1.234" is a thousand, not one point two.
    normalized = text.replace(/\./g, '');
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
};

/**
 * "31/12/2025", "31-12-25", "2025-12-31" or an Excel day number (45657) → "2025-12-31".
 * Day first, as dates are written in Portugal. Null when the cell is empty or unreadable.
 */
export function parseImportDate(raw: string | null | undefined): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    // Excel counts days from 1899-12-30.
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(text)) * 86_400_000);
    return isoDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) return isoDay(Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/);
  if (match) {
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return isoDay(year, Number(match[2]), Number(match[1]));
  }
  return null;
}

export function cleanImportText(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

export function cleanImportEmail(raw: string | null | undefined): string | null {
  const text = cleanImportText(raw).toLowerCase();
  return text || null;
}

export function isValidImportEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Digits only: "PT 501 234 567" → "501234567". */
export function cleanImportNif(raw: string | null | undefined): string | null {
  const digits = String(raw ?? '').replace(/^\s*PT/i, '').replace(/\D/g, '');
  return digits || null;
}

/**
 * Matches a cell against labelled options by key or by label, ignoring case and accents;
 * synonyms cover how other systems name the same thing ("Em curso" for "Em Progresso").
 */
export function matchImportOption<T extends string>(
  raw: string | null | undefined,
  options: Record<T, string>,
  synonyms: Readonly<Record<string, T>> = {},
): T | null {
  const wanted = normalizeHeader(String(raw ?? ''));
  if (!wanted) return null;
  for (const [key, label] of Object.entries(options) as [T, string][]) {
    if (normalizeHeader(key) === wanted || normalizeHeader(label) === wanted) return key;
  }
  for (const [synonym, key] of Object.entries(synonyms)) {
    if (normalizeHeader(synonym) === wanted) return key;
  }
  return null;
}

/** "2025-12-31" → "31/12/2025", for showing what a line will become. */
export function formatImportDay(iso: string | null | undefined): string | null {
  const match = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}
