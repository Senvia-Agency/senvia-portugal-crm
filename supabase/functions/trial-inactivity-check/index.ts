// Deteta trials parados (sem atividade significativa há >= 48h) e age:
//   1) envia um email de re-engajamento ao responsável do trial (via
//      process-automation, trigger_type 'trial_inactive_48h');
//   2) alerta a equipa SENVIA por email, para um humano poder ligar a leads
//      quentes (sobretudo as que vieram de anúncios pagos).
//
// Idempotente: usa organizations.trial_reminders_sent['inactivity_48h'] para
// nunca avisar a mesma org duas vezes. Corre por cron (ex.: 1x/hora ou 2x/dia).
//
// "Sem atividade há 48h" = now - COALESCE(last_active_at, created_at) >= 48h.
// Assim apanha tanto quem nunca fez nada (48h após o registo) como quem fez
// algo e depois parou (48h após a última ação). O sinal last_active_at é
// preenchido pelos triggers de 20260622120000_org_activity_signal.sql.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { internalJobGuard } from "../_shared/internal-auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applySenviaEmailTemplate } from "../_shared/senvia-email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SENVIA_ORG_ID = "06fe9e1d-9670-45b0-8717-c5a6e90be380";
const ALERT_TO = Deno.env.get("TRIAL_ALERT_EMAIL") || "geral.senvia@gmail.com";
const INACTIVITY_HOURS = 48;

const log = (s: string, d?: unknown) =>
  console.log(`[trial-inactivity-check] ${s}${d !== undefined ? " - " + JSON.stringify(d) : ""}`);

serve(async (req) => {
  const denied = await internalJobGuard(req);
  if (denied) return denied;
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const now = Date.now();
    const cutoff = new Date(now - INACTIVITY_HOURS * 60 * 60 * 1000);

    // Trials ativos: têm trial_ends_at no futuro, ainda não pagaram, plano de
    // trial, e não são contas internas. Excluímos a própria org SENVIA.
    const { data: orgs, error } = await supabase
      .from("organizations")
      .select("id, name, created_at, trial_ends_at, plan, last_active_at, first_paid_at, trial_reminders_sent")
      .eq("billing_exempt", false)
      .is("first_paid_at", null)
      .neq("id", SENVIA_ORG_ID)
      .not("trial_ends_at", "is", null)
      .gt("trial_ends_at", new Date(now).toISOString());
    if (error) throw new Error(`fetch orgs: ${error.message}`);

    if (!orgs?.length) {
      log("sem trials ativos");
      return json({ ok: true, processed: 0 });
    }

    // Config Brevo da org SENVIA para o email de alerta interno.
    const { data: senvia } = await supabase
      .from("organizations")
      .select("brevo_api_key, brevo_sender_email, name")
      .eq("id", SENVIA_ORG_ID)
      .maybeSingle();

    let processed = 0;

    for (const org of orgs) {
      try {
        if (org.plan && org.plan !== "basic") continue; // já tem plano pago

        const reminders: Record<string, boolean> = (org.trial_reminders_sent as Record<string, boolean>) || {};
        if (reminders["inactivity_48h"]) continue; // já avisado

        // Referência de inatividade: última atividade ou, se nunca houve, o registo.
        const ref = org.last_active_at ? new Date(org.last_active_at) : new Date(org.created_at);
        if (ref > cutoff) continue; // ainda dentro das 48h, não está parado

        // Responsável do trial (admin ativo).
        const owner = await getOwner(supabase, org.id);
        if (!owner?.email) {
          log("sem email do responsável, salta", { org: org.id });
          continue;
        }

        // 1) Email de re-engajamento ao utilizador (via templating/Brevo).
        await dispatchAutomation(supabase, "trial_inactive_48h", { email: owner.email, nome: org.name });

        // 2) Alerta interno à equipa SENVIA (best-effort).
        if (senvia?.brevo_api_key && senvia?.brevo_sender_email) {
          const refStr = new Date(ref).toLocaleString("pt-PT");
          try {
            const r = await fetch("https://api.brevo.com/v3/smtp/email", {
              method: "POST",
              headers: {
                "api-key": senvia.brevo_api_key,
                "content-type": "application/json",
                accept: "application/json",
              },
              body: JSON.stringify({
                sender: { name: senvia.name || "SENVIA OS", email: senvia.brevo_sender_email },
                to: [{ email: ALERT_TO }],
                subject: `⚠️ Trial parado: ${org.name}`,
                htmlContent: applySenviaEmailTemplate(
                  `<h2>Trial sem atividade há ${INACTIVITY_HOURS}h</h2>` +
                  `<p><b>Empresa:</b> ${org.name}<br>` +
                  `<b>Responsável:</b> ${owner.name || "—"}<br>` +
                  `<b>Email:</b> ${owner.email}<br>` +
                  `<b>Última atividade:</b> ${refStr}</p>` +
                  `<p>Boa altura para um contacto humano e ajudar na configuração.</p>`,
                  `Trial parado: ${org.name}`,
                ),
              }),
            });
            if (!r.ok) log("email alerta falhou", { org: org.name, status: r.status });
          } catch (e) {
            log("email alerta erro", { org: org.name, error: String(e) });
          }
        }

        // 3) Marca idempotência.
        reminders["inactivity_48h"] = true;
        await supabase.from("organizations").update({ trial_reminders_sent: reminders }).eq("id", org.id);

        processed++;
        log("trial parado tratado", { org: org.name });
      } catch (e) {
        log("falha numa org (continua)", { org: org.id, error: String(e) });
      }
    }

    log(`processados ${processed}`);
    return json({ ok: true, processed, found: orgs.length });
  } catch (e) {
    log("erro geral", { error: String(e) });
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

async function getOwner(supabase: any, orgId: string): Promise<{ name: string; email: string } | null> {
  const { data: member } = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("role", "admin")
    .eq("is_active", true)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!member?.user_id) return null;

  const { data: prof } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", member.user_id)
    .maybeSingle();

  let email = prof?.email ?? "";
  if (!email) {
    const { data: au } = await supabase.auth.admin.getUserById(member.user_id);
    email = au?.user?.email ?? "";
  }
  return { name: prof?.full_name ?? "", email };
}

async function dispatchAutomation(supabase: any, triggerType: string, record: Record<string, string>) {
  try {
    const { error } = await supabase.functions.invoke("process-automation", {
      body: { trigger_type: triggerType, organization_id: SENVIA_ORG_ID, record },
    });
    if (error) log("automation dispatch error", { error: error.message });
    else log("automation dispatched", { triggerType });
  } catch (err) {
    log("automation dispatch failed", { error: (err as Error).message });
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
