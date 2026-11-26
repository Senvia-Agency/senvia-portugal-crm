import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isLeadTrigger, leadAutomationBlocked, leadIdForTrigger } from "../_shared/legacy-automation-lead-consent.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-automation-secret",
};

interface AutomationEvent {
  trigger_type: string;
  organization_id: string;
  record: Record<string, unknown>;
  old_record?: Record<string, unknown>;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // SECURITY: this function had no auth check — an anonymous caller could
    // supply an arbitrary organization_id + record.email and have a real,
    // org-branded email sent (via send-template-email, invoked below with the
    // service-role bearer) to any address they chose. This is internal-only:
    // every legitimate caller (stripe-webhook, trial-inactivity-check,
    // check-trial-status, and the DB triggers dispatching automations) is a
    // trusted backend process, never an end user.
    //
    // Two accepted credentials:
    //   * the service-role bearer, used by the edge functions that dispatch
    //     automations (stripe-webhook, check-trial-status, …);
    //   * x-automation-secret, used by the database triggers. Postgres cannot
    //     read the service-role key, so it sends a shared secret that lives
    //     only in Supabase Vault and is compared by verify_automation_secret
    //     without ever being returned. Before this existed the triggers sent
    //     the anon key, every dispatch 401'd, and the trigger swallowed the
    //     error — every CRM-event automation was silently dead.
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    let authorized = !!bearer && bearer === supabaseServiceKey;

    if (!authorized) {
      const provided = req.headers.get("x-automation-secret");
      if (provided) {
        const { data, error } = await supabase.rpc("verify_automation_secret", { p_secret: provided });
        if (error) console.error("[process-automation] verificação do segredo falhou:", error.message);
        authorized = data === true;
      }
    }

