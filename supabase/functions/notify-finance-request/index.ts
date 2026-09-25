import { requestMfaResponse } from "../_shared/user-authorization.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applySenviaEmailTemplate } from "../_shared/senvia-email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REQUEST_TYPE_LABELS: Record<string, string> = {
  expense_reimbursement: "Reembolso de Despesa",
  supplier_invoice: "Fatura de Fornecedor",
  vacation_map: "Mapa de Férias",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authenticationError } = await supabase.auth.getUser(token);
    if (authenticationError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const mfaResponse = await requestMfaResponse(req, user.id, corsHeaders);
    if (mfaResponse) return mfaResponse;

    const userId = user.id;

    const { organization_id, title, request_type } = await req.json();
    if (!organization_id || !title) {
      return new Response(JSON.stringify({ error: "Missing fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get org settings
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // AuthZ: the caller must belong to organization_id. Without this, any logged-in
    // user could send a forged "internal request" email to ANY org's finance inbox
    // (from that org's own sender), with attacker-controlled HTML.
    const { data: membership } = await adminClient
      .from("organization_members")
      .select("is_active")
      .eq("organization_id", organization_id)
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    if (!membership) {
      return new Response(JSON.stringify({ error: "Sem acesso a esta organização" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Escape user-controlled values before interpolating into the email HTML.
    const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

    const { data: org } = await adminClient
      .from("organizations")
      .select("finance_email, brevo_api_key, brevo_sender_email, name")
      .eq("id", organization_id)
      .single();

    // Transactional/system email: prefer a dedicated Brevo key (separate from marketing).
    const brevoKey = Deno.env.get("BREVO_TRANSACTIONAL_API_KEY") || org?.brevo_api_key;
    if (!org?.finance_email || !brevoKey || !org?.brevo_sender_email) {
      return new Response(JSON.stringify({ skipped: true, reason: "No finance email or Brevo config" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get submitter name
    const { data: profile } = await adminClient
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .single();

    const submitterName = profile?.full_name || "Colaborador";
    const typeLabel = REQUEST_TYPE_LABELS[request_type] || request_type;

    // Send email via Brevo
    const emailRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": brevoKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { email: org.brevo_sender_email, name: org.name || "Senvia" },
        to: [{ email: org.finance_email }],
        subject: `Novo Pedido Interno: ${title}`,
        htmlContent: applySenviaEmailTemplate(`
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a1a1a;">Novo Pedido Interno</h2>
            <p>Foi submetido um novo pedido interno que requer a sua atenção.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Título</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${esc(title)}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Tipo</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${esc(typeLabel)}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Submetido por</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${esc(submitterName)}</td>
              </tr>
            </table>
            <p style="color: #666; font-size: 14px;">Aceda à plataforma para validar e processar este pedido.</p>
          </div>
        `, `Novo Pedido Interno: ${title}`),
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error("Brevo error:", errText);
      return new Response(JSON.stringify({ error: "Email send failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
