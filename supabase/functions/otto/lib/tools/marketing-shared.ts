import type { ToolContext, ToolResult } from "../types.ts";

export type MarketingContact = {
  readonly id: string;
  readonly organization_id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly company: string | null;
  readonly subscribed: boolean;
};

export type MarketingAudience = {
  readonly contacts: readonly MarketingContact[];
  readonly digest: string;
  readonly listIds: readonly string[];
};

export type MarketingCampaignContentSnapshot = {
  readonly subject: string;
  readonly htmlContent: string;
  readonly settings: Readonly<Record<string, boolean>>;
  readonly settingsData: Readonly<Record<string, string>>;
};

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_AUDIENCE_SIZE = 500;
export const MARKETING_TEMPLATE_COLUMNS = "id, organization_id, name, subject, category, category_id, variables, is_active, created_at, updated_at, created_by, automation_enabled, automation_trigger_type, automation_trigger_config, automation_delay_minutes";
export const MARKETING_TEMPLATE_DETAIL_COLUMNS = `${MARKETING_TEMPLATE_COLUMNS}, html_content`;
export const CAMPAIGN_COLUMNS = "id, organization_id, name, template_id, subject, html_content, status, total_recipients, sent_count, failed_count, scheduled_at, sent_at, created_by, created_at, updated_at, settings, settings_data";
export const SEND_RESULT_COLUMNS = "id, campaign_id, template_id, recipient_email, recipient_name, status, sent_at, created_at, opened_at, clicked_at";

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringArg(args: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function stringArrayArg(args: Readonly<Record<string, unknown>>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && UUID_RE.test(item.trim())).map((item) => item.trim()))];
}

export function stringRecordArg(args: Readonly<Record<string, unknown>>, key: string): Record<string, string> {
  const value = args[key];
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export function boolRecordArg(args: Readonly<Record<string, unknown>>, key: string): Record<string, boolean> {
  const value = args[key];
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
}

export function jsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function resultError(message: string, reasonCode = "marketing_unavailable"): ToolResult {
  return {
    error: message,
    reason_code: reasonCode,
    _instruction: "Não foi possível concluir a operação de marketing. Informa o utilizador e NÃO inventes dados.",
  };
}

export function asContact(value: unknown): MarketingContact | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.organization_id !== "string" || typeof value.name !== "string") return null;
  return {
    id: value.id,
    organization_id: value.organization_id,
    name: value.name,
    email: typeof value.email === "string" ? value.email : null,
    phone: typeof value.phone === "string" ? value.phone : null,
    company: typeof value.company === "string" ? value.company : null,
    subscribed: value.subscribed === true,
  };
}