    if (!authorized) {
      console.error("[process-automation] pedido rejeitado: sem credencial válida");
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { trigger_type, organization_id, record, old_record }: AutomationEvent = await req.json();

    if (!trigger_type || !organization_id || !record) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Forward non-CRUD triggers (trial_*, stripe_*, renewals) to the flow
    // engine. The CRUD ones are NOT forwarded — the DB trigger already
    // dispatches those to both systems, and doubling them here would enrol the
    // same contact twice. Fire-and-forget: the legacy path below must never
    // wait on (or fail with) the engine.
    const CRUD_TRIGGERS = new Set([
      "lead_created", "lead_status_changed",
      "client_created", "client_status_changed",
      "sale_created", "sale_status_changed",
      "proposal_created", "proposal_status_changed",
    ]);
    if (!CRUD_TRIGGERS.has(trigger_type)) {
      fetch(`${supabaseUrl}/functions/v1/automation-engine`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          action: "enroll",
          trigger_type,
          organization_id,
          subject_type: "contact",
          record,
          old_record,
        }),
      }).catch((e) => console.error("[process-automation] forward to engine failed:", e));
    }

    console.log(`Processing automation: ${trigger_type} for org ${organization_id}`);

    // Lead com a automação desligada: nenhum template automático (o motor de fluxos já o respeitava).
    const leadId = leadIdForTrigger(trigger_type, record);
    const leadFlag = (id: string) => supabase.from("leads").select("automation_enabled")
      .eq("id", id).eq("organization_id", organization_id).maybeSingle();
    if (isLeadTrigger(trigger_type) && await leadAutomationBlocked(leadFlag, leadId, record)) {
      console.log(`Lead ${leadId ?? "?"} com automação desligada, nada enviado (${trigger_type})`);
      return new Response(
        JSON.stringify({ message: "Lead automation disabled, skipping", triggered: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if organization has Brevo configured - automations only work with Brevo
    const { data: orgData, error: orgError } = await supabase
      .from("organizations")
      .select("brevo_api_key")
      .eq("id", organization_id)
      .single();

    if (orgError || !orgData?.brevo_api_key) {
      console.log(`Organization ${organization_id} has no Brevo API key configured, skipping automations`);
      return new Response(
        JSON.stringify({ message: "Organization has no Brevo configured, skipping automations" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find templates with automation enabled for this trigger
    const { data: templates, error: tplError } = await supabase
      .from("email_templates")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("automation_enabled", true)
      .eq("automation_trigger_type", trigger_type)
      .eq("is_active", true);

    if (tplError) {
      console.error("Error fetching templates:", tplError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch templates" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!templates || templates.length === 0) {
      return new Response(
        JSON.stringify({ message: "No active automation templates for this trigger" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve recipient - direct fields or via client_id lookup
    let recipientEmail = (record.email as string) || '';
    let recipientName = (record.name as string) || '';
    let recipientCompany = '';
    const clientId = (record.client_id as string) || null;

    if (!recipientEmail && clientId) {
      console.log(`No direct email, looking up client_id: ${clientId}`);
      const { data: client } = await supabase
        .from('crm_clients')
        .select('email, name, company')
        .eq('id', clientId)
        // Scope to the event's org — without this, a forged client_id could read a
        // client (email/name/company) from ANY other tenant (cross-tenant leak).
        .eq('organization_id', organization_id)
        .single();

      if (client) {
        recipientEmail = client.email || '';
        recipientName = client.name || '';
        recipientCompany = client.company || '';
        console.log(`Resolved client: ${recipientName} <${recipientEmail}> company=${recipientCompany}`);
      }
    }

    if (!recipientEmail) {
      console.warn(`No email found in trigger record for ${trigger_type}`);
      return new Response(
        JSON.stringify({ message: "No recipient email in record" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let triggered = 0;

    for (const template of templates) {
      // Check trigger_config conditions
      const config = (template.automation_trigger_config as Record<string, unknown>) || {};
      if (!matchesTriggerConfig(config, record, old_record)) {
        continue;
      }

      // Build variables from trigger record
      // Use activation_date/sale_date from record for {{data}} instead of today
      const formatDatePT = (dateStr: string | unknown): string => {
        if (!dateStr || typeof dateStr !== 'string') return '';
        try {
          return new Date(dateStr).toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });
        } catch { return ''; }
      };

      const activationDate = formatDatePT(record.activation_date);
      const saleDate = formatDatePT(record.sale_date);

      const variables: Record<string, string> = {
        nome: recipientName,
        email: recipientEmail,
        empresa: recipientCompany || (record.company as string) || '',
        data: new Date().toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' }),
        data_ativacao: activationDate,
        data_venda: saleDate,
      };
      for (const [key, value] of Object.entries(record)) {
        if (typeof value === 'string' || typeof value === 'number') {
          variables[key] = String(value);
        }
      }

      const delayMinutes = template.automation_delay_minutes || 0;

      if (delayMinutes > 0) {
        const scheduledFor = new Date(Date.now() + delayMinutes * 60 * 1000);
        await supabase.from("automation_queue").insert({
          automation_id: template.id,
          organization_id,
          recipient_email: recipientEmail,
          recipient_name: recipientName,
          variables: {
            ...variables,
            client_id: clientId || '',
            // a fila volta a confirmar, no envio, que a lead ainda autoriza automações
            ...(leadId ? { lead_id: leadId } : {}),
          },
          template_id: template.id,
          scheduled_for: scheduledFor.toISOString(),
          status: "pending",
        });
        console.log(`Queued template ${template.id} for ${recipientEmail} at ${scheduledFor.toISOString()}`);
      } else {
        const { error: sendError } = await supabase.functions.invoke("send-template-email", {
          body: {
            organizationId: organization_id,
            templateId: template.id,
            recipients: [{
              email: recipientEmail,
              name: recipientName,
              clientId: clientId,
              variables,
            }],
          },
        });

        if (sendError) {
          console.error(`Failed to send template ${template.id} to ${recipientEmail}:`, sendError);
        } else {
          console.log(`Sent template ${template.id} to ${recipientEmail}`);
        }
      }

      triggered++;
    }

    return new Response(
      JSON.stringify({ success: true, triggered }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in process-automation:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function matchesTriggerConfig(
  config: Record<string, unknown> | null,
  record: Record<string, unknown>,
  oldRecord?: Record<string, unknown>
): boolean {
  if (!config || Object.keys(config).length === 0) return true;
  if (config.to_status && record.status !== config.to_status) return false;
  if (config.from_status && oldRecord && oldRecord.status !== config.from_status) return false;
  return true;
}
