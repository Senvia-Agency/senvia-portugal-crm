import { requestMfaResponse } from "../_shared/user-authorization.ts";
import { applySenviaEmailTemplate } from "../_shared/senvia-email-template.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

interface SendAccessEmailRequest {
  organizationId: string;
  recipientEmail: string;
  recipientName: string;
  loginUrl: string;
  companyCode: string;
  password?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Verify caller is authenticated
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Não autorizado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Utilizador não autenticado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const mfaResponse = await requestMfaResponse(req, user.id, corsHeaders);
    if (mfaResponse) return mfaResponse;

    const { organizationId, recipientEmail, recipientName, loginUrl, companyCode, password }: SendAccessEmailRequest = await req.json();

    if (!organizationId || !recipientEmail || !recipientName || !loginUrl || !companyCode) {
      return new Response(
        JSON.stringify({ error: 'Campos obrigatórios em falta' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // AuthZ: the authenticated caller must belong to the org they're emailing on
    // behalf of. Without this, any logged-in user could send a branded credential
    // email from ANOTHER org's verified Brevo sender (strong phishing primitive).
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('is_active')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();
    if (!membership) {
      return new Response(
        JSON.stringify({ error: 'Sem acesso a esta organização' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get org Brevo config
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('brevo_api_key, brevo_sender_email, name')
      .eq('id', organizationId)
      .single();

    if (orgError || !org) {
      console.error('Error fetching organization:', orgError);
      return new Response(
        JSON.stringify({ error: 'Organização não encontrada' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Transactional/system email: prefer a dedicated Brevo key (separate from
    // marketing), then org key, then global secret. Non-breaking.
    const brevoApiKey = Deno.env.get('BREVO_TRANSACTIONAL_API_KEY') || org.brevo_api_key || Deno.env.get('BREVO_API_KEY');
    const senderEmail = org.brevo_sender_email || 'noreply@senvia.pt';

    if (!brevoApiKey) {
      return new Response(
        JSON.stringify({ error: 'API Key do Brevo não configurada. Configure em Definições → Integrações → Email (Brevo)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const orgName = org.name;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color:#18181b;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${orgName}</h1>
              <p style="margin:8px 0 0;color:#a1a1aa;font-size:14px;">Bem-vindo à equipa!</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 20px;color:#27272a;font-size:15px;line-height:1.6;">
                Olá <strong>${recipientName}</strong>,
              </p>
              <p style="margin:0 0 24px;color:#52525b;font-size:14px;line-height:1.6;">
                Foi criado um acesso para si no sistema <strong>${orgName}</strong>. Utilize as credenciais abaixo para entrar:
              </p>
              
              <!-- Credentials -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;border-radius:8px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:6px 0;">
                          <span style="color:#71717a;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Link de Acesso</span><br>
                          <a href="${loginUrl}" style="color:#2563eb;font-size:14px;font-family:monospace;word-break:break-all;">${loginUrl}</a>
                        </td>
                      </tr>
                      <tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;"></td></tr>
                      <tr>
                        <td style="padding:10px 0 6px;">
                          <span style="color:#71717a;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Código da Empresa</span><br>
                          <span style="color:#18181b;font-size:16px;font-weight:600;font-family:monospace;">${companyCode}</span>
                        </td>
                      </tr>
                      <tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;"></td></tr>
                      <tr>
                        <td style="padding:10px 0 6px;">
                          <span style="color:#71717a;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Email</span><br>
                          <span style="color:#18181b;font-size:14px;font-family:monospace;">${recipientEmail}</span>
                        </td>
                      </tr>
                      ${password ? `
                      <tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;"></td></tr>
                      <tr>
                        <td style="padding:10px 0 6px;">
                          <span style="color:#71717a;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Password</span><br>
                          <span style="color:#18181b;font-size:14px;font-weight:600;font-family:monospace;">${password}</span>
                        </td>
                      </tr>
                      ` : `
                      <tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;"></td></tr>
                      <tr>
                        <td style="padding:10px 0 6px;">
                          <span style="color:#71717a;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Password</span><br>
                          <span style="color:#52525b;font-size:14px;font-style:italic;">Utilize a sua palavra-passe atual</span>
                        </td>
                      </tr>
                      `}
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${loginUrl}" style="display:inline-block;background-color:#18181b;color:#ffffff;font-size:14px;font-weight:600;padding:12px 32px;border-radius:8px;text-decoration:none;">
                      Aceder ao Sistema
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="margin:24px 0 0;color:#a1a1aa;font-size:12px;text-align:center;line-height:1.5;">
                Recomendamos que altere a sua password após o primeiro acesso.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;background-color:#fafafa;border-top:1px solid #f4f4f5;text-align:center;">
              <p style="margin:0;color:#a1a1aa;font-size:11px;">
                Este email foi enviado automaticamente por ${orgName}.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    // Send via Brevo API
    const brevoRes = await fetchWithTimeout('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': brevoApiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: orgName },
        to: [{ email: recipientEmail, name: recipientName }],
        subject: `${orgName} — As suas credenciais de acesso`,
        htmlContent: applySenviaEmailTemplate(htmlContent, `${orgName} — Acesso ao sistema`),
      }),
    });

    if (!brevoRes.ok) {
      const errBody = await brevoRes.text();
      console.error('Brevo API error:', brevoRes.status, errBody);
      return new Response(
        JSON.stringify({ error: `Erro ao enviar email via Brevo: ${brevoRes.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const result = await brevoRes.json();
    console.log('Email sent successfully via Brevo:', result);

    return new Response(
      JSON.stringify({ success: true, messageId: result.messageId }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Erro interno do servidor' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
