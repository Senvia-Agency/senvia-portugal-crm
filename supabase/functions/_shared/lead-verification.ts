import { applySenviaEmailTemplate } from './senvia-email-template.ts';

const CODE_PREFIX = 'SENVIA CONFIRMAR ';
const CODE_PATTERN = /^[0-9a-f]{32}$/i;

export interface LeadVerificationSecrets {
  readonly emailToken: string;
  readonly emailTokenHash: string;
  readonly whatsappCode: string;
  readonly whatsappCodeHash: string;
}

export interface LeadVerificationPayload {
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly gdpr_consent: true;
  readonly public_key: string;
  readonly form_id: string | null;
  readonly source: string;
  readonly notes: string | null;
  readonly custom_data: Record<string, unknown>;
  readonly hp_website: '';
  readonly hp_tempo_ms: number;
}

export interface LeadVerificationChallenge {
  readonly id: string;
  readonly organizationId: string;
  readonly payload: LeadVerificationPayload | null;
  readonly phoneDigits: string | null;
  readonly emailTokenHash: string | null;
  readonly whatsappCodeHash: string | null;
  readonly emailVerifiedAt: string | null;
  readonly whatsappVerifiedAt: string | null;
  readonly expiresAt: string;
  readonly finalizedLeadId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function digest(value: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

async function hmac(key: string, value: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value))));
}

export async function createLeadVerificationSecrets(serviceKey: string): Promise<LeadVerificationSecrets> {
  const random = crypto.getRandomValues(new Uint8Array(32));
  const emailToken = toHex(random);
  const whatsappCode = (await hmac(serviceKey, `lead-verification-whatsapp:${emailToken}`)).slice(0, 32);
  return {
    emailToken,
    emailTokenHash: await digest(emailToken),
    whatsappCode,
    whatsappCodeHash: await hmac(serviceKey, `lead-verification-code-index:${whatsappCode}`),
  };
}

export async function leadVerificationEmailTokenHash(token: string): Promise<string> {
  return digest(token.trim().toLowerCase());
}

export async function leadVerificationWhatsAppCodeHash(code: string, serviceKey: string): Promise<string | null> {
  const normalized = code.trim().toLowerCase();
  if (!CODE_PATTERN.test(normalized)) return null;
  return hmac(serviceKey, `lead-verification-code-index:${normalized}`);
}

export async function leadVerificationWhatsAppCode(emailToken: string, serviceKey: string): Promise<string> {
  return (await hmac(serviceKey, `lead-verification-whatsapp:${emailToken.trim().toLowerCase()}`)).slice(0, 32);
}

export async function leadVerificationRateLimitKey(value: string, serviceKey: string): Promise<string> {
  return hmac(serviceKey, `lead-verification-rate:${value.trim().toLowerCase()}`);
}

export function parseLeadVerificationCode(content: string): string | null {
  const message = content.trim();
  if (!message.toUpperCase().startsWith(CODE_PREFIX)) return null;
  const code = message.slice(CODE_PREFIX.length).trim().toLowerCase();
  return CODE_PATTERN.test(code) ? code : null;
}

export function isLeadVerificationMessage(content: string): boolean {
  return content.trim().toUpperCase().startsWith(CODE_PREFIX);
}

export function leadVerificationWhatsAppUrl(destination: string, code: string): string | null {
  const phone = destination.replace(/\D/g, '');
  if (phone.length < 8 || phone.length > 15 || !CODE_PATTERN.test(code)) return null;
  const text = `${CODE_PREFIX}${code.toLowerCase()}`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export async function leadVerificationFinalizeSignature(id: string, serviceKey: string): Promise<string> {
  return hmac(serviceKey, `lead-verification-finalize:${id}`);
}

export async function finalizeVerifiedLead(
  id: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<string | null> {
  const response = await fetch(`${supabaseUrl}/functions/v1/submit-lead`, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json',
      'x-senvia-lead-verification': await leadVerificationFinalizeSignature(id, serviceKey),
    },
    body: JSON.stringify({ verification_id: id }),
  });
  if (!response.ok) return null;
  const result: unknown = await response.json();
  if (!isRecord(result) || typeof result.lead_id !== 'string') return null;
  return result.lead_id;
}

