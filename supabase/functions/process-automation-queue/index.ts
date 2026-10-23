import { automationContactSuppressed } from '../_shared/automation-contact-optout.ts';
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const { data: items, error } = await supabase.rpc("claim_automation_queue", { p_limit: 50 });

    if (error) {
      console.error("Error fetching queue:", error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch queue" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!items || items.length === 0) {
      return new Response(
        JSON.stringify({ message: "No items to process", processed: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${items.length} queued automation(s)`);

    let sent = 0;
    let failed = 0;

    for (const item of items) {
      try {
        const variables = (item.variables as Record<string, unknown>) || {};
        if (await automationContactSuppressed(supabase, item.organization_id, String(variables.telefone ?? variables.phone ?? ""), item.recipient_email)) {
          const { error: cancelError } = await supabase.from("automation_queue").update({ status: "cancelled" }).eq("id", item.id).in("status", ["pending", "processing"]);
          if (cancelError) throw cancelError;
          continue;
        }
        const clientId = typeof variables.client_id === "string" && variables.client_id ? variables.client_id : undefined;

        const { error: sendError } = await supabase.functions.invoke("send-template-email", {
          body: {
            organizationId: item.organization_id,
            templateId: item.template_id,
            automationId: item.automation_id,
            recipients: [{
              email: item.recipient_email,
              name: item.recipient_name || '',
              clientId,
              variables: Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, String(value ?? '')])),
            }],
          },
        });

        if (sendError) {
          console.error(`Failed to send queued item ${item.id}:`, sendError);
          const { error: updateError } = await supabase.from("automation_queue").update({ status: "failed" }).eq("id", item.id).eq("status", "processing");
          if (updateError) throw updateError;
          failed++;
        } else {
          const { error: updateError } = await supabase.from("automation_queue").update({ status: "sent" }).eq("id", item.id).eq("status", "processing");
          if (updateError) throw updateError;
          sent++;
        }
      } catch (itemError) {
        console.error("automation_queue_reconciliation_required", { id: item.id, kind: itemError instanceof Error ? itemError.name : "database" });
        failed++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed: items.length, sent, failed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in process-automation-queue:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
import { internalJobGuard } from "../_shared/internal-auth.ts";
