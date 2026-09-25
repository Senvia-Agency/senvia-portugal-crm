import { requestMfaResponse } from "../_shared/user-authorization.ts";
import { applySenviaEmailTemplate } from "../_shared/senvia-email-template.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

interface ProductItem {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface ProposalEmailRequest {
  organizationId: string;
  to: string;
  clientName: string;
  proposalCode: string;
  proposalDate: string;
  totalValue: number;
  products: ProductItem[];
  notes?: string;
  orgName: string;
  logoUrl?: string;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function generateEmailHtml(data: ProposalEmailRequest, senderName: string): string {
  const productsRows = data.products.map(p => `
    <tr>
      <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-size: 14px;">${p.name}</td>
      <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-size: 14px; text-align: center;">${p.quantity}</td>
      <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-size: 14px; text-align: right;">${formatCurrency(p.unitPrice)}</td>
      <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-size: 14px; text-align: right; font-weight: 600;">${formatCurrency(p.total)}</td>
    </tr>
  `).join('');

  const logoSection = data.logoUrl 
    ? `<img src="${data.logoUrl}" alt="${senderName}" style="max-height: 60px; max-width: 200px;" />`
    : `<h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #1f2937;">${senderName}</h1>`;

  const notesSection = data.notes 
    ? `
      <div style="margin-top: 24px; padding: 16px; background: #f9fafb; border-radius: 8px; border-left: 4px solid #3b82f6;">
        <h3 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #374151;">Observações</h3>
        <p style="margin: 0; font-size: 14px; color: #6b7280; white-space: pre-wrap;">${data.notes}</p>
      </div>
    `
    : '';

  return `
    <!DOCTYPE html>
    <html lang="pt">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Proposta ${data.proposalCode}</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
      <div style="max-width: 600px; margin: 0 auto; padding: 32px 16px;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 32px; border-radius: 12px 12px 0 0; text-align: center;">
          <div style="background: white; display: inline-block; padding: 16px 24px; border-radius: 8px; margin-bottom: 16px;">
            ${logoSection}
          </div>
          <h2 style="margin: 16px 0 0 0; font-size: 20px; font-weight: 600; color: white;">Proposta Comercial</h2>
        </div>

        <!-- Content -->
        <div style="background: white; padding: 32px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
          <!-- Proposal Info -->
          <div style="display: flex; justify-content: space-between; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #e5e7eb;">
            <div>
              <p style="margin: 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Proposta Nº</p>
              <p style="margin: 4px 0 0 0; font-size: 18px; font-weight: 700; color: #1f2937;">#${data.proposalCode}</p>
            </div>
            <div style="text-align: right;">
              <p style="margin: 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Data</p>
              <p style="margin: 4px 0 0 0; font-size: 14px; color: #1f2937;">${data.proposalDate}</p>
            </div>
          </div>

          <!-- Client Info -->
          <div style="margin-bottom: 24px;">
            <p style="margin: 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Cliente</p>
            <p style="margin: 4px 0 0 0; font-size: 16px; font-weight: 600; color: #1f2937;">${data.clientName}</p>
            <p style="margin: 4px 0 0 0; font-size: 14px; color: #6b7280;">${data.to}</p>
          </div>

          <!-- Total Value -->
          <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 20px; border-radius: 8px; margin-bottom: 24px; text-align: center;">
            <p style="margin: 0; font-size: 12px; color: rgba(255,255,255,0.8); text-transform: uppercase; letter-spacing: 1px;">Valor Total</p>
            <p style="margin: 8px 0 0 0; font-size: 28px; font-weight: 700; color: white;">${formatCurrency(data.totalValue)}</p>
          </div>

          <!-- Products Table -->
          ${data.products.length > 0 ? `
            <div style="margin-bottom: 24px;">
              <h3 style="margin: 0 0 16px 0; font-size: 14px; font-weight: 600; color: #374151; text-transform: uppercase; letter-spacing: 0.5px;">Produtos/Serviços</h3>
              <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                <thead>
                  <tr style="background: #f9fafb;">
                    <th style="padding: 12px 16px; text-align: left; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase;">Descrição</th>
                    <th style="padding: 12px 16px; text-align: center; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase;">Qtd</th>
                    <th style="padding: 12px 16px; text-align: right; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase;">Preço Unit.</th>
                    <th style="padding: 12px 16px; text-align: right; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${productsRows}
                </tbody>
              </table>
            </div>
          ` : ''}

          ${notesSection}

          <!-- Footer -->
          <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb; text-align: center;">
            <p style="margin: 0; font-size: 12px; color: #9ca3af;">Esta proposta é válida por 30 dias a partir da data de emissão.</p>
            <p style="margin: 8px 0 0 0; font-size: 12px; color: #9ca3af;">Documento gerado automaticamente por ${senderName}</p>
          </div>
        </div>

        <!-- Email Footer -->
        <div style="text-align: center; padding: 24px;">
          <p style="margin: 0; font-size: 12px; color: #9ca3af;">
            Este email foi enviado por ${senderName}. Se tiver dúvidas, responda diretamente a este email.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);

    const data: ProposalEmailRequest = await req.json();

    if (!data.organizationId) {
      throw new Error("Organization ID is required");
    }

    if (!data.to || !data.clientName || !data.proposalCode) {
      throw new Error("Missing required fields: to, clientName, proposalCode");
    }

    // AuthN + AuthZ: only a member of this org may send proposal emails from its
    // Brevo sender. Without this, anyone could send mail from any org's verified
    // sender (phishing) by POSTing an organizationId. A server-to-server call
    // (bearer == service-role key) is treated as trusted.
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    const isInternal = !!bearer && bearer === supabaseServiceKey;
    if (!isInternal) {
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Não autorizado" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authErr } = await authClient.auth.getUser();
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: "Utilizador não autenticado" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const mfaResponse = await requestMfaResponse(req, user.id, corsHeaders);
      if (mfaResponse) return mfaResponse;
      const { data: membership } = await supabaseClient
        .from("organization_members")
        .select("is_active")
        .eq("organization_id", data.organizationId)
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();
      if (!membership) {
        return new Response(JSON.stringify({ error: "Sem acesso a esta organização" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Fetch organization's Brevo configuration
    const { data: orgData, error: orgError } = await supabaseClient
      .from("organizations")
      .select("brevo_api_key, brevo_sender_email, name")
      .eq("id", data.organizationId)
      .single();

    if (orgError) {
      console.error("Error fetching organization:", orgError);
      throw new Error("Failed to fetch organization configuration");
    }

    // Transactional/system email: prefer a dedicated Brevo key (separate from the
    // org's marketing key), then the org key, then the global secret. Non-breaking.
    const BREVO_API_KEY = Deno.env.get("BREVO_TRANSACTIONAL_API_KEY") || orgData?.brevo_api_key || Deno.env.get("BREVO_API_KEY");
    
    if (!BREVO_API_KEY) {
      throw new Error("API Key do Brevo não configurada. Configure em Definições → Integrações → Email (Brevo)");
    }

    // Use organization's sender email or fallback
    const senderEmail = orgData?.brevo_sender_email || "noreply@senvia.pt";
    const senderName = orgData?.name || data.orgName || "SENVIA Software House";

    const htmlContent = applySenviaEmailTemplate(generateEmailHtml(data, senderName), `Proposta ${data.proposalCode}`);

    const brevoPayload = {
      sender: {
        name: senderName,
        email: senderEmail,
      },
      to: [
        {
          email: data.to,
          name: data.clientName,
        },
      ],
      subject: `Proposta #${data.proposalCode} - ${senderName}`,
      htmlContent: htmlContent,
    };

    const brevoResponse = await fetchWithTimeout("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": BREVO_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify(brevoPayload),
    });

    if (!brevoResponse.ok) {
      const errorData = await brevoResponse.json();
      console.error("Brevo API error:", errorData);
      throw new Error(errorData.message || "Erro ao enviar email via Brevo");
    }

    const result = await brevoResponse.json();
    console.log("Email sent successfully:", result);

    return new Response(
      JSON.stringify({ success: true, messageId: result.messageId }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error in send-proposal-email:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
});
