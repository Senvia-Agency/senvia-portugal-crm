import { requestMfaResponse } from "../_shared/user-authorization.ts";
import { applySenviaEmailTemplate } from "../_shared/senvia-email-template.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 10;
const APP_BASE_URL = "https://app.senvia.pt";

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

interface Recipient {
  email: string;
  name: string;
  clientId?: string;
  variables?: Record<string, string>;
}

interface SendTemplateRequest {
  organizationId: string;
  templateId?: string;
  recipients: Recipient[];
  campaignId?: string;
  automationId?: string;
  settings?: Record<string, boolean>;
  settingsData?: Record<string, string>;
  subject?: string;
  htmlContent?: string;
}

function sanitizeVariableTags(html: string): string {
  return html.replace(/\{\{[^}]*\}\}/g, (match) => match.replace(/<[^>]*>/g, ""));
}

function replaceVariables(content: string, variables: Record<string, string>): string {
  let result = sanitizeVariableTags(content);
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, "gi");
    result = result.replace(regex, value || "");
  }
  return result;
}

function formatDate(): string {
  return new Date().toLocaleDateString("pt-PT", { day: "2-digit", month: "long", year: "numeric" });
}

function addUtmTracking(html: string, campaignName: string): string {
  return html.replace(
    /href="(https?:\/\/[^"]+)"/gi,
    (_match, url) => {
      try {
        const u = new URL(url);
        u.searchParams.set("utm_source", "brevo");
        u.searchParams.set("utm_medium", "email");
        u.searchParams.set("utm_campaign", campaignName);
        return `href="${u.toString()}"`;
      } catch {
        return _match;
      }
    }
  );
}

