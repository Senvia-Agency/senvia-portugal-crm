import type { ToolResult } from "../types.ts";

export const CALENDAR_INBOX_DATABASE_ERROR = {
  error: "Agenda ou tarefas indisponíveis",
  reason_code: "database_unavailable",
  _instruction: "A operação NÃO foi concluída. Informa o utilizador e não inventes dados.",
} as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_INSTANT_PATTERN = /T.*(?:Z|[+-]\d{2}:\d{2})$/;

export function calendarInboxIsRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function calendarInboxUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

export function calendarInboxText(
  value: unknown,
  maximumLength: number,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maximumLength ? trimmed : null;
}

export function calendarInboxIsoInstant(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_INSTANT_PATTERN.test(value)) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

export function calendarInboxHasOwn(
  value: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function calendarInboxResource(
  type: string,
  id: string,
  route: "/calendar" | "/inbox",
): ToolResult {
  return { resource: { type, id, route } };
}
