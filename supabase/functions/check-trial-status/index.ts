import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const SENVIA_AGENCY_ORG_ID = "06fe9e1d-9670-45b0-8717-c5a6e90be380";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[CHECK-TRIAL-STATUS] ${step}${d}`);
};

serve(async (req) => {
  const denied = await internalJobGuard(req);
  if (denied) return denied;
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    logStep("Starting trial status check");

    const now = new Date();

    // Find orgs in trial (have trial_ends_at, no plan or plan = 'basic', not billing_exempt)
    const { data: orgs, error } = await supabase
      .from("organizations")
      .select("id, name, trial_ends_at, plan, trial_reminders_sent, contact_phone")
      .eq("billing_exempt", false)
      .not("trial_ends_at", "is", null);

    if (error) throw new Error(`Failed to fetch orgs: ${error.message}`);
    if (!orgs || orgs.length === 0) {
      logStep("No organizations with trial found");
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    logStep(`Found ${orgs.length} orgs with trial_ends_at`);

    let processed = 0;

    for (const org of orgs) {
      // Skip orgs that already have a paid plan
      if (org.plan && org.plan !== "basic") continue;

      const trialEnd = new Date(org.trial_ends_at);
      const daysLeft = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const reminders: Record<string, boolean> = (org.trial_reminders_sent as Record<string, boolean>) || {};

      // Get admin email for this org
      const adminEmail = await getAdminEmail(supabase, org.id);
      if (!adminEmail) continue;

      // Trial just started — welcome (dia 0/1 do trial de 14 dias → ~13-14 dias por usar).
      // Janela alta para nunca disparar em trials antigos/expirados.
      if (daysLeft >= 12 && !reminders["automation_started"]) {
        logStep("Trial started", { orgId: org.id });
        await dispatchAutomation(supabase, "trial_started", { email: adminEmail, nome: org.name, empresa: org.name, telefone: org.contact_phone ?? "" });
        reminders["automation_started"] = true;
        await updateReminders(supabase, org.id, reminders);
        processed++;
      }

      // Dia 3 do trial (ativação) — ~8-11 dias por usar.
      if (daysLeft <= 11 && daysLeft >= 8 && !reminders["automation_day3"]) {
        logStep("Trial day 3", { orgId: org.id });
        await dispatchAutomation(supabase, "trial_day_3", { email: adminEmail, nome: org.name, empresa: org.name, telefone: org.contact_phone ?? "" });
        reminders["automation_day3"] = true;
        await updateReminders(supabase, org.id, reminders);
        processed++;
      }

      // Dia 7 do trial (diferenciadores) — ~4-7 dias por usar.
      if (daysLeft <= 7 && daysLeft >= 4 && !reminders["automation_day7"]) {
        logStep("Trial day 7", { orgId: org.id });
        await dispatchAutomation(supabase, "trial_day_7", { email: adminEmail, nome: org.name, empresa: org.name, telefone: org.contact_phone ?? "" });
        reminders["automation_day7"] = true;
        await updateReminders(supabase, org.id, reminders);
        processed++;
      }

      // Trial expiring in 3 days
      if (daysLeft <= 3 && daysLeft > 1 && !reminders["automation_3d"]) {
        logStep("Trial expiring in 3 days", { orgId: org.id });
        await dispatchAutomation(supabase, "trial_expiring_3d", {
          email: adminEmail,
          nome: org.name, empresa: org.name, telefone: org.contact_phone ?? "",
          dias: "3",
        });
        reminders["automation_3d"] = true;
        await updateReminders(supabase, org.id, reminders);
        processed++;
      }

      // Trial expiring in 1 day
      if (daysLeft <= 1 && daysLeft > 0 && !reminders["automation_1d"]) {
        logStep("Trial expiring in 1 day", { orgId: org.id });
        await dispatchAutomation(supabase, "trial_expiring_1d", {
          email: adminEmail,
          nome: org.name, empresa: org.name, telefone: org.contact_phone ?? "",
          dias: "1",
        });
        reminders["automation_1d"] = true;
        await updateReminders(supabase, org.id, reminders);
        processed++;
      }

      // Trial expired
      if (daysLeft <= 0 && !reminders["automation_expired"]) {
        logStep("Trial expired", { orgId: org.id });
        await dispatchAutomation(supabase, "trial_expired", {
          email: adminEmail,
          nome: org.name, empresa: org.name, telefone: org.contact_phone ?? "",
        });

        // Move from "Clientes em Trial" to "Trial Expirado"
        await moveToExpiredList(supabase, adminEmail, org.name);

        reminders["automation_expired"] = true;
        await updateReminders(supabase, org.id, reminders);
        processed++;
      }
    }

    logStep(`Processed ${processed} trial events`);

    return new Response(JSON.stringify({ processed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

async function getAdminEmail(supabase: any, orgId: string): Promise<string | null> {
  const { data: members } = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("role", "admin")
    .eq("is_active", true)
    .limit(1);

  if (!members || members.length === 0) return null;

  const { data: userData } = await supabase.auth.admin.getUserById(members[0].user_id);
  return userData?.user?.email || null;
}

async function dispatchAutomation(supabase: any, triggerType: string, record: Record<string, string>) {
  try {
    logStep("Dispatching automation", { triggerType });
    const { error } = await supabase.functions.invoke("process-automation", {
      body: {
        trigger_type: triggerType,
        organization_id: SENVIA_AGENCY_ORG_ID,
        record,
      },
    });
    if (error) logStep("Automation dispatch error", { error: error.message });
    else logStep("Automation dispatched", { triggerType });
  } catch (err) {
    logStep("Automation dispatch failed", { error: (err as Error).message });
  }
}

async function updateReminders(supabase: any, orgId: string, reminders: Record<string, boolean>) {
  await supabase
    .from("organizations")
    .update({ trial_reminders_sent: reminders })
    .eq("id", orgId);
}

async function moveToExpiredList(supabase: any, email: string, name: string) {
  try {
    // Ensure lists exist
    await supabase.rpc("ensure_stripe_auto_lists", { p_org_id: SENVIA_AGENCY_ORG_ID });

    // Get or create contact
    const { data: contact } = await supabase
      .from("marketing_contacts")
      .upsert(
        { organization_id: SENVIA_AGENCY_ORG_ID, email, name: name || email, source: "trial", subscribed: true },
        { onConflict: "organization_id,email" }
      )
      .select("id")
      .single();

    if (!contact) return;

    // Get trial list IDs
    const { data: lists } = await supabase
      .from("client_lists")
      .select("id, name")
      .eq("organization_id", SENVIA_AGENCY_ORG_ID)
      .eq("is_system", true)
      .in("name", ["Clientes em Trial", "Trial Expirado"]);

    if (!lists) return;

    const listMap: Record<string, string> = {};
    for (const l of lists) listMap[l.name] = l.id;

    // Remove from "Clientes em Trial"
    if (listMap["Clientes em Trial"]) {
      await supabase
        .from("marketing_list_members")
        .delete()
        .eq("list_id", listMap["Clientes em Trial"])
        .eq("contact_id", contact.id);
    }

    // Add to "Trial Expirado"
    if (listMap["Trial Expirado"]) {
      await supabase
        .from("marketing_list_members")
        .upsert(
          { list_id: listMap["Trial Expirado"], contact_id: contact.id },
          { onConflict: "list_id,contact_id" }
        );
    }

    logStep("Moved contact to Trial Expirado");
  } catch (err) {
    logStep("Failed to move to expired list", { error: (err as Error).message });
  }
}
import { internalJobGuard } from "../_shared/internal-auth.ts";
