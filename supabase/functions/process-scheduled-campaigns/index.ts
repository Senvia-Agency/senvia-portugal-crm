import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { applySenviaEmailTemplate } from "../_shared/senvia-email-template.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 10;
const APP_BASE_URL = "https://app.senvia.pt";

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
  supabase: ReturnType<typeof createClient>,
  organizationId: string,
  email: string,
  name: string | null | undefined,
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
      source: "campaign",
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

async function createUnsubscribeUrl(
  supabase: ReturnType<typeof createClient>,
  organizationId: string,
  contactId: string,
  emailSendId: string,
): Promise<string | null> {
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

  return buildUnsubscribeUrl(token);
}

serve(async (req: Request): Promise<Response> => {
  const denied = await internalJobGuard(req);
  if (denied) return denied;
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: campaigns, error: campaignsError } = await supabase
      .from("email_campaigns")
      .select("*")
      .eq("status", "scheduled")
      .lte("scheduled_at", new Date().toISOString());

    if (campaignsError) {
      return new Response(
        JSON.stringify({ error: campaignsError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!campaigns || campaigns.length === 0) {
      return new Response(
        JSON.stringify({ message: "No scheduled campaigns to process" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: { campaignId: string; status: string; sent: number; failed: number }[] = [];

    for (const campaign of campaigns) {
      try {
        console.log(`Processing scheduled campaign: ${campaign.id} - ${campaign.name}`);

        await supabase
          .from("email_campaigns")
          .update({ status: "sending" })
          .eq("id", campaign.id);

        const { data: queuedSends, error: queuedError } = await supabase
          .from("email_sends")
          .select("*")
          .eq("campaign_id", campaign.id)
          .eq("status", "queued");

        if (queuedError) {
          console.error(`Campaign ${campaign.id} failed to load queued recipients:`, queuedError);
        }

        if (!queuedSends || queuedSends.length === 0) {
          console.warn(`Campaign ${campaign.id} has no queued recipients and will be marked as failed.`);
          await supabase
            .from("email_campaigns")
            .update({ status: "failed", sent_count: 0, failed_count: 0 })
            .eq("id", campaign.id);
          results.push({ campaignId: campaign.id, status: "failed", sent: 0, failed: 0 });
          continue;
        }

        const { data: org, error: orgError } = await supabase
          .from("organizations")
          .select("name, brevo_api_key, brevo_sender_email")
          .eq("id", campaign.organization_id)
          .single();

        if (orgError) {
          console.error(`Campaign ${campaign.id} failed to load organization sender config:`, orgError);
        }

        if (!org?.brevo_api_key || !org?.brevo_sender_email) {
          console.error(`Campaign ${campaign.id} is missing sender configuration.`, {
            hasApiKey: Boolean(org?.brevo_api_key),
            hasSenderEmail: Boolean(org?.brevo_sender_email),
            organizationId: campaign.organization_id,
          });
          await supabase
            .from("email_campaigns")
            .update({ status: "failed" })
            .eq("id", campaign.id);
          results.push({ campaignId: campaign.id, status: "failed", sent: 0, failed: 0 });
          continue;
        }

        let emailSubject = campaign.subject || "";
        let emailHtml = campaign.html_content || "";

        if (campaign.template_id) {
          const { data: template, error: templateError } = await supabase
            .from("email_templates")
            .select("subject, html_content")
            .eq("id", campaign.template_id)
            .single();

          if (templateError) {
            console.error(`Campaign ${campaign.id} failed to load template ${campaign.template_id}:`, templateError);
          }

          if (template) {
            emailSubject = template.subject;
            emailHtml = template.html_content;
          } else {
            console.error(`Campaign ${campaign.id} template ${campaign.template_id} was not found.`);
          }
        }

        if (!emailSubject.trim() || !emailHtml.trim()) {
          console.error(`Campaign ${campaign.id} is missing subject or HTML content.`, {
            hasSubject: Boolean(emailSubject.trim()),
            hasHtml: Boolean(emailHtml.trim()),
            templateId: campaign.template_id,
          });
          await supabase
            .from("email_campaigns")
            .update({ status: "failed" })
            .eq("id", campaign.id);
          results.push({ campaignId: campaign.id, status: "failed", sent: 0, failed: 0 });
          continue;
        }

        let senderEmail = org.brevo_sender_email;
        let senderName = org.name;

        if (campaign.created_by) {
          const { data: creatorProfile } = await supabase
            .from("profiles")
            .select("brevo_sender_email, full_name")
            .eq("id", campaign.created_by)
            .single();
          if (creatorProfile?.brevo_sender_email) {
            senderEmail = creatorProfile.brevo_sender_email;
            senderName = creatorProfile.full_name || org.name;
          }
        }

        const campaignSettings = (campaign.settings as Record<string, boolean>) || {};
        const campaignSettingsData = (campaign.settings_data as Record<string, string>) || {};

        async function processSend(send: typeof queuedSends[0]): Promise<{ sent: boolean }> {
          try {
            const variables: Record<string, string> = {
              nome: send.recipient_name || "",
              email: send.recipient_email || "",
              organizacao: org.name || "",
              data: new Date().toLocaleDateString("pt-PT", { day: "2-digit", month: "long", year: "numeric" }),
            };

            let finalSubject = emailSubject;
            let finalHtml = emailHtml;

            for (const [key, value] of Object.entries(variables)) {
              const regex = new RegExp(`{{\\s*${key}\\s*}}`, "gi");
              finalSubject = finalSubject.replace(regex, value || "");
              finalHtml = finalHtml.replace(regex, value || "");
            }

            if (campaignSettings.custom_header && campaignSettingsData.custom_header) {
              finalHtml = campaignSettingsData.custom_header + finalHtml;
            }
            if (campaignSettings.custom_footer && campaignSettingsData.custom_footer) {
              finalHtml = finalHtml + campaignSettingsData.custom_footer;
            }
            if (campaignSettings.custom_unsubscribe && campaignSettingsData.custom_unsubscribe) {
              finalHtml = finalHtml.replace(/\{\{\s*unsubscribe\s*\}\}/gi, campaignSettingsData.custom_unsubscribe);
            }
            if (campaignSettings.ga_tracking && campaignSettingsData.ga_tracking) {
              finalHtml = finalHtml.replace(
                /href="(https?:\/\/[^"]+)"/gi,
                (_match: string, url: string) => {
                  try {
                    const u = new URL(url);
                    u.searchParams.set("utm_source", "brevo");
                    u.searchParams.set("utm_medium", "email");
                    u.searchParams.set("utm_campaign", campaignSettingsData.ga_tracking);
                    return `href="${u.toString()}"`;
                  } catch {
                    return _match;
                  }
                }
              );
            }

            if (/\{\{\s*unsubscribe\s*\}\}/i.test(finalHtml)) {
              const contactId = await ensureMarketingContact(
                supabase,
                campaign.organization_id,
                send.recipient_email,
                send.recipient_name,
              );

              if (contactId) {
                const unsubscribeUrl = await createUnsubscribeUrl(supabase, campaign.organization_id, contactId, send.id);
                if (unsubscribeUrl) {
                  finalHtml = finalHtml.replace(/\{\{\s*unsubscribe\s*\}\}/gi, unsubscribeUrl);
                }
              }
            }

            const brevoPayload: Record<string, unknown> = {
              sender: { name: senderName, email: senderEmail },
              to: [{ email: send.recipient_email, name: send.recipient_name || send.recipient_email }],
              subject: finalSubject,
              htmlContent: applySenviaEmailTemplate(finalHtml, finalSubject),
            };

            if (campaignSettings.different_reply_to && campaignSettingsData.different_reply_to) {
              brevoPayload.replyTo = { email: campaignSettingsData.different_reply_to };
            }
            if (campaignSettings.tag && campaignSettingsData.tag) {
              brevoPayload.tags = [campaignSettingsData.tag];
            }

            const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
              method: "POST",
              headers: {
                accept: "application/json",
                "api-key": org.brevo_api_key,
                "content-type": "application/json",
              },
              body: JSON.stringify(brevoPayload),
            });

            if (brevoResponse.ok) {
              let brevoMessageId: string | null = null;
              try {
                const brevoData = await brevoResponse.json();
                brevoMessageId = brevoData.messageId || null;
              } catch {
                // ignore parse error
              }

              await supabase
                .from("email_sends")
                .update({
                  status: "sent",
                  sent_at: new Date().toISOString(),
                  brevo_message_id: brevoMessageId,
                })
                .eq("id", send.id);
              return { sent: true };
            }

            const errorText = await brevoResponse.text();
            await supabase
              .from("email_sends")
              .update({ status: "failed", error_message: errorText })
              .eq("id", send.id);
            return { sent: false };
          } catch (sendError) {
            const errMsg = sendError instanceof Error ? sendError.message : "Unknown error";
            await supabase
              .from("email_sends")
              .update({ status: "failed", error_message: errMsg })
              .eq("id", send.id);
            return { sent: false };
          }
        }

        let sentCount = 0;
        let failedCount = 0;
        const batches = chunk(queuedSends, BATCH_SIZE);

        for (const batch of batches) {
          const batchResults = await Promise.all(batch.map(processSend));
          for (const r of batchResults) {
            if (r.sent) sentCount++;
            else failedCount++;
          }
        }

        await supabase
          .from("email_campaigns")
          .update({
            status: failedCount === queuedSends.length ? "failed" : "sent",
            sent_count: sentCount,
            failed_count: failedCount,
            sent_at: new Date().toISOString(),
          })
          .eq("id", campaign.id);

        results.push({ campaignId: campaign.id, status: "sent", sent: sentCount, failed: failedCount });
        console.log(`Campaign ${campaign.id}: ${sentCount} sent, ${failedCount} failed`);
      } catch (campaignError) {
        console.error(`Error processing campaign ${campaign.id}:`, campaignError);
        await supabase
          .from("email_campaigns")
          .update({ status: "failed" })
          .eq("id", campaign.id);
        results.push({ campaignId: campaign.id, status: "failed", sent: 0, failed: 0 });
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed: results.length, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in process-scheduled-campaigns:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
import { internalJobGuard } from "../_shared/internal-auth.ts";