function applyHtmlSettings(
  html: string,
  settings: Record<string, boolean>,
  settingsData: Record<string, string>
): string {
  let result = html;
  if (settings.custom_header && settingsData.custom_header) {
    result = settingsData.custom_header + result;
  }
  if (settings.custom_footer && settingsData.custom_footer) {
    result = result + settingsData.custom_footer;
  }
  if (settings.custom_unsubscribe && settingsData.custom_unsubscribe) {
    result = result.replace(/\{\{\s*unsubscribe\s*\}\}/gi, settingsData.custom_unsubscribe);
  }
  if (settings.ga_tracking && settingsData.ga_tracking) {
    result = addUtmTracking(result, settingsData.ga_tracking);
  }
  return result;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function generateUnsubscribeToken(): string {
  return `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
}

function buildUnsubscribeUrl(token: string): string {
  return `${APP_BASE_URL}/unsubscribe?token=${encodeURIComponent(token)}`;
}

async function ensureMarketingContact(
  supabase: SupabaseClient<any>,
  organizationId: string,
  email: string,
  name: string | null | undefined,
  source: string,
): Promise<string | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const { data: existing } = await supabase
    .from("marketing_contacts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (existing?.id) {
    return existing.id;
  }

  const { data: inserted, error } = await supabase
    .from("marketing_contacts")
    .insert({
      organization_id: organizationId,
      email: normalizedEmail,
      name: name?.trim() || normalizedEmail,
      source,
      subscribed: true,
    })
    .select("id")
    .single();

  if (!error && inserted?.id) {
    return inserted.id;
  }

  const { data: fallback } = await supabase
    .from("marketing_contacts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("email", normalizedEmail)
    .maybeSingle();

  return fallback?.id ?? null;
}

async function createUnsubscribeToken(
  supabase: SupabaseClient<any>,
  organizationId: string,
  contactId: string,
  emailSendId: string | null,
): Promise<{ token: string; url: string } | null> {
  const token = generateUnsubscribeToken();

  const { error } = await supabase
    .from("email_unsubscribe_tokens")
    .insert({
      organization_id: organizationId,
      contact_id: contactId,
      email_send_id: emailSendId,
      token,
    });

  if (error) {
    console.error("Failed to create unsubscribe token:", error);
    return null;
  }

  return {
    token,
    url: buildUnsubscribeUrl(token),
  };
}

async function insertEmailSendRecord(
  supabase: SupabaseClient<any>,
  emailSendRecord: Record<string, unknown>,
): Promise<string | null> {
  const primaryInsert = await supabase
    .from("email_sends")
    .insert(emailSendRecord)
    .select("id")
    .single();

  if (!primaryInsert.error && primaryInsert.data?.id) {
    return primaryInsert.data.id;
  }

  const fallbackInsert = await supabase
    .from("email_sends")
    .insert({ ...emailSendRecord, client_id: null })
    .select("id")
    .single();

  if (!fallbackInsert.error && fallbackInsert.data?.id) {
    return fallbackInsert.data.id;
  }

  console.error("Failed to insert email_sends record", primaryInsert.error || fallbackInsert.error);
  return null;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const {
      organizationId, templateId, recipients, campaignId, automationId,
      settings = {}, settingsData = {},
      subject: customSubject, htmlContent: customHtmlContent,
    }: SendTemplateRequest = await req.json();

    if (!organizationId || !recipients || recipients.length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!templateId && (!customSubject || !customHtmlContent)) {
      return new Response(
        JSON.stringify({ error: "Missing template or custom content" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // AuthN + AuthZ: this function is called BOTH from the app (a user JWT) and
    // server-to-server by automations/campaigns (bearer == service-role key).
    // Internal calls are trusted; otherwise require a logged-in member of the org.
    // Without this, anyone could send bulk email from any org's Brevo (phishing/quota).
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
      const { data: membership } = await supabase
        .from("organization_members")
        .select("is_active")
        .eq("organization_id", organizationId)
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();
      if (!membership) {
        return new Response(JSON.stringify({ error: "Sem acesso a esta organização" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let templateSubject = customSubject || "";
    let templateHtmlContent = customHtmlContent || "";

    if (templateId) {
      const { data: template, error: templateError } = await supabase
        .from("email_templates")
        .select("*")
        .eq("id", templateId)
        .eq("organization_id", organizationId)
        .single();

      if (templateError || !template) {
        return new Response(
          JSON.stringify({ error: "Template not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      templateSubject = template.subject;
      templateHtmlContent = template.html_content;
    }

    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("name, brevo_api_key, brevo_sender_email")
      .eq("id", organizationId)
      .single();

    if (orgError || !org) {
      return new Response(
        JSON.stringify({ error: "Organization not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!org.brevo_api_key || !org.brevo_sender_email) {
      return new Response(
        JSON.stringify({ error: "Brevo API not configured for this organization" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Reuses `bearer` (parsed once, above) instead of re-reading the header —
    // a second `const authHeader` here was a duplicate declaration in the same
    // scope, a SyntaxError that kept this ENTIRE function from booting
    // (BOOT_ERROR/503 on every single call) since 2026-07-05. Behaviour is
    // unchanged: for an internal service-role caller `bearer` doesn't resolve
    // to a user, so userId/senderSignature stay null exactly as before.
    let userId: string | null = null;
    let senderSignature: string | null = null;
    let senderEmailOverride: string | null = null;
    let senderNameOverride: string | null = null;

    if (bearer) {
      const { data: { user } } = await supabase.auth.getUser(bearer);
      userId = user?.id || null;

      if (userId) {
        const { data: senderProfile } = await supabase
          .from("profiles")
          .select("email_signature, brevo_sender_email, full_name")
          .eq("id", userId)
          .single();
        senderSignature = (senderProfile as any)?.email_signature || null;
        const senderBrevoEmail = (senderProfile as any)?.brevo_sender_email;
        if (senderBrevoEmail) {
          senderEmailOverride = senderBrevoEmail;
          senderNameOverride = (senderProfile as any)?.full_name || org.name;
        }
      }
    }

    const clientIds = [...new Set(recipients.filter(r => r.clientId).map(r => r.clientId!))];
    const vendorMap: Record<string, { name: string; email: string; phone: string }> = {};

    if (clientIds.length > 0) {
      const { data: clientsData } = await supabase
        .from("crm_clients")
        .select("id, assigned_to")
        .in("id", clientIds);

      if (clientsData) {
        const profileIds = [...new Set(clientsData.filter(c => c.assigned_to).map(c => c.assigned_to!))];
        const profileMap: Record<string, any> = {};

        if (profileIds.length > 0) {
          const { data: profilesData } = await supabase
            .from("profiles")
            .select("id, full_name, email, phone")
            .in("id", profileIds);

          if (profilesData) {
            for (const p of profilesData) {
              profileMap[p.id] = p;
            }
          }
        }

        for (const client of clientsData) {
          if (client.assigned_to && profileMap[client.assigned_to]) {
            const p = profileMap[client.assigned_to];
            vendorMap[client.id] = {
              name: p.full_name || "",
              email: p.email || "",
              phone: p.phone || "",
            };
          }
        }
      }
    }

    const finalSenderEmail = senderEmailOverride || org.brevo_sender_email;
    const finalSenderName = senderNameOverride || org.name;
    const formattedDate = formatDate();
    const organizationName = org.name;
    const brevoApiKey = org.brevo_api_key;

    async function processRecipient(recipient: Recipient): Promise<{ email: string; status: string; error?: string }> {
      let unsubscribeToken: string | null = null;

      try {
        const vendor = recipient.clientId ? vendorMap[recipient.clientId] : undefined;

        const variables: Record<string, string> = {
          nome: recipient.name || "",
          email: recipient.email || "",
          organizacao: organizationName || "",
          data: formattedDate,
          vendedor: vendor?.name || "",
          vendedor_email: vendor?.email || "",
          vendedor_telefone: vendor?.phone || "",
          assinatura: senderSignature || "",
          ...recipient.variables,
        };

        const subject = replaceVariables(templateSubject, variables);
        let htmlContent = replaceVariables(templateHtmlContent, variables);
        htmlContent = applyHtmlSettings(htmlContent, settings, settingsData);

        if (/\{\{\s*unsubscribe\s*\}\}/i.test(htmlContent)) {
          const contactId = await ensureMarketingContact(
            supabase,
            organizationId,
            recipient.email,
            recipient.name,
            campaignId ? "campaign" : automationId ? "automation" : "manual_email",
          );

          if (contactId) {
            const unsubscribeData = await createUnsubscribeToken(supabase, organizationId, contactId, null);
            if (unsubscribeData) {
              unsubscribeToken = unsubscribeData.token;
              htmlContent = htmlContent.replace(/\{\{\s*unsubscribe\s*\}\}/gi, unsubscribeData.url);
            }
          }
        }

        const toName = settings.customize_to && recipient.variables?.empresa
          ? `${recipient.name} - ${recipient.variables.empresa}`
          : (recipient.name || recipient.email);

        const brevoPayload: Record<string, unknown> = {
          sender: { name: finalSenderName, email: finalSenderEmail },
          to: [{ email: recipient.email, name: toName }],
          subject,
          htmlContent: applySenviaEmailTemplate(htmlContent, subject),
        };

        if (settings.different_reply_to && settingsData.different_reply_to) {
          brevoPayload.replyTo = { email: settingsData.different_reply_to };
        }
        if (settings.tag && settingsData.tag) {
          brevoPayload.tags = [settingsData.tag];
        }

        const brevoResponse = await fetchWithTimeout("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "accept": "application/json",
            "api-key": brevoApiKey,
            "content-type": "application/json",
          },
          body: JSON.stringify(brevoPayload),
        });

        const status = brevoResponse.ok ? "sent" : "failed";
        const errorMessage = brevoResponse.ok ? null : await brevoResponse.text();

        let brevoMessageId: string | null = null;
        if (brevoResponse.ok) {
          try {
            const brevoData = await brevoResponse.json();
            brevoMessageId = brevoData.messageId || null;
          } catch {
            // ignore parse error
          }
        }

        const emailSendRecord = {
          organization_id: organizationId,
          template_id: templateId || null,
          campaign_id: campaignId || null,
          automation_id: automationId || null,
          client_id: recipient.clientId || null,
          recipient_email: recipient.email,
          recipient_name: recipient.name,
          subject,
          status,
          error_message: errorMessage,
          sent_at: status === "sent" ? new Date().toISOString() : null,
          sent_by: userId,
          brevo_message_id: brevoMessageId,
        };

        const emailSendId = await insertEmailSendRecord(supabase, emailSendRecord);

        if (unsubscribeToken && emailSendId) {
          await supabase
            .from("email_unsubscribe_tokens")
            .update({ email_send_id: emailSendId })
            .eq("token", unsubscribeToken);
        }

        return { email: recipient.email, status, error: errorMessage || undefined };
      } catch (recipientError) {
        const errorMsg = recipientError instanceof Error ? recipientError.message : "Unknown error";

        const failRecord = {
          organization_id: organizationId,
          template_id: templateId || null,
          campaign_id: campaignId || null,
          automation_id: automationId || null,
          client_id: recipient.clientId || null,
          recipient_email: recipient.email,
          recipient_name: recipient.name,
          subject: templateSubject,
          status: "failed",
          error_message: errorMsg,
          sent_by: userId,
        };

        const emailSendId = await insertEmailSendRecord(supabase, failRecord);

        if (unsubscribeToken && emailSendId) {
          await supabase
            .from("email_unsubscribe_tokens")
            .update({ email_send_id: emailSendId })
            .eq("token", unsubscribeToken);
        }

        return { email: recipient.email, status: "failed", error: errorMsg };
      }
    }

    const results: { email: string; status: string; error?: string }[] = [];
    const batches = chunk(recipients, BATCH_SIZE);

    for (const batch of batches) {
      const batchResults = await Promise.all(batch.map(processRecipient));
      results.push(...batchResults);
    }

    const successful = results.filter(r => r.status === "sent").length;
    const failed = results.filter(r => r.status === "failed").length;

    return new Response(
      JSON.stringify({
        success: true,
        summary: { total: recipients.length, sent: successful, failed },
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in send-template-email:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
