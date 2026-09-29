import { requestMfaResponse } from "../_shared/user-authorization.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applySenviaEmailTemplate } from "../_shared/senvia-email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REQUEST_TYPE_LABELS: Record<string, string> = {
  expense: "Despesa",
  vacation: "Férias",
  invoice: "Fatura",
};

const STATUS_LABELS: Record<string, string> = {
  approved: "Aprovado",
  rejected: "Rejeitado",
  paid: "Pago",
};

const STATUS_COLORS: Record<string, string> = {
  approved: "#16a34a",
  rejected: "#dc2626",
  paid: "#15803d",
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

    const { request_id, organization_id, new_status, review_notes } = await req.json();
    if (!request_id || !organization_id || !new_status) {
      return new Response(JSON.stringify({ error: "Missing fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // AuthZ: the caller must belong to organization_id. Without this, any logged-in
    // user could look up another org's request and email its submitter a forged
    // approval/rejection (financial-fraud / social engineering).
    const userId = user.id;
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

    // Get request details (scoped to the org so a forged request_id can't read another tenant's request)
    const { data: request, error: reqError } = await adminClient
      .from("internal_requests")
      .select("submitted_by, title, request_type")
      .eq("id", request_id)
      .eq("organization_id", organization_id)
      .single();

    if (reqError || !request) {
      console.error("Request not found:", reqError);
      return new Response(JSON.stringify({ error: "Request not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get submitter email from auth.users
    const { data: userData, error: userError } = await adminClient.auth.admin.getUserById(request.submitted_by);
    if (userError || !userData?.user?.email) {
      console.error("User not found:", userError);
      return new Response(JSON.stringify({ skipped: true, reason: "No user email" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get org settings (Brevo credentials)
    const { data: org } = await adminClient
      .from("organizations")
      .select("brevo_api_key, brevo_sender_email, name")
      .eq("id", organization_id)
      .single();

    // Transactional/system email: prefer a dedicated Brevo key (separate from marketing).
    const brevoKey = Deno.env.get("BREVO_TRANSACTIONAL_API_KEY") || org?.brevo_api_key;
    if (!brevoKey || !org?.brevo_sender_email) {
      return new Response(JSON.stringify({ skipped: true, reason: "No Brevo config" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const statusLabel = STATUS_LABELS[new_status] || new_status;
    const statusColor = STATUS_COLORS[new_status] || "#333";
    const typeLabel = REQUEST_TYPE_LABELS[request.request_type] || request.request_type;

    const notesHtml = review_notes
      ? `<tr>
           <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Notas</td>
           <td style="padding: 8px; border-bottom: 1px solid #eee;">${esc(review_notes)}</td>
         </tr>`
      : "";

    const emailRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": brevoKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { email: org.brevo_sender_email, name: org.name || "Senvia" },
        to: [{ email: userData.user.email }],
        subject: `Pedido ${statusLabel}: ${request.title}`,
        htmlContent: applySenviaEmailTemplate(`
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a1a1a;">Atualização do Pedido Interno</h2>
            <p>O seu pedido foi atualizado com o seguinte estado:</p>
            <div style="text-align: center; margin: 24px 0;">
              <span style="display: inline-block; padding: 8px 24px; border-radius: 6px; background-color: ${statusColor}; color: #fff; font-size: 18px; font-weight: bold;">
                ${esc(statusLabel)}
              </span>
            </div>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Título</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${esc(request.title)}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Tipo</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${esc(typeLabel)}</td>
              </tr>
              ${notesHtml}
            </table>
            <p style="color: #666; font-size: 14px;">Aceda à plataforma para mais detalhes.</p>
          </div>
        `, `Pedido ${statusLabel}: ${request.title}`),
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
