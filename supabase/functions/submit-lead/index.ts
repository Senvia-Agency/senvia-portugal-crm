import { createClient } from 'npm:@supabase/supabase-js@2';
import { normalizeEmail, normalizePtPhone, normalizeInternationalPhone } from '../_shared/contact-validation.ts';
import { ipDoPedido, rateLimitDb, respostaLimiteExcedido } from '../_shared/security.ts';
import { applySenviaEmailTemplate } from '../_shared/senvia-email-template.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Run work after the response is sent (Supabase edge runtime); fall back to a
// floating promise locally.
function runInBackground(p: Promise<unknown>): void {
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (er?.waitUntil) er.waitUntil(p);
  else p.catch(() => {});
}

// Render a message template with the lead's name. Supports the simple {{nome}} /
// {{primeiro_nome}} placeholders AND the legacy n8n expression
// ({{ $('Dados').item.json.Nome }}) so templates written for the old n8n flow
// still work after it was retired.
// Render a welcome-message template. Supports the canonical variables (kept in
// sync with MessageTemplateField.WELCOME_VARIABLES), custom form fields via
// {{campo:Etiqueta}}, and the legacy n8n syntax {{ $('Dados').item.json.X }}.
// Unknown {{...}} placeholders are stripped so customers never see raw tokens.
function renderTemplate(
  tpl: string,
  lead: any,
  ctx: { orgName?: string; assigneeName?: string } = {},
): string {
  const name = String(lead?.name || '').trim();
  const first = name.split(/\s+/)[0] || name;
  const email = lead?.email && lead.email !== 'nao-fornecido@placeholder.local' ? String(lead.email) : '';
  const phone = lead?.phone && lead.phone !== '000000000' ? String(lead.phone) : '';
  const company = String(lead?.company_name || '');
  const nif = String(lead?.company_nif || '');
  const source = String(lead?.source || '');
  const custom = (lead?.custom_data && typeof lead.custom_data === 'object') ? lead.custom_data : {};

  const vars: Record<string, string> = {
    nome: name, name,
    primeiro_nome: first, first_name: first,
    email,
    telefone: phone,
    empresa: company,
    nif,
    fonte: source,
    responsavel: String(ctx.assigneeName || ''),
    minha_empresa: String(ctx.orgName || ''),
  };

  let out = String(tpl || '');

  // Legacy n8n: {{ $('Dados').item.json.Field }} -> map known fields, else name
  out = out.replace(/\{\{\s*\$\([^)]*\)\.item\.json\.([A-Za-z0-9_]+)\s*\}\}/g, (_m, field) => {
    const f = String(field).toLowerCase();
    if (f.includes('email')) return email;
    if (f.includes('tele') || f.includes('phone') || f.includes('contacto')) return phone;
    if (f.includes('empresa') || f.includes('company')) return company;
    if (f.includes('nif')) return nif;
    return name;
  });

  // Custom form fields: {{campo:Etiqueta}} (case-insensitive label match)
  out = out.replace(/\{\{\s*campo\s*:\s*([^}]+?)\s*\}\}/gi, (_m, label) => {
    const want = String(label).trim().toLowerCase();
    const key = Object.keys(custom).find((k) => k.toLowerCase() === want);
    return key ? String(custom[key] ?? '') : '';
  });

  // Canonical variables (tolerate a stray single brace from old templates)
  out = out.replace(/\{\{?\s*([a-z_]+)\s*\}?\}/gi, (m, key) => {
    const k = String(key).toLowerCase();
    return k in vars ? vars[k] : m;
  });

  // Strip any remaining {{...}} so customers never receive raw placeholders
  out = out.replace(/\{\{[^}]*\}\}/g, '');

  // Tidy spaces left by emptied variables
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

// Classify a freshly-created lead's temperature (hot/warm/cold) with Gemini, using
// the form's AI qualification rules. Falls back to 'warm' when no key/rules or on
// any error — never throws.
async function classifyTemperature(rules: string | null, lead: any): Promise<'hot' | 'warm' | 'cold'> {
  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiKey || !rules || !String(rules).trim()) return 'warm';
  try {
    const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
    const leadInfo = JSON.stringify({
      name: lead.name, source: lead.source, notes: lead.notes, custom_data: lead.custom_data,
    }).slice(0, 1500);
    let aiRes: Response | null = null;
    for (const model of MODELS) {
      aiRes = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${geminiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            { role: 'system', content: 'És um assistente de CRM que classifica a TEMPERATURA de um lead recém-criado, a partir das regras do negócio e dos dados do lead. Responde APENAS com JSON válido, sem markdown: {"temperatura":"hot|warm|cold"}.' },
            { role: 'user', content: `Regras:\n${String(rules).slice(0, 2000)}\n\nDados do lead:\n${leadInfo}` },
          ],
        }),
      });
      if (aiRes.ok) break;
      if (aiRes.status !== 503 && aiRes.status !== 429) break; // only retry on overload
    }
    if (!aiRes || !aiRes.ok) return 'warm';
    const data = await aiRes.json();
    const raw = String(data?.choices?.[0]?.message?.content ?? '').replace(/```json|```/g, '').trim();
    const out = JSON.parse(raw);
    const t = String(out?.temperatura || '').toLowerCase();
    return t === 'hot' || t === 'cold' ? t : 'warm';
  } catch (e) {
    console.error('[welcome] classify failed:', (e as Error).message);
    return 'warm';
  }
}

/**
 * Dispatches lead_created_hot/warm/cold to the automation engine.
 *
 * Not the DB trigger's job: `notify_automation_trigger` fires synchronously on
 * INSERT, before temperature is known (classification is an async AI call
 * that only completes here, in the background). Called unconditionally once
 * `temp` is known — independent of whether the legacy per-form WhatsApp
 * welcome below is even configured, so "novo lead quente/morno/fria" flows
 * work for every organization, not just the ones still using the old feature.
 */
