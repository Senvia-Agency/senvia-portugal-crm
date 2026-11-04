// Formatting utilities. Dates and numbers follow the chosen language (pt-PT by default).
import { intlLocale, tr } from "@/i18n";

/**
 * Parse a localized number string (PT/EN formats) into a JS number.
 * Handles: "1.376,59" | "1 376,59" | "1,376.59" | "1376,59" | "1376.59"
 */
export function parseLocalizedNumber(value: string): number {
  if (!value || !value.trim()) return 0;
  // Remove spaces
  let cleaned = value.replace(/\s/g, '');
  // Find last comma and last dot
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  if (lastComma > lastDot) {
    // Comma is decimal separator (PT format: 1.376,59)
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    // Dot is decimal separator (EN format: 1,376.59)
    cleaned = cleaned.replace(/,/g, '');
  }
  const result = parseFloat(cleaned);
  return isNaN(result) ? 0 : result;
}

/**
 * Format date to PT-PT format (DD/MM/YYYY)
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString(intlLocale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Human label for the subscription cycle a Stripe payment covers ("Jul 2026" or
 * "Jun 2026 – Jul 2026"), independent of the day it was actually charged.
 * Stripe bills in advance, so a charge dated at the end of one month often pays
 * for the next cycle (or, when recovered late, the cycle that just ended) — the
 * charge date alone reads as "wrong month" without this. Returns null when
 * Stripe did not supply a billing period (manual/non-Stripe payments).
 */
export function billingPeriodLabel(start?: string | null, end?: string | null): string | null {
  if (!start || !end) return null;
  // `new Date("YYYY-MM-DD")` parses as UTC midnight; formatting that back in a
  // negative-offset local timezone can roll it back to the previous day and
  // silently misreport the month for dates near a month boundary. Parsing the
  // date-only string as LOCAL midnight (matching how the date picker/DB column
  // is meant to be read) avoids that.
  const [sY, sM, sD] = start.split('-').map(Number);
  const [eY, eM, eD] = end.split('-').map(Number);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', year: 'numeric' };
  const sLabel = new Date(sY, sM - 1, sD).toLocaleDateString(intlLocale(), opts);
  const eLabel = new Date(eY, eM - 1, eD).toLocaleDateString(intlLocale(), opts);
  return sLabel === eLabel ? sLabel : `${sLabel} – ${eLabel}`;
}

/**
 * Format date with time to PT-PT format
 */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString(intlLocale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format currency to Euro (€)
 */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat(intlLocale(), {
    style: 'currency',
    currency: 'EUR',
  }).format(value);
}

/**
 * Format phone number for WhatsApp link
 * Removes spaces, dashes, and ensures country code
 */
export function formatPhoneForWhatsApp(phone: string): string {
  // Remove all non-numeric characters
  let cleaned = phone.replace(/\D/g, '');
  
  // If starts with 00, replace with +
  if (cleaned.startsWith('00')) {
    cleaned = cleaned.substring(2);
  }
  
  // If Portuguese number without country code, add it
  if (cleaned.startsWith('9') && cleaned.length === 9) {
    cleaned = '351' + cleaned;
  }
  
  return cleaned;
}

/**
 * Format IBAN with spaces every 4 characters
 */
export function formatIban(value: string): string {
  const cleaned = value.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  return cleaned.match(/.{1,4}/g)?.join(' ') || cleaned;
}

/**
 * Strip IBAN formatting for storage
 */
export function cleanIban(value: string): string {
  return value.replace(/\s/g, '');
}

/**
 * Internal deep link to the CRM inbox conversation for a phone number.
 * Opens (or starts) the WhatsApp conversation inside the Caixa de Entrada.
 */
export function getInboxUrl(phone: string): string {
  const digits = formatPhoneForWhatsApp(phone);
  return `/inbox?phone=${digits}`;
}

/**
 * Generate WhatsApp URL
 */
export function getWhatsAppUrl(phone: string, message?: string): string {
  const formattedPhone = formatPhoneForWhatsApp(phone);
  const baseUrl = `https://wa.me/${formattedPhone}`;
  
  if (message) {
    return `${baseUrl}?text=${encodeURIComponent(message)}`;
  }
  
  return baseUrl;
}

/**
 * Format relative time in PT-PT
 */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return tr('Agora mesmo');
  if (diffMins < 60) return tr(diffMins === 1 ? 'Há {{n}} minuto' : 'Há {{n}} minutos', { n: diffMins });
  if (diffHours < 24) return tr(diffHours === 1 ? 'Há {{n}} hora' : 'Há {{n}} horas', { n: diffHours });
  if (diffDays < 7) return tr(diffDays === 1 ? 'Há {{n}} dia' : 'Há {{n}} dias', { n: diffDays });
  
  return formatDate(d);
}
