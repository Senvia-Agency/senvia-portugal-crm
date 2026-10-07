import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  finalizeVerifiedLead,
  leadVerificationEmailTokenHash,
  leadVerificationWhatsAppCode,
  leadVerificationWhatsAppUrl,
  parseLeadVerificationChallenge,
} from '../_shared/lead-verification.ts';
import { rateLimitDb } from '../_shared/security.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function loadChallenge(db: ReturnType<typeof createClient>, tokenHash: string) {
  const { data, error } = await db
    .from('lead_verification_challenges')
    .select('id, organization_id, payload, phone_digits, email_token_hash, whatsapp_code_hash, email_verified_at, whatsapp_verified_at, expires_at, finalized_lead_id')
    .eq('email_token_hash', tokenHash)
    .maybeSingle();
  if (error) throw error;
  return parseLeadVerificationChallenge(data);
}

async function finishIfVerified(
  db: ReturnType<typeof createClient>,
  challenge: NonNullable<Awaited<ReturnType<typeof loadChallenge>>>,
  supabaseUrl: string,
  serviceKey: string,
): Promise<string | null> {
  if (challenge.finalizedLeadId) return challenge.finalizedLeadId;
  if (!challenge.emailVerifiedAt || !challenge.whatsappVerifiedAt) return null;

  const leadId = await finalizeVerifiedLead(challenge.id, supabaseUrl, serviceKey);
  if (!leadId) return null;
  const { error } = await db
    .from('lead_verification_challenges')
    .update({ finalized_lead_id: leadId, payload: null, phone_digits: null, whatsapp_code_hash: null })
    .eq('id', challenge.id)
    .is('finalized_lead_id', null);
  if (error) throw error;
  return leadId;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return response({ error: 'Método não permitido' }, 405);

  try {
    const body: unknown = await req.json();
    if (!isRecord(body) || (body.action !== 'confirm_email' && body.action !== 'status')
      || typeof body.token !== 'string' || !/^[0-9a-f]{64}$/i.test(body.token)) {
      return response({ error: 'Pedido de confirmação inválido.' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) return response({ error: 'Confirmação temporariamente indisponível.' }, 503);
    const db = createClient(supabaseUrl, serviceKey);
    const tokenHash = await leadVerificationEmailTokenHash(body.token);
    const limit = await rateLimitDb(db, `lead-verification:status:${tokenHash}`, 20, 60);
    if (!limit.allowed) return response({ error: 'Aguarda um momento antes de verificar novamente.' }, 429);

    let challenge = await loadChallenge(db, tokenHash);
    if (!challenge) return response({ error: 'Este link já expirou ou não é válido.' }, 410);
    if (new Date(challenge.expiresAt).getTime() <= Date.now() && !challenge.finalizedLeadId) {
      return response({ error: 'Este link já expirou. Envia o formulário novamente.' }, 410);
    }

    if (body.action === 'confirm_email' && !challenge.emailVerifiedAt && !challenge.finalizedLeadId) {
      const { error } = await db
        .from('lead_verification_challenges')
        .update({ email_verified_at: new Date().toISOString() })
        .eq('id', challenge.id)
        .is('email_verified_at', null)
        .gt('expires_at', new Date().toISOString());
      if (error) throw error;
      challenge = await loadChallenge(db, tokenHash);
      if (!challenge) return response({ error: 'Este link já expirou ou não é válido.' }, 410);
    }

    const leadId = await finishIfVerified(db, challenge, supabaseUrl, serviceKey);
    let whatsappUrl: string | null = null;
    if (challenge.emailVerifiedAt && !challenge.whatsappVerifiedAt && challenge.phoneDigits) {
      const code = await leadVerificationWhatsAppCode(body.token, serviceKey);
      const { data: channels, error } = await db
        .from('messaging_channels')
        .select('phone_number, metadata')
        .eq('organization_id', challenge.organizationId)
        .eq('provider', 'evolution')
        .eq('channel_type', 'whatsapp')
        .eq('status', 'connected')
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      const channel = (channels ?? []).find((item) =>
        typeof item.phone_number === 'string'
        && isRecord(item.metadata)
        && item.metadata.native_inbox === true
      );
      if (channel?.phone_number) whatsappUrl = leadVerificationWhatsAppUrl(channel.phone_number, code);
    }

    return response({
      email_verified: !!challenge.emailVerifiedAt,
      whatsapp_verified: !!challenge.whatsappVerifiedAt,
      completed: !!leadId,
      whatsapp_url: whatsappUrl,
    });
  } catch {
    console.error('[verify-lead] confirmation request failed');
    return response({ error: 'Não foi possível confirmar agora. Tenta novamente.' }, 500);
  }
});
