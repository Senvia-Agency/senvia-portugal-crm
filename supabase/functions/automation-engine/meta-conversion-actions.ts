import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.2';
import type { CrmActionInput, CrmActionOutcome } from './crm-actions.ts';

export class InvalidMetaConversion extends Error {}
const allowedEvents = ['Lead', 'CompleteRegistration', 'ViewContent', 'Purchase'] as const;
export function conversionEvent(config: Readonly<Record<string, unknown>>): string {
  const event = String(config.event_name ?? '');
  if (!allowedEvents.some(value => value === event)) throw new InvalidMetaConversion('Escolha um evento Meta suportado.');
  return event;
}
export async function conversionEventId(input: CrmActionInput): Promise<string> {
  if (input.config.event_name === 'Purchase') {
    if (input.run.subject_type !== 'sale' || !input.run.subject_id) throw new InvalidMetaConversion('Purchase exige uma venda persistida.');
    return input.run.subject_id;
  }
  const subject = input.run.subject_id ?? input.run.contact_email ?? input.run.contact_phone;
  const node = input.config.__node_id;
  if (!subject || typeof node !== 'string' || !node) throw new InvalidMetaConversion('O evento exige contacto e passo identificáveis.');
  return await hash(JSON.stringify([input.run.organization_id, input.run.flow_id, input.run.id, node, subject]));
}
async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.trim().toLowerCase()));
  return Array.from(new Uint8Array(bytes), item => item.toString(16).padStart(2, '0')).join('');
}
function pixelAllowed(pixels: unknown, id: string): boolean {
  return Array.isArray(pixels) && pixels.some(pixel => typeof pixel === 'object' && pixel !== null && pixel.pixel_id === id && pixel.enabled === true);
}
export async function executeMetaConversionAction(db: SupabaseClient, input: CrmActionInput): Promise<CrmActionOutcome | null> {
  if (input.type !== 'meta_conversion') return null;
  const { run, config } = input;
  let eventId: string | null = null;
  let reserved = false;
  const pixelId = String(config.pixel_id ?? '');
  try {
    const event = conversionEvent(config);
    eventId = await conversionEventId(input);
    const { data: org, error: orgError } = await db.from('organizations').select('meta_pixels,meta_conversions_api_token')
      .eq('id', run.organization_id).maybeSingle();
    if (orgError || !org || !pixelAllowed(org.meta_pixels, pixelId)) throw new InvalidMetaConversion('Escolha um pixel ativo desta organização.');
    if (typeof org.meta_conversions_api_token !== 'string' || !org.meta_conversions_api_token) throw new InvalidMetaConversion('Configure a ligação Meta desta organização.');
    const userData: Record<string, unknown> = {};
    if (run.contact_email && !run.contact_email.endsWith('@placeholder.local')) userData.em = [await hash(run.contact_email)];
    const phone = (run.contact_phone ?? '').replace(/\D/g, '');
    if (phone.length >= 7 && phone.length <= 15 && !/^0+$/.test(phone)) userData.ph = [await hash(phone)];
    if (!Object.keys(userData).length) throw new InvalidMetaConversion('O contacto não tem identificadores válidos para correspondência Meta.');
    let customData: Record<string, unknown> | undefined;
    if (event === 'Purchase') {
      const { data: sale, error } = await db.from('sales').select('id,total_value,payment_status,status')
        .eq('id', run.subject_id).eq('organization_id', run.organization_id).maybeSingle();
      if (error || !sale || sale.payment_status !== 'paid' || sale.status === 'cancelled' || !(Number(sale.total_value) > 0)) {
        throw new InvalidMetaConversion('Purchase só pode representar uma venda paga e não cancelada.');
      }
      customData = { currency: 'EUR', value: Number(sale.total_value) };
    }
    const { data: claimed, error: claimError } = await db.rpc('claim_automation_meta_event', {
      p_organization_id: run.organization_id, p_pixel_id: pixelId, p_event_name: event, p_event_id: eventId,
    });
    if (claimError) throw new InvalidMetaConversion('Não foi possível reservar o evento Meta.');
    if (!claimed) {
      const { data: prior } = await db.from('automation_meta_events').select('status').eq('organization_id', run.organization_id)
        .eq('pixel_id', pixelId).eq('event_id', eventId).eq('event_name', event).maybeSingle();
      if (prior?.status === 'sent') return { kind: 'next', detail: { ignorado: 'evento já enviado', evento: event } };
      throw new InvalidMetaConversion('Meta CAPI HTTP 503: evento ainda reservado por outra execução.');
    }
    reserved = true;
    const response = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(pixelId)}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${org.meta_conversions_api_token}` },
      body: JSON.stringify({ data: [{ event_name: event, event_time: Math.floor((input.now ?? new Date()).getTime() / 1000),
        event_id: eventId, action_source: 'system_generated', user_data: userData, custom_data: customData }] }),
      signal: AbortSignal.timeout(20_000),
    });
    const result: unknown = await response.json();
    const accepted = response.ok && typeof result === 'object' && result !== null && 'events_received' in result && Number(result.events_received) >= 1;
    const { error: saveError } = await db.from('automation_meta_events').update({ status: accepted ? 'sent' : 'failed', updated_at: new Date().toISOString() })
      .eq('organization_id', run.organization_id).eq('pixel_id', pixelId).eq('event_id', eventId).eq('event_name', event);
    if (saveError) throw new InvalidMetaConversion('Meta respondeu, mas o resultado não foi guardado. O identificador estável evita repetição no provedor.');
    if (!accepted) throw new InvalidMetaConversion(`Meta CAPI HTTP ${response.status}`);
    return { kind: 'next', detail: { evento: event, event_id: eventId, enviado: true } };
  } catch (error) {
    if (reserved && eventId) {
      await db.from('automation_meta_events').update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('organization_id', run.organization_id).eq('pixel_id', pixelId).eq('event_id', eventId).eq('event_name', String(config.event_name));
    }
    if (error instanceof InvalidMetaConversion) return { kind: 'fail', error: error.message };
    if (error instanceof Error) return { kind: 'fail', error: `Meta CAPI: ${error.name === 'TimeoutError' ? 'timeout' : 'falha de comunicação'}` };
    throw error;
  }
}