export function isEqualSecret(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export function parseLeadVerificationChallenge(value: unknown): LeadVerificationChallenge | null {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.organization_id !== 'string'
    || typeof value.expires_at !== 'string') return null;
  const emailTokenHash = value.email_token_hash;
  const whatsappCodeHash = value.whatsapp_code_hash;
  const phoneDigits = value.phone_digits;
  const emailVerifiedAt = value.email_verified_at;
  const whatsappVerifiedAt = value.whatsapp_verified_at;
  const finalizedLeadId = value.finalized_lead_id;
  if ((emailTokenHash !== null && typeof emailTokenHash !== 'string')
    || (whatsappCodeHash !== null && typeof whatsappCodeHash !== 'string')
    || (phoneDigits !== null && typeof phoneDigits !== 'string')
    || (emailVerifiedAt !== null && typeof emailVerifiedAt !== 'string')
    || (whatsappVerifiedAt !== null && typeof whatsappVerifiedAt !== 'string')
    || (finalizedLeadId !== null && typeof finalizedLeadId !== 'string')) return null;
  return {
    id: value.id,
    organizationId: value.organization_id,
    payload: parseLeadVerificationPayload(value.payload),
    phoneDigits,
    emailTokenHash,
    whatsappCodeHash,
    emailVerifiedAt,
    whatsappVerifiedAt,
    expiresAt: value.expires_at,
    finalizedLeadId,
  };
}

export async function sendLeadVerificationEmail(input: {
  readonly apiKey: string;
  readonly senderEmail: string;
  readonly senderName: string;
  readonly recipient: string;
  readonly confirmationUrl: string;
}): Promise<boolean> {
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#172033;line-height:1.6">
      <h1 style="font-size:22px;margin:0 0 16px">Confirme o seu email</h1>
      <p>Recebemos o seu pedido de contacto com a Senvia Agency.</p>
      <p>Confirme que este endereço de email lhe pertence. Depois, poderá confirmar o telefone ao iniciar uma conversa no WhatsApp.</p>
      <p style="margin:24px 0">
        <a href="${input.confirmationUrl}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600">Confirmar email</a>
      </p>
      <p style="font-size:13px;color:#667085">O link expira em 24 horas. Se não pediu este contacto, ignore esta mensagem.</p>
    </div>`;
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { 'Content-Type': 'application/json', 'api-key': input.apiKey },
    body: JSON.stringify({
      sender: { email: input.senderEmail, name: input.senderName },
      to: [{ email: input.recipient }],
      subject: 'Confirma o teu email — Senvia Agency',
      htmlContent: applySenviaEmailTemplate(html, 'Confirmação de contacto'),
    }),
  });
  return response.ok;
}

export function parseLeadVerificationPayload(value: unknown): LeadVerificationPayload | null {
  if (!isRecord(value)) return null;
  const payload = value;
  if (typeof payload.name !== 'string' || typeof payload.email !== 'string' || typeof payload.phone !== 'string'
    || payload.gdpr_consent !== true || typeof payload.public_key !== 'string'
    || (payload.form_id !== null && typeof payload.form_id !== 'string')
    || typeof payload.source !== 'string' || (payload.notes !== null && typeof payload.notes !== 'string')
    || !isRecord(payload.custom_data)) return null;
  return {
    name: payload.name,
    email: payload.email,
    phone: payload.phone,
    gdpr_consent: true,
    public_key: payload.public_key,
    form_id: payload.form_id,
    source: payload.source,
    notes: payload.notes,
    custom_data: payload.custom_data,
    hp_website: '',
    hp_tempo_ms: 2500,
  };
}
