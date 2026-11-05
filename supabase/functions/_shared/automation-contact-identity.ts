export interface AutomationContactIdentity {
  readonly phoneKey?: string | null;
  readonly email?: string | null;
  readonly id?: string | null;
}
export class InvalidAutomationContactIdentity extends Error {}
export function normalizedAutomationEmail(email?: string | null): string | null {
  return email?.trim().toLowerCase() || null;
}
export function contactRunIdentityFilter(subject: AutomationContactIdentity) {
  if (subject.phoneKey) return { column: 'contact_phone_key', value: subject.phoneKey, insensitive: false };
  const email = normalizedAutomationEmail(subject.email);
  if (email) return { column: 'contact_email', value: email.replace(/[\%_]/g, '\$&'), insensitive: true };
  if (subject.id) return { column: 'subject_id', value: subject.id, insensitive: false };
  throw new InvalidAutomationContactIdentity('Não foi possível identificar o contacto para verificar a inscrição.');
}
/** Name-based UUIDv8 using SHA-256; identity is scoped to the organization. */
export async function automationContactSubjectId(organizationId: string, subject: AutomationContactIdentity): Promise<string> {
  const email = normalizedAutomationEmail(subject.email);
  const identity = subject.phoneKey ? `phone:${subject.phoneKey}` : email ? `email:${email}` : null;
  if (!identity) {
    if (subject.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subject.id)) return subject.id;
    throw new InvalidAutomationContactIdentity('O contacto precisa de telefone, email ou identificador válido.');
  }
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`senvia-automation-contact\0${organizationId}\0${identity}`))).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 128;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
