export type FiscalEmailStatus = 'delivered' | 'bounced' | 'blocked' | 'suppressed'

const STATUS_BY_EVENT: Record<string, FiscalEmailStatus> = {
  delivered: 'delivered',
  hard_bounce: 'bounced',
  soft_bounce: 'bounced',
  bounced: 'bounced',
  blocked: 'blocked',
  spam: 'blocked',
  unsubscribed: 'suppressed',
}

export function fiscalStatusForBrevoEvent(event: unknown): FiscalEmailStatus | null {
  return STATUS_BY_EVENT[String(event || '').trim().toLowerCase()] || null
}

function parsedTimestamp(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value).trim())) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) return null
    const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000
    const date = new Date(millis)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const raw = String(value).trim()
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

export function brevoFiscalEventAt(payload: Record<string, unknown>, fallback = new Date()): string {
  for (const candidate of [payload.ts_event, payload.ts, payload.timestamp, payload.eventTime, payload.date]) {
    const parsed = parsedTimestamp(candidate)
    if (parsed) return parsed.toISOString()
  }
  return fallback.toISOString()
}

export function safeFiscalEventData(payload: Record<string, unknown>): Record<string, unknown> {
  const event = String(payload.event || '').trim().toLowerCase()
  const reason = String(payload.reason || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 240)
  return {
    provider: 'brevo',
    event,
    ...(reason ? { reason } : {}),
  }
}
