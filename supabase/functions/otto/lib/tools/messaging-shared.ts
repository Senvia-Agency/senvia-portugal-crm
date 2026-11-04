import type { ToolResult } from "../types.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export const MESSAGING_DATABASE_ERROR = {
  error: "Caixa de Entrada indisponível",
  reason_code: "database_unavailable",
  _instruction: "A operação NÃO foi confirmada. Não inventes estado de entrega e não repitas automaticamente.",
} as const;

export type MessagingEmailAddress = {
  readonly name: string;
  readonly address: string;
};

export function messagingIsRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function messagingUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

export function messagingText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maximumLength ? trimmed : null;
}

export function messagingEmailAddresses(
  value: unknown,
  allowEmpty: boolean,
): readonly MessagingEmailAddress[] | null {
  if (!Array.isArray(value) || value.length > 50 || (!allowEmpty && value.length === 0)) return null;
  const addresses: MessagingEmailAddress[] = [];
  for (const item of value) {
    if (!messagingIsRecord(item) || typeof item.address !== "string") return null;
    const address = item.address.trim().toLowerCase();
    const name = typeof item.name === "string" ? item.name.trim().slice(0, 200) : "";
    if (!EMAIL_PATTERN.test(address)) return null;
    addresses.push({ name, address });
  }
  return addresses;
}

export function messagingPreviewText(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function messagingResource(type: string, id: string): ToolResult {
  return { resource: { type, id, route: "/inbox" } };
}