export async function audienceDigest(contacts: readonly MarketingContact[]): Promise<string> {
  const snapshot = contacts
    .map((contact) => ({
      id: contact.id,
      organization_id: contact.organization_id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      company: contact.company,
      subscribed: contact.subscribed,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function campaignContentDigest(
  snapshot: MarketingCampaignContentSnapshot,
): Promise<string> {
  const canonical = {
    subject: snapshot.subject,
    html_content: snapshot.htmlContent,
    settings: Object.fromEntries(Object.entries(snapshot.settings).sort(([left], [right]) => left.localeCompare(right))),
    settings_data: Object.fromEntries(Object.entries(snapshot.settingsData).sort(([left], [right]) => left.localeCompare(right))),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function resolveAudience(
  args: Readonly<Record<string, unknown>>,
  ctx: ToolContext,
): Promise<{ readonly ok: true; readonly audience: MarketingAudience } | { readonly ok: false; readonly result: ToolResult }> {
  const contactIds = stringArrayArg(args, "contact_ids");
  const listIds = stringArrayArg(args, "list_ids");
  const singleListId = stringArg(args, "list_id");
  const requestedListIds = [...new Set([...listIds, ...(singleListId && UUID_RE.test(singleListId) ? [singleListId] : [])])];
  if (contactIds.length === 0 && requestedListIds.length === 0) return { ok: false, result: resultError("Indica contactos ou uma lista de marketing.", "audience_missing") };

  const contacts = new Map<string, MarketingContact>();
  if (contactIds.length > 0) {
    const { data, error } = await ctx.supabaseAdmin
      .from("marketing_contacts")
      .select("id, organization_id, name, email, phone, company, subscribed")
      .eq("organization_id", ctx.orgId)
      .in("id", contactIds)
      .eq("subscribed", true)
      .limit(MAX_AUDIENCE_SIZE);
    if (error) return { ok: false, result: resultError("Não foi possível ler os contactos de marketing.") };
    for (const row of data ?? []) {
      const contact = asContact(row);
      if (contact?.email && contact.organization_id === ctx.orgId) contacts.set(contact.id, contact);
    }
  }

  if (requestedListIds.length > 0) {
    const { data: lists, error: listError } = await ctx.supabaseAdmin
      .from("client_lists")
      .select("id")
      .eq("organization_id", ctx.orgId)
      .in("id", requestedListIds);
    if (listError) return { ok: false, result: resultError("Não foi possível ler as listas de marketing.") };
    if ((lists ?? []).length !== requestedListIds.length) return { ok: false, result: resultError("Uma ou mais listas não pertencem à organização atual.", "audience_scope_mismatch") };
    const { data: members, error: memberError } = await ctx.supabaseAdmin
      .from("marketing_list_members")
      .select("contact_id, contact:marketing_contacts(id, organization_id, name, email, phone, company, subscribed)")
      .in("list_id", requestedListIds)
      .limit(MAX_AUDIENCE_SIZE);
    if (memberError) return { ok: false, result: resultError("Não foi possível ler os membros das listas.") };
    for (const row of members ?? []) {
      const contact = asContact(row.contact);
      if (contact?.email && contact.organization_id === ctx.orgId && contact.subscribed) contacts.set(contact.id, contact);
    }
  }

  const resolved = [...contacts.values()].slice(0, MAX_AUDIENCE_SIZE);
  if (resolved.length === 0) return { ok: false, result: resultError("Não existem contactos subscritos com email válido nessa audiência.", "audience_empty") };
  return { ok: true, audience: { contacts: resolved, digest: await audienceDigest(resolved), listIds: requestedListIds } };
}

export function verifyAudienceDigest(args: Readonly<Record<string, unknown>>, audience: MarketingAudience): ToolResult | null {
  const requested = stringArg(args, "audience_digest");
  if (!requested) return resultError("A audiência precisa de uma prévia nativa antes de confirmar o envio.", "audience_digest_required");
  if (requested !== audience.digest) return resultError("A audiência mudou desde a pré-visualização. Pede uma nova prévia antes de confirmar.", "audience_changed");
  return null;
}

export function campaignAudienceArgs(settingsData: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(settingsData)) return {};
  const mode = typeof settingsData.audience_mode === "string" ? settingsData.audience_mode : "";
  const listIds = jsonArray(settingsData.audience_list_ids).filter((item): item is string => typeof item === "string" && UUID_RE.test(item));
  const selected = jsonArray(settingsData.audience_selected_clients)
    .filter(isRecord)
    .map((row) => typeof row.id === "string" && row.id.startsWith("marketing_") ? row.id.slice("marketing_".length) : null)
    .filter((id): id is string => typeof id === "string" && UUID_RE.test(id));
  if (mode === "list" && listIds.length > 0) return { list_ids: listIds };
  if (selected.length > 0) return { contact_ids: selected };
  if (listIds.length > 0) return { list_ids: listIds };
  return {};
}

export async function configuredBrevo(ctx: ToolContext): Promise<{ readonly ok: true } | { readonly ok: false; readonly result: ToolResult }> {
  const { data, error } = await ctx.supabaseAdmin
    .from("organizations")
    .select("tem_brevo_api_key, brevo_sender_email")
    .eq("id", ctx.orgId)
    .maybeSingle();
  if (error || !data) return { ok: false, result: resultError("Não foi possível verificar a configuração do email marketing.") };
  if (data.tem_brevo_api_key !== true || typeof data.brevo_sender_email !== "string" || !data.brevo_sender_email.trim()) {
    return { ok: false, result: { ...resultError("Configure o Brevo e um remetente verificado antes de enviar.", "brevo_not_configured"), destination: "/settings" } };
  }
  return { ok: true };
}

export function confirmationPreview(title: string, summary: string, destination: `/${string}` = "/marketing"): { kind: "confirmation_required"; preview: () => Promise<{ title: string; summary: string; destination: `/${string}` }> } {
  return { kind: "confirmation_required", preview: async () => ({ title, summary, destination }) };
}