async function dispatchLeadTemperature(
  supabase: any, orgId: string, lead: any, temp: 'hot' | 'warm' | 'cold',
): Promise<void> {
  try {
    const { data: secret } = await supabase.rpc('automation_internal_secret');
    if (!secret) return;
    const triggerType = temp === 'hot' ? 'lead_created_hot' : temp === 'cold' ? 'lead_created_cold' : 'lead_created_warm';
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    await fetch(`${supabaseUrl}/functions/v1/automation-engine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-automation-secret': String(secret) },
      body: JSON.stringify({
        action: 'enroll',
        trigger_type: triggerType,
        organization_id: orgId,
        subject_type: 'lead',
        record: { ...lead, temperature: temp },
      }),
    });
  } catch (e) {
    console.error('[automation] lead temperature dispatch failed:', (e as Error).message);
  }
}
// Classifica a temperatura da lead e avisa o motor de automações.
//
// Isto ENVIAVA também uma mensagem de boas-vindas por WhatsApp, com os
// templates por temperatura da página de Configuração de IA. Esse envio foi
// removido com o resto da integração da Evolution: o WhatsApp por ligação
// não-oficial viola os Termos da Meta e arrisca o ban do número.
//
// Consequência assumida: uma lead que entra pelo formulário deixa de receber
// qualquer mensagem automática de WhatsApp. A classificação FICA — continua a
// carimbar leads.temperature e a disparar os gatilhos lead_created_hot/warm/
// cold, que é por onde uma automação de email pode responder.
function sendWelcomeMessage(supabase: any, org: any, lead: any, formSettings: any): void {
  runInBackground((async () => {
    try {
      const mode = org?.ai_response_mode === 'per_form' ? 'per_form' : 'global';
      const src = mode === 'per_form' ? formSettings : org;
      const aiRules = src?.ai_qualification_rules || null;

      const temp = await classifyTemperature(aiRules, lead);
      supabase.from('leads').update({ temperature: temp }).eq('id', lead.id).then(() => {}, () => {});
      await dispatchLeadTemperature(supabase, org.id, lead, temp);
    } catch (e) {
      console.error('[welcome] classificação falhou:', (e as Error).message);
    }
  })());
}

interface LeadSubmission {
  /**
   * Armadilha para robôs. Ver `src/components/forms/AntiBot.tsx`.
   *
   * `hp_website` é um campo que não se vê no ecrã: uma pessoa não o pode
   * preencher, um robô que leia o HTML preenche-o. `hp_tempo_ms` é quanto tempo
   * passou desde que o formulário abriu.
   *
   * Os dois são OPCIONAIS de propósito — um formulário já aberto no browser de
   * alguém, servido antes desta versão, não os envia, e não pode deixar de
   * funcionar por isso.
   */
  hp_website?: string | null;
  hp_tempo_ms?: number | null;
  company_nif?: string | null;
  company_name?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  gdpr_consent: boolean;
  public_key: string;
  form_id?: string | null;
  source?: string;
  notes?: string | null;
  custom_data?: Record<string, unknown>;
}

// ===== WEBHOOK MODE HANDLER (Zapier/Make/External) =====
async function handleWebhookMode(req: Request, token: string): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const ORG_COLS = 'id, name, niche, webhook_url, whatsapp_instance, whatsapp_api_key, whatsapp_base_url, meta_pixels, sales_settings, brevo_api_key, brevo_sender_email, slug, webhook_dedicated_user_id';

  let org: any = null;
  let dedicatedUserId: string | null = null;

  // Per-webhook config (named inbound webhooks with own user list + round-robin).
  // Authoritative when the token matches a row here.
  let intakeAssignee: string | null = null;
  let intakeWebhookName: string | null = null;
  let isIntakeWebhook = false;

  // ===== NEW: per-organization named inbound webhooks (lead_intake_webhooks) =====
  // Wrapped in try/catch so the function still works if the migration hasn't run yet.
  let intakeWebhook: any = null;
  try {
    const { data } = await supabase
      .from('lead_intake_webhooks')
      .select('id, organization_id, name, is_active, assigned_user_ids, rotate_enabled, notify_all_admins')
      .eq('token', token)
      .maybeSingle();
    intakeWebhook = data;
  } catch (e) {
    console.warn('lead_intake_webhooks lookup failed (table missing?):', (e as Error).message);
  }

  if (intakeWebhook) {
    if (intakeWebhook.is_active === false) {
      console.warn('Inbound webhook is disabled:', intakeWebhook.id);
      // 200 to avoid retry storms from Facebook/Zapier/Make
      return new Response(
        JSON.stringify({ success: false, error: 'Webhook desativado' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    isIntakeWebhook = true;
    intakeWebhookName = intakeWebhook.name || null;

    const { data: orgRow } = await supabase
      .from('organizations')
      .select(ORG_COLS)
      .eq('id', intakeWebhook.organization_id)
      .maybeSingle();
    org = orgRow;

    if (org) {
      // Resolve assignee atomically (handles rotate on/off internally)
      try {
        const { data: assignee, error: assigneeError } = await supabase.rpc(
          'get_next_webhook_assignee',
          { p_webhook_id: intakeWebhook.id }
        );
        if (assigneeError) {
          console.error('get_next_webhook_assignee failed:', assigneeError);
        } else {
          intakeAssignee = (assignee as string) || null;
        }
      } catch (rrErr) {
        console.error('Webhook assignee RPC failed:', rrErr);
      }
    }
  } else {
    // ===== LEGACY FALLBACK (tokens not yet/never migrated) =====
    // Standard webhook token first
    const { data: stdOrg } = await supabase
      .from('organizations')
      .select(ORG_COLS)
      .eq('webhook_token', token)
      .maybeSingle();
    org = stdOrg;

    // Dedicated webhook token (forces assignment to specific user)
    if (!org) {
      const { data: dedicatedOrg } = await supabase
        .from('organizations')
        .select(ORG_COLS)
        .eq('webhook_token_dedicated', token)
        .maybeSingle();

      if (dedicatedOrg) {
        org = dedicatedOrg;
        dedicatedUserId = dedicatedOrg.webhook_dedicated_user_id || null;
        console.log('Dedicated webhook matched. Forced assignee:', dedicatedUserId);
      }
    }
  }

  if (!org) {
    console.error('Invalid webhook token');
    return new Response(
      JSON.stringify({ error: 'Token inválido' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  console.log('Webhook organization resolved', { organizationId: org.id });

  const rawBody = await req.json();
  console.log('Webhook payload received');

  // Map common field names from Facebook Lead Ads / Zapier / Make
  const name = 
    rawBody.full_name?.trim() || 
    rawBody.name?.trim() || 
    rawBody.nome?.trim() || 
    [rawBody.first_name, rawBody.last_name].filter(Boolean).join(' ').trim() || 
    'Lead Externo';
  const email = rawBody.email || rawBody.e_mail || rawBody.mail || null;
  const phone = rawBody.phone || rawBody.phone_number || rawBody.telefone || rawBody.tel || null;
  const company = rawBody.company || rawBody.company_name || rawBody.empresa || null;
  const notes = rawBody.notes || rawBody.message || rawBody.mensagem || rawBody.observacoes || null;
  const source = rawBody.source || rawBody.fonte || intakeWebhookName || 'Webhook Externo';

  console.log('Webhook fields mapped');

  // Strict per-field validation, but lenient at the lead level: if a field
  // is invalid we drop just that field (set to null/placeholder) instead of
  // rejecting the whole webhook call. Returning 400 would cause Facebook
  // Lead Ads / Zapier / Make to retry indefinitely.
  let cleanPhone: string | null = null;
  if (phone) {
    // Same normalization + storage format as the form (E.164), so the same contact
    // dedupes across form/webhook and international numbers aren't silently dropped.
    const r = normalizeInternationalPhone(phone);
    if (r.ok) {
      cleanPhone = r.value; // store E.164 (e.g. +351912345678)
    } else {
      console.warn('[submit-lead webhook] phone rejected:', r.reason);
    }
  }

  let cleanEmail: string | null = null;
  if (email) {
    const r = normalizeEmail(email);
    if (r.ok) {
      cleanEmail = r.value;
    } else {
      console.warn('[submit-lead webhook] email rejected:', r.reason);
    }
  }

  // Lead-level guard: if BOTH email AND phone are invalid, reject. A lead
  // with neither is worthless and certainly fake.
  if (!cleanPhone && !cleanEmail) {
    console.warn('[submit-lead webhook] dropped — no valid contact method');
    return new Response(
      JSON.stringify({ error: 'Lead sem contacto válido' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Deduplication check (same phone within 60s)
  if (cleanPhone && cleanPhone !== '000000000') {
    const sixtySecondsAgo = new Date(Date.now() - 60000).toISOString();
    const { data: existingLead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', cleanPhone)
      .eq('organization_id', org.id)
      .gte('created_at', sixtySecondsAgo)
      .limit(1)
      .maybeSingle();

    if (existingLead) {
      return new Response(
        JSON.stringify({ success: true, lead_id: existingLead.id, duplicate: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }

  // Assignment priority:
  //  1) Named inbound webhook -> its own users + round-robin (resolved above)
  //  2) Legacy dedicated webhook -> forced single user
  //  3) Legacy general webhook -> org-level round-robin
  let autoAssignedTo: string | null = null;
  // Notificacao: por defeito todos os admins recebem (legacy/dedicado/standard).
  // Nos webhooks de entrada, respeita o toggle "notify_all_admins": se false,
  // so o utilizador a quem o lead foi atribuido e' notificado.
  const notifyAllAdmins = isIntakeWebhook ? (intakeWebhook?.notify_all_admins !== false) : true;
  if (isIntakeWebhook) {
    autoAssignedTo = intakeAssignee;
    console.log('Inbound webhook assignee:', autoAssignedTo, '| notifyAllAdmins:', notifyAllAdmins);
  } else if (dedicatedUserId) {
    autoAssignedTo = dedicatedUserId;
    console.log('Dedicated webhook: assigning to', dedicatedUserId);
  } else {
    // No org-wide round-robin fallback. Assignment is decided per-webhook
    // (named intake) or per-dedicated-token only. A legacy/standard webhook
    // with no own config leaves the lead unassigned (never a hidden general
    // round-robin between all salespeople).
    autoAssignedTo = null;
  }

  // Collect extra fields as custom_data
  const knownFields = ['full_name', 'name', 'nome', 'first_name', 'last_name', 'email', 'e_mail', 'mail', 'phone', 'phone_number', 'telefone', 'tel', 'company', 'company_name', 'empresa', 'notes', 'message', 'mensagem', 'observacoes', 'source', 'fonte'];
  const customData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawBody)) {
    if (!knownFields.includes(key) && value !== null && value !== undefined && value !== '') {
      customData[key] = value;
    }
  }

  // Insert lead
  let { data: lead, error: leadError } = await supabase
    .from('leads')
    .insert({
      organization_id: org.id,
      assigned_to: autoAssignedTo,
      name: String(name).substring(0, 200),
      email: cleanEmail || 'nao-fornecido@placeholder.local',
      phone: cleanPhone || '000000000',
      company_name: company ? String(company).substring(0, 200) : null,
      gdpr_consent: true,
      source: String(source).substring(0, 100),
      status: 'new',
      notes: notes ? String(notes).substring(0, 2000) : null,
      custom_data: Object.keys(customData).length > 0 ? customData : {},
    })
    .select()
    .maybeSingle();

  if (leadError) {
    console.error('Error inserting webhook lead:', leadError);
    return new Response(
      JSON.stringify({ error: 'Erro ao guardar lead' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // If the de-duplication trigger updated an existing lead, the insert
  // returns no row — fetch that lead instead.
  if (!lead && cleanEmail) {
    const { data: existingLead } = await supabase
      .from('leads')
      .select()
      .eq('organization_id', org.id)
      .ilike('email', cleanEmail)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    lead = existingLead;
  }

  if (!lead) {
    console.error('Error inserting webhook lead: no row returned');
    return new Response(
      JSON.stringify({ error: 'Erro ao guardar lead' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  console.log('Webhook lead created:', lead.id);

  // Fire outbound webhooks (non-blocking)
  const { data: activeWebhooks } = await supabase
    .from('organization_webhooks')
    .select('url')
    .eq('organization_id', org.id)
    .eq('is_active', true);

  const webhookUrls: string[] = [];
  if (activeWebhooks) {
    for (const wh of activeWebhooks) {
      if (wh.url && !webhookUrls.includes(wh.url)) webhookUrls.push(wh.url);
    }
  }
  if (org.webhook_url && !webhookUrls.includes(org.webhook_url)) webhookUrls.push(org.webhook_url);

  const webhookPayload = {
    event: 'lead.created',
    timestamp: new Date().toISOString(),
    organization: { id: org.id, name: org.name },
    lead: {
      id: lead.id, name: lead.name, email: lead.email,
      phone: lead.phone, company_name: lead.company_name,
      source: lead.source, status: lead.status, notes: lead.notes,
      custom_data: customData, created_at: lead.created_at,
    },
  };

  for (const whUrl of webhookUrls) {
    fetch(whUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload),
    }).catch(() => console.error('Webhook dispatch failed'));
  }

  // Push notification - target admins (unless this webhook opted out) + assigned
  try {
    let pushUserIds: string[] = [];
    if (notifyAllAdmins) {
      const { data: pushAdminMembers } = await supabase
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', org.id)
        .eq('role', 'admin')
        .eq('is_active', true);
      pushUserIds = (pushAdminMembers || []).map((m: any) => m.user_id);
    }
    if (autoAssignedTo && !pushUserIds.includes(autoAssignedTo)) {
      pushUserIds.push(autoAssignedTo);
    }

    if (pushUserIds.length > 0) {
      fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({
          organization_id: org.id,
          user_ids: pushUserIds,
          title: '🚀 Novo Lead!',
          body: `${lead.name} - ${lead.source}`,
          url: '/leads',
          tag: `lead-${lead.id}`,
        }),
      }).catch((err) => console.error('Push failed:', err.message));
    }
  } catch (pushErr) {
    console.error('Error preparing push notification:', pushErr);
  }

  // ===== EMAIL NOTIFICATION (org Brevo or fallback to Senvia) =====
  try {
    const orgBrevoKey = org.brevo_api_key;
    const orgBrevoEmail = org.brevo_sender_email;
    // Transactional/system email: prefer a dedicated Brevo key (separate from marketing).
    const brevoKey = Deno.env.get('BREVO_TRANSACTIONAL_API_KEY') || orgBrevoKey || Deno.env.get('BREVO_API_KEY');
    const senderEmail = orgBrevoEmail || 'geral@senvia.pt';
    const senderName = orgBrevoEmail ? org.name : 'Senvia';

    if (brevoKey) {
      // Fetch admin emails (unless this webhook opted out of admin-wide notification)
      let adminIds: string[] = [];
      if (notifyAllAdmins) {
        const { data: adminMembers } = await supabase
          .from('organization_members')
          .select('user_id')
          .eq('organization_id', org.id)
          .eq('role', 'admin')
          .eq('is_active', true);
        adminIds = (adminMembers || []).map((m: any) => m.user_id);
      }

      // Add assigned salesperson if not already included
      if (autoAssignedTo && !adminIds.includes(autoAssignedTo)) {
        adminIds.push(autoAssignedTo);
      }

      if (adminIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, email, full_name')
          .in('id', adminIds);

        const recipients = (profiles || [])
          .filter((p: any) => p.email)
          .map((p: any) => ({ email: p.email, name: p.full_name || p.email }));

        if (recipients.length > 0) {
          const leadsUrl = 'https://app.senvia.pt/leads';
          const logoUrl = 'https://app.senvia.pt/senvia-logo-white.png';

          const htmlContent = `
<!DOCTYPE html>
<html lang="pt">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:'Segoe UI',Roboto,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;padding:40px 16px">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#1e293b;border-radius:16px;overflow:hidden">
  <tr><td style="padding:32px 32px 24px;text-align:center">
    <img src="${logoUrl}" alt="Senvia OS" width="140" style="display:inline-block;margin-bottom:24px" />
    <h1 style="color:#ffffff;font-size:22px;margin:0">🚀 Novo Lead Recebido</h1>
  </td></tr>
  <tr><td style="padding:0 32px 24px">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;border-radius:12px;border:1px solid #334155">
      ${lead.name && lead.name !== 'Lead Externo' && lead.name !== 'Anónimo' ? `<tr><td style="padding:12px 16px 0;color:#94a3b8;font-size:13px;font-weight:600">Nome</td><td style="padding:12px 16px 0;color:#f1f5f9;font-size:14px;text-align:right">${lead.name}</td></tr>` : ''}
      ${lead.phone && lead.phone !== '000000000' ? `<tr><td style="padding:12px 16px 0;color:#94a3b8;font-size:13px;font-weight:600">Telefone</td><td style="padding:12px 16px 0;color:#f1f5f9;font-size:14px;text-align:right">${lead.phone}</td></tr>` : ''}
      ${lead.email && lead.email !== 'nao-fornecido@placeholder.local' ? `<tr><td style="padding:12px 16px 0;color:#94a3b8;font-size:13px;font-weight:600">Email</td><td style="padding:12px 16px 0;color:#f1f5f9;font-size:14px;text-align:right">${lead.email}</td></tr>` : ''}
      <tr><td style="padding:12px 16px 0;color:#94a3b8;font-size:13px;font-weight:600">Fonte</td><td style="padding:12px 16px 0;color:#f1f5f9;font-size:14px;text-align:right">${lead.source || 'Webhook Externo'}</td></tr>
      ${lead.company_name ? `<tr><td style="padding:12px 16px;color:#94a3b8;font-size:13px;font-weight:600">Empresa</td><td style="padding:12px 16px;color:#f1f5f9;font-size:14px;text-align:right">${lead.company_name}</td></tr>` : '<tr><td style="padding:0 0 12px" colspan="2"></td></tr>'}
    </table>
  </td></tr>
  <tr><td style="padding:0 32px 32px;text-align:center">
    <a href="${leadsUrl}" style="display:inline-block;background:#10b981;color:#ffffff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">Ver Lead no Senvia</a>
  </td></tr>
  <tr><td style="padding:16px 32px;border-top:1px solid #334155;text-align:center">
    <p style="color:#64748b;font-size:12px;margin:0">Senvia OS · <a href="https://senvia.pt" style="color:#64748b;text-decoration:underline">senvia.pt</a></p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

          console.log('[Webhook] Sending new-lead email', { recipientCount: recipients.length });

          fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'api-key': brevoKey,
            },
            body: JSON.stringify({
              sender: { email: senderEmail, name: senderName },
              to: recipients,
              subject: `🚀 Novo Lead: ${lead.name} - ${lead.source || 'Webhook'}`,
              htmlContent: applySenviaEmailTemplate(htmlContent, `Novo lead: ${lead.name}`),
            }),
          })
            .then((res) => console.info(`[Webhook] Brevo new-lead email sent, status: ${res.status}`))
            .catch((err) => console.error('[Webhook] Brevo new-lead email failed:', err.message));
        }
      }
    } else {
      console.warn('[Webhook] No Brevo API key available (org or global), skipping email notification');
    }
  } catch (emailError) {
    console.error('[Webhook] Error sending new-lead email:', emailError);
  }

  return new Response(
    JSON.stringify({ success: true, lead_id: lead.id }),
    { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Only accept POST requests
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Método não permitido' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const url = new URL(req.url);
    const mode = url.searchParams.get('mode');
    const token = url.searchParams.get('token');

    // ===== LIMITE DE PEDIDOS =====
    //
    // Este endpoint é público e cada pedido custa caro: grava um lead, pede uma
    // classificação a uma IA, envia email e manda notificações. Sem limite,
    // um ciclo deixado a correr uma noite enche a base de dados de leads falsos
    // e a fatura da IA com eles.
    //
    // Dois baldes por IP, de propósito. O curto trava o ciclo automático; o
    // longo trava quem submete devagar durante horas — e nenhum deles atrapalha
    // uma pessoa a preencher um formulário, que o faz uma vez.
    //
    // O modo webhook é outra coisa: quem chama é o Make ou o Facebook Lead Ads,
    // de um IP fixo, e uma campanha a sério manda rajadas legítimas. Aí o balde
    // é o TOKEN, não o IP, e o limite é muito mais largo.
    const limitador = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const ip = ipDoPedido(req);

    if (mode === 'webhook' && token) {
      const rl = await rateLimitDb(limitador, `submit-lead:wh:${token}`, 300, 60);
      if (!rl.allowed) {
        console.warn('[submit-lead] limite do webhook excedido', { hits: rl.hits });
        return respostaLimiteExcedido(rl.retryAfter, corsHeaders,
          'Demasiados envios seguidos para este webhook. Abranda o ritmo e volta a tentar.');
      }
    } else {
      const curto = await rateLimitDb(limitador, `submit-lead:min:${ip}`, 5, 60);
      if (!curto.allowed) {
        console.warn('[submit-lead] limite por minuto excedido', { hits: curto.hits });
        return respostaLimiteExcedido(curto.retryAfter, corsHeaders,
          'Enviaste demasiados formulários seguidos. Espera um minuto e tenta outra vez.');
      }
      const longo = await rateLimitDb(limitador, `submit-lead:hora:${ip}`, 30, 3600);
      if (!longo.allowed) {
        console.warn('[submit-lead] limite por hora excedido', { hits: longo.hits });
        return respostaLimiteExcedido(longo.retryAfter, corsHeaders,
          'Demasiados envios desta ligação na última hora.');
      }
    }

    // ===== WEBHOOK MODE (Zapier/Make) =====
    if (mode === 'webhook' && token) {
      return await handleWebhookMode(req, token);
    }

    // ===== STANDARD FORM MODE =====
    // Parse request body
    const body: LeadSubmission = await req.json();
    console.log('Lead submission received');

    // ===== ARMADILHA PARA ROBÔS =====
    //
    // Duas perguntas que uma pessoa e um robô respondem de maneira diferente:
    // preencheu um campo que não aparece no ecrã, e preencheu tudo em menos de
    // dois segundos e meio. Nenhuma delas custa um clique a quem preenche a
    // sério — é por isso que se faz isto antes de se pensar em captcha, que
    // cobra a toda a gente para travar uma minoria.
    //
    // RESPONDE-SE SUCESSO, NÃO ERRO. Um robô que leve 400 aprende e tenta
    // outra vez com outra forma; um robô que leve 201 vai-se embora
    // convencido. O lead é que não existe.
    //
    // Fica sempre registado: se algum dia isto começar a apanhar gente a
    // sério — o preenchimento automático do browser é o suspeito —, vê-se nos
    // registos em vez de se descobrir pelas queixas de leads que não chegam.
    const armadilha = String(body.hp_website ?? '').trim();
    const tempoPreenchimento = Number(body.hp_tempo_ms ?? 0);
    const TEMPO_MINIMO_MS = 2500;

    if (armadilha) {
      console.warn('[submit-lead] ARMADILHA: campo invisível preenchido', {
        detected: true,
      });
      return new Response(
        JSON.stringify({ success: true, message: 'Contacto registado com sucesso' }),
        { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // `> 0` na condição: um formulário servido antes desta versão não manda o
    // campo, e `0` não pode ser lido como "preencheu num instante".
    if (tempoPreenchimento > 0 && tempoPreenchimento < TEMPO_MINIMO_MS) {
      console.warn('[submit-lead] ARMADILHA: preenchido depressa demais', {
        ms: tempoPreenchimento,
      });
      return new Response(
        JSON.stringify({ success: true, message: 'Contacto registado com sucesso' }),
        { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Validate public_key is required
    if (!body.public_key) {
      console.error('Missing public_key');
      return new Response(
        JSON.stringify({ error: 'Formulário inválido' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate GDPR consent
    if (!body.gdpr_consent) {
      console.error('GDPR consent not provided');
      return new Response(
        JSON.stringify({ error: 'É necessário aceitar a Política de Privacidade' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Strict server-side validation. The browser-side check is UX; this is
    // the security boundary — bots and curl requests hit this directly. We
    // reject:
    //   * Disposable / obviously-fake emails (mailinator, test@test.com, etc.)
    //   * PT phones that don't match the 9XX/2XX format or are all-same digit
    let cleanEmail: string | null = null;
    if (body.email) {
      const r = normalizeEmail(body.email);
      if (!r.ok) {
        console.warn('[submit-lead] email rejected:', r.reason);
        return new Response(
          JSON.stringify({ error: r.reason }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      cleanEmail = r.value;
    }

    let cleanPhone: string | null = null;
    if (body.phone) {
      const r = normalizeInternationalPhone(body.phone);
      if (!r.ok) {
        console.warn('[submit-lead] phone rejected:', r.reason);
        return new Response(
          JSON.stringify({ error: r.reason }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      // Store the full international number WITH country code (+351..., +55..., ...).
      // The country code is no longer stripped, so the lead's origin is unambiguous.
      cleanPhone = r.value;
    }

    // Create Supabase client with service role to bypass RLS
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Validate public_key and get organization_id (including webhook_url, whatsapp config, and meta_pixels)
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, niche, webhook_url, whatsapp_instance, whatsapp_api_key, whatsapp_base_url, meta_pixels, sales_settings, brevo_api_key, brevo_sender_email, slug, ai_response_mode, ai_qualification_rules, msg_template_hot, msg_template_warm, msg_template_cold')
      .eq('public_key', body.public_key)
      .maybeSingle();

    if (orgError) {
      console.error('Error fetching organization:', orgError);
      return new Response(
        JSON.stringify({ error: 'Erro ao validar formulário' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!org) {
      console.error('Invalid public_key');
      return new Response(
        JSON.stringify({ error: 'Formulário não encontrado' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Organization found:', org.id);

    // Get form-specific automation settings if form_id is provided
    let formSettings = {
      ai_qualification_rules: null as string | null,
      msg_template_hot: null as string | null,
      msg_template_warm: null as string | null,
      msg_template_cold: null as string | null,
      form_settings: null as any,
      form_name: null as string | null,
      assigned_to: null as string | null,
      meta_pixels: null as any[] | null,
      target_stage: null as string | null,
      // Assignment (parity with lead_intake_webhooks)
      assigned_user_ids: null as string[] | null,
      rotate_enabled: false,
      notify_all_admins: true,
    };

    if (body.form_id) {
      const { data: form, error: formError } = await supabase
        .from('forms')
        .select('id, name, form_settings, ai_qualification_rules, msg_template_hot, msg_template_warm, msg_template_cold, assigned_to, meta_pixels, target_stage, assigned_user_ids, rotate_enabled, notify_all_admins')
        .eq('id', body.form_id)
        .eq('organization_id', org.id)
        .maybeSingle();

      if (!formError && form) {
        formSettings = {
          ai_qualification_rules: form.ai_qualification_rules,
          msg_template_hot: form.msg_template_hot,
          msg_template_warm: form.msg_template_warm,
          msg_template_cold: form.msg_template_cold,
          form_settings: form.form_settings,
          form_name: form.name,
          assigned_to: form.assigned_to,
          meta_pixels: Array.isArray(form.meta_pixels) ? form.meta_pixels : null,
          target_stage: form.target_stage || null,
          assigned_user_ids: Array.isArray((form as any).assigned_user_ids) ? (form as any).assigned_user_ids : null,
          rotate_enabled: (form as any).rotate_enabled === true,
          notify_all_admins: (form as any).notify_all_admins !== false,
        };
        console.log('Form-specific settings loaded for:', form.id);
      }
    }

    // At least one contact method should be provided
    const hasName = body.name && body.name.trim().length > 0;
    const hasEmail = body.email && body.email.trim().length > 0;
    const hasPhone = cleanPhone && cleanPhone.length > 0;
    
    if (!hasName && !hasEmail && !hasPhone) {
      console.error('No contact information provided');
      return new Response(
        JSON.stringify({ error: 'É necessário fornecer pelo menos um método de contacto' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== DEDUPLICATION CHECK =====
    // Prevent duplicate leads with same phone within 60 seconds
    if (cleanPhone && cleanPhone !== '000000000') {
      const sixtySecondsAgo = new Date(Date.now() - 60000).toISOString();
      
      const { data: existingLead } = await supabase
        .from('leads')
        .select('id, created_at')
        .eq('phone', cleanPhone)
        .eq('organization_id', org.id)
        .gte('created_at', sixtySecondsAgo)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingLead) {
        console.log('Duplicate lead detected (same phone within 60s), returning existing:', existingLead.id);
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: 'Lead já registado',
            lead_id: existingLead.id,
            duplicate: true 
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ===== AUTO-ASSIGN =====
    // Assignment is decided entirely by the form (no org-wide fallback):
    //  1) Form's own recipient list (assigned_user_ids) -> get_next_form_assignee
    //     (handles rotate on/off atomically, like inbound webhooks)
    //  2) Legacy single fixed assignee (forms.assigned_to)
    //  Otherwise the lead stays unassigned.
    let autoAssignedTo: string | null = null;
    const formUserIds = formSettings.assigned_user_ids || [];

    if (body.form_id && formUserIds.length > 0) {
      try {
        const { data: assignee, error: faErr } = await supabase.rpc(
          'get_next_form_assignee',
          { p_form_id: body.form_id }
        );
        if (faErr) {
          console.error('get_next_form_assignee failed:', faErr);
        } else {
          autoAssignedTo = (assignee as string) || null;
          console.log('Form assignee resolved to:', autoAssignedTo, '| rotate:', formSettings.rotate_enabled);
        }
      } catch (faEx) {
        console.error('Form assignee RPC failed:', faEx);
      }
    }

    if (!autoAssignedTo && formSettings.assigned_to) {
      autoAssignedTo = formSettings.assigned_to;
      console.log('Form has legacy fixed assignee:', autoAssignedTo);
    }

    // No org-wide fallback: assignment is always decided by the form itself
    // (recipient list + rotation, or a fixed owner). If the form has no
    // assignee, the lead stays unassigned, never a hidden general round-robin.

    // Insert lead with custom data - use defaults for required DB fields
    let { data: lead, error: leadError } = await supabase
      .from('leads')
      .insert({
        organization_id: org.id,
        form_id: body.form_id || null,
        assigned_to: autoAssignedTo,
        company_nif: body.company_nif?.trim() || null,
        company_name: body.company_name?.trim() || null,
        name: org.niche === 'telecom'
          ? (body.company_name?.trim() || body.name?.trim() || 'Anónimo')
          : (body.name?.trim() || body.company_name?.trim() || 'Anónimo'),
        email: cleanEmail || 'nao-fornecido@placeholder.local',
        phone: cleanPhone || '000000000',
        gdpr_consent: true,
        source: body.source || formSettings.form_name || 'Formulário Público',
        status: formSettings.target_stage || 'new',
        notes: [formSettings.form_name ? `Formulário: ${formSettings.form_name}` : null, body.notes?.trim() || null].filter(Boolean).join('\n') || null,
        custom_data: body.custom_data || {},
      })
      .select()
      .maybeSingle();

    if (leadError) {
      console.error('Error inserting lead:', leadError);
      return new Response(
        JSON.stringify({ error: 'Erro ao guardar contacto' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // True only for a genuinely new lead. When the dedup trigger turns the INSERT
    // into an UPDATE of an existing lead, it returns no row — so this is false and
    // we must NOT re-send the welcome message for a returning contact.
    const wasInserted = !!lead;

    // If the de-duplication trigger updated an existing lead, the insert
    // returns no row — fetch that lead instead.
    const submittedEmail = cleanEmail;
    if (!lead && submittedEmail) {
      const { data: existingLead } = await supabase
        .from('leads')
        .select()
        .eq('organization_id', org.id)
        .ilike('email', submittedEmail)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      lead = existingLead;
    }

    if (!lead) {
      console.error('Error inserting lead: no row returned');
      return new Response(
        JSON.stringify({ error: 'Erro ao guardar contacto' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Lead created successfully:', lead.id);

    // Proactive first-contact WhatsApp (replaces the retired n8n flow). Sends the
    // form's temperature template via the org's connected Evolution instance so it
    // appears in the Chatwoot inbox. Background; never blocks the response.
    // Map custom_data keys from field IDs to human-readable labels. Idempotent for
    // the conversational form (already label-keyed). This MUST run before the welcome
    // so the {{campo:Etiqueta}} variables resolve, and we persist it so the lead, the
    // notifications and the message all use labels.
    const mapCustomDataToLabels = (
      customData: Record<string, unknown> | null,
      formSettingsData: { custom_fields?: Array<{ id: string; label: string }> } | null
    ): Record<string, unknown> => {
      if (!customData) return {};
      if (!formSettingsData?.custom_fields) return customData;
      const result: Record<string, unknown> = {};
      for (const [fieldId, value] of Object.entries(customData)) {
        const field = formSettingsData.custom_fields.find((f) => f.id === fieldId);
        result[field ? field.label : fieldId] = value;
      }
      return result;
    };
    const transformedCustomData = mapCustomDataToLabels(
      body.custom_data || null,
      formSettings.form_settings as any
    );

    // Persist label-keyed custom_data on the lead (better display + so the welcome
    // template's {{campo:...}} variables resolve against labels, not field IDs).
    if (Object.keys(transformedCustomData).length > 0) {
      lead.custom_data = transformedCustomData;
      supabase.from('leads').update({ custom_data: transformedCustomData }).eq('id', lead.id).then(() => {}, () => {});
    }

    // Proactive first-contact WhatsApp (replaces the retired n8n flow). Sends the
    // form's temperature template via the org's connected Evolution instance so it
    // appears in the Chatwoot inbox. Background; never blocks the response. Only for a
    // genuinely NEW lead, so a returning contact isn't messaged again.
    if (wasInserted) {
      sendWelcomeMessage(supabase, org, lead, formSettings);
    }

    // Automation flows with the `form_submitted` trigger. Nothing dispatched
    // this event before, so such a flow could be built and activated and would
    // simply never fire. The `lead_created` DB trigger is NOT a substitute: it
    // carries no form identity, so a flow scoped to one form could not tell
    // which form was submitted. Fire-and-forget — the submitter must never wait
    // on (or fail because of) automations.
    if (wasInserted) {
      try {
        const { data: automationSecret } = await supabase.rpc('automation_internal_secret');
        if (automationSecret) {
          fetch(`${supabaseUrl}/functions/v1/automation-engine`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-automation-secret': String(automationSecret),
            },
            body: JSON.stringify({
              action: 'enroll',
              trigger_type: 'form_submitted',
              organization_id: org.id,
              subject_type: 'lead',
              record: { ...lead, form_id: body.form_id || null },
            }),
          }).catch((e) => console.error('form_submitted dispatch failed:', e));
        }
      } catch (e) {
        console.error('form_submitted dispatch error:', e);
      }
    }

    // Fetch active webhooks from organization_webhooks table
    const { data: activeWebhooks } = await supabase
      .from('organization_webhooks')
      .select('url')
      .eq('organization_id', org.id)
      .eq('is_active', true);

    // Collect webhook URLs: org-configured outbound webhooks (external integrations).
    const webhookUrls: string[] = [];
    if (activeWebhooks) {
      for (const wh of activeWebhooks) {
        if (wh.url && !webhookUrls.includes(wh.url)) {
          webhookUrls.push(wh.url);
        }
      }
    }
    // Also include legacy webhook_url if set (backwards compat)
    if (org.webhook_url && !webhookUrls.includes(org.webhook_url)) {
      webhookUrls.push(org.webhook_url);
    }

    // Build webhook payload
    const webhookPayload = {
      event: 'lead.created',
      timestamp: new Date().toISOString(),
      organization: {
        id: org.id,
        name: org.name,
      },
      form: {
        id: body.form_id || null,
        name: formSettings.form_name || null,
      },
      lead: {
        id: lead.id,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        company_nif: lead.company_nif,
        company_name: lead.company_name,
        source: lead.source,
        status: lead.status,
        temperature: lead.temperature,
        value: lead.value,
        notes: lead.notes,
        gdpr_consent: lead.gdpr_consent,
        custom_data: transformedCustomData,
        created_at: lead.created_at,
        updated_at: lead.updated_at,
      },
    };

    // Fire all webhooks (non-blocking)
    for (const url of webhookUrls) {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookPayload),
      })
        .then((res) => {
          console.info('Webhook dispatched', { status: res.status });
        })
        .catch((err) => {
          console.error('Webhook dispatch failed');
        });
    }

    // Send push notification to admins + assigned salesperson (non-blocking).
    // When the form opts out of admin-wide notification, only the assignee gets it.
    try {
      let pushUserIds: string[] = [];
      if (formSettings.notify_all_admins) {
        const { data: pushAdmins } = await supabase
          .from('organization_members')
          .select('user_id')
          .eq('organization_id', org.id)
          .eq('role', 'admin')
          .eq('is_active', true);
        pushUserIds = (pushAdmins || []).map((m: any) => m.user_id);
      }
      if (autoAssignedTo && !pushUserIds.includes(autoAssignedTo)) {
        pushUserIds.push(autoAssignedTo);
      }

      const pushPayload = {
        organization_id: org.id,
        user_ids: pushUserIds,
        title: '🚀 Novo Lead!',
        body: `${lead.name} - ${lead.source || 'Formulário Público'}`,
        url: '/leads',
        tag: `lead-${lead.id}`,
      };

      fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify(pushPayload),
      })
        .then((res) => {
          console.info(`Push notification dispatched, status: ${res.status}`);
        })
        .catch((err) => {
          console.error('Push notification failed:', err.message);
        });
    } catch (pushError) {
      console.error('Error preparing push notification:', pushError);
    }

    // ===== META CONVERSIONS API (CAPI) =====
    // Send server-side Lead event to Facebook for each active pixel
    try {
      // Get client IP and user agent from request headers
      const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                        req.headers.get('cf-connecting-ip') || '';
      const clientUserAgent = req.headers.get('user-agent') || '';

      // Extract fbclid/fbp from custom_data for Meta attribution
      const cd = body.custom_data as Record<string, unknown> | undefined;
      const fbclid = cd?.fbclid as string | undefined;
      // Prefer the real _fbc cookie (sent in custom_data, has the correct click
      // timestamp); only reconstruct from fbclid as a fallback.
      const fbc = (cd?.fbc as string | undefined) || (fbclid ? `fb.1.${Date.now()}.${fbclid}` : undefined);
      const fbp = cd?.fbp as string | undefined;
      const externalId = (cd?.external_id as string | undefined) || lead.id;
      
      if (fbc) console.log('CAPI attribution constructed');
      
      // Determine which pixels to fire — form-level overrides org-level. A form that
      // configures pixels (even an empty list = intentionally none) wins; only inherit
      // the org's pixels when the form sets none at all (null).
      const pixelsToFire: Array<{ pixel_id: string; enabled: boolean }> =
        Array.isArray(formSettings.meta_pixels)
          ? formSettings.meta_pixels
          : (Array.isArray(org.meta_pixels) ? org.meta_pixels : []);
      
      const activePixels = pixelsToFire.filter((p: any) => p.enabled && p.pixel_id);
      
      for (const pixel of activePixels) {
        fetch(`${supabaseUrl}/functions/v1/meta-capi-event`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            pixel_id: pixel.pixel_id,
            event_name: 'Lead',
            event_id: lead.id,
            event_source_url: req.headers.get('referer') || undefined,
            user_data: {
              em: lead.email !== 'nao-fornecido@placeholder.local' ? lead.email : undefined,
              ph: lead.phone !== '000000000' ? lead.phone : undefined,
              client_ip_address: clientIp || undefined,
              client_user_agent: clientUserAgent || undefined,
              fbc: fbc || undefined,
              fbp: fbp || undefined,
              external_id: externalId,
            },
            custom_data: {
              content_name: formSettings.form_name || 'Formulário Público',
              content_category: org.niche || 'lead',
            },
          }),
        })
          .then((res) => console.info(`CAPI Lead event sent to pixel ${pixel.pixel_id}, status: ${res.status}`))
          .catch((err) => console.error(`CAPI dispatch failed for pixel ${pixel.pixel_id}:`, err.message));
      }
    } catch (capiError) {
      console.error('Error dispatching CAPI events:', capiError);
    }

    // ===== EMAIL NOTIFICATION (org Brevo or fallback to Senvia) =====
    try {
      // Priority: org's own Brevo credentials → fallback to Senvia global
      const orgBrevoKey = org.brevo_api_key;
      const orgBrevoEmail = org.brevo_sender_email;
      // Transactional/system email: prefer a dedicated Brevo key (separate from marketing).
      const brevoKey = Deno.env.get('BREVO_TRANSACTIONAL_API_KEY') || orgBrevoKey || Deno.env.get('BREVO_API_KEY');
      const senderEmail = orgBrevoEmail || 'geral@senvia.pt';
      const senderName = orgBrevoEmail ? org.name : 'Senvia';

      if (brevoKey) {
        // Fetch admin emails (unless the form opted out of admin-wide notification)
        let adminIds: string[] = [];
        if (formSettings.notify_all_admins) {
          const { data: adminMembers } = await supabase
            .from('organization_members')
            .select('user_id')
            .eq('organization_id', org.id)
            .eq('role', 'admin')
            .eq('is_active', true);
          adminIds = (adminMembers || []).map((m: any) => m.user_id);
        }

        // Add assigned salesperson if not already admin
        if (autoAssignedTo && !adminIds.includes(autoAssignedTo)) {
          adminIds.push(autoAssignedTo);
        }

        if (adminIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, email, full_name')
            .in('id', adminIds);

          const recipients = (profiles || [])
            .filter((p: any) => p.email)
            .map((p: any) => ({ email: p.email, name: p.full_name || p.email }));

          if (recipients.length > 0) {
            const leadsUrl = 'https://app.senvia.pt/leads';
            const logoUrl = 'https://app.senvia.pt/senvia-logo-white.png';

            const htmlContent = `
<!DOCTYPE html>
<html lang="pt">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:'Segoe UI',Roboto,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;padding:40px 16px">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#1e293b;border-radius:16px;overflow:hidden">
  <tr><td style="padding:32px 32px 24px;text-align:center">
    <img src="${logoUrl}" alt="Senvia OS" width="140" style="display:inline-block;margin-bottom:24px" />
    <h1 style="color:#ffffff;font-size:22px;margin:0">🚀 Novo Lead Recebido</h1>
  </td></tr>
  <tr><td style="padding:0 32px 24px">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;border-radius:12px;border:1px solid #334155">
      ${lead.name && lead.name !== 'Anónimo' ? `<tr><td style="padding:12px 16px 0;color:#94a3b8;font-size:13px;font-weight:600">Nome</td><td style="padding:12px 16px 0;color:#f1f5f9;font-size:14px;text-align:right">${lead.name}</td></tr>` : ''}
      ${lead.phone && lead.phone !== '000000000' ? `<tr><td style="padding:12px 16px 0;color:#94a3b8;font-size:13px;font-weight:600">Telefone</td><td style="padding:12px 16px 0;color:#f1f5f9;font-size:14px;text-align:right">${lead.phone}</td></tr>` : ''}
      ${lead.email && lead.email !== 'nao-fornecido@placeholder.local' ? `<tr><td style="padding:12px 16px 0;color:#94a3b8;font-size:13px;font-weight:600">Email</td><td style="padding:12px 16px 0;color:#f1f5f9;font-size:14px;text-align:right">${lead.email}</td></tr>` : ''}
      <tr><td style="padding:12px 16px 0;color:#94a3b8;font-size:13px;font-weight:600">Fonte</td><td style="padding:12px 16px 0;color:#f1f5f9;font-size:14px;text-align:right">${lead.source || 'Formulário Público'}</td></tr>
      ${formSettings.form_name ? `<tr><td style="padding:12px 16px 0;color:#94a3b8;font-size:13px;font-weight:600">Formulário</td><td style="padding:12px 16px 0;color:#f1f5f9;font-size:14px;text-align:right">${formSettings.form_name}</td></tr>` : ''}
      ${lead.company_name ? `<tr><td style="padding:12px 16px;color:#94a3b8;font-size:13px;font-weight:600">Empresa</td><td style="padding:12px 16px;color:#f1f5f9;font-size:14px;text-align:right">${lead.company_name}</td></tr>` : '<tr><td style="padding:0 0 12px" colspan="2"></td></tr>'}
    </table>
  </td></tr>
  <tr><td style="padding:0 32px 32px;text-align:center">
    <a href="${leadsUrl}" style="display:inline-block;background:#10b981;color:#ffffff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">Ver Lead no Senvia</a>
  </td></tr>
  <tr><td style="padding:16px 32px;border-top:1px solid #334155;text-align:center">
    <p style="color:#64748b;font-size:12px;margin:0">Senvia OS · <a href="https://senvia.pt" style="color:#64748b;text-decoration:underline">senvia.pt</a></p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

            console.log('Sending new-lead email');

            fetch('https://api.brevo.com/v3/smtp/email', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'api-key': brevoKey,
              },
              body: JSON.stringify({
                sender: { email: senderEmail, name: senderName },
                to: recipients,
                subject: `🚀 Novo Lead: ${lead.name} - ${lead.source || 'Formulário'}`,
                htmlContent: applySenviaEmailTemplate(htmlContent, `Novo lead: ${lead.name}`),
              }),
            })
              .then((res) => console.info(`Brevo new-lead email sent, status: ${res.status}`))
              .catch((err) => console.error('Brevo new-lead email failed:', err.message));
          }
        }
      } else {
        console.warn('No Brevo API key available (org or global), skipping new-lead email notification');
      }
    } catch (emailError) {
      console.error('Error sending new-lead email:', emailError);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Contacto registado com sucesso',
        lead_id: lead.id 
      }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Erro interno do servidor' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
