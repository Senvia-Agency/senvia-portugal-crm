// Notifica a equipa SENVIA de cada novo trial: cria um LEAD na org SENVIA
// (para a equipa trabalhar o contacto no próprio CRM — dogfooding) e envia um
// email de alerta. Corre por cron (ex.: a cada 15 min). É idempotente: usa
// organizations.trial_notified_at para nunca notificar a mesma org duas vezes.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applySenviaEmailTemplate } from "../_shared/senvia-email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Org SENVIA (a que gere os contactos comerciais). Mesmo id da agência.
const SENVIA_ORG_ID = "06fe9e1d-9670-45b0-8717-c5a6e90be380";
// Para quem vai o email de alerta (sobreponível por env var).
const ALERT_TO = Deno.env.get("TRIAL_ALERT_EMAIL") || "geral.senvia@gmail.com";

const log = (s: string, d?: unknown) =>
  console.log(`[notify-new-trials] ${s}${d !== undefined ? " - " + JSON.stringify(d) : ""}`);

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
    // Novos trials por notificar (últimos 7 dias por segurança — evita inundar
    // com histórico antigo caso o cron arranque pela primeira vez).
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: newOrgs, error } = await supabase
      .from("organizations")
      .select("id, name, created_at, contact_phone")
      .is("trial_notified_at", null)
      .eq("billing_exempt", false)
      .neq("id", SENVIA_ORG_ID)
      .gt("created_at", since)
      .order("created_at", { ascending: true })
      .limit(50);
    if (error) throw new Error(`fetch orgs: ${error.message}`);

    if (!newOrgs?.length) {
      log("sem novos trials");
      return json({ ok: true, processed: 0 });
    }

    // Config Brevo da org SENVIA (para enviar o email de alerta).
    const { data: senvia } = await supabase
      .from("organizations")
      .select("brevo_api_key, brevo_sender_email, name")
      .eq("id", SENVIA_ORG_ID)
      .maybeSingle();

    let done = 0;
    for (const org of newOrgs) {
      try {
        // Dono do trial = membro ativo mais antigo (o utilizador do signup).
        const { data: member } = await supabase
          .from("organization_members")
          .select("user_id")
          .eq("organization_id", org.id)
          .eq("is_active", true)
          .order("joined_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        let ownerName = "";
        let ownerEmail = "";
        // Atribuição de tráfego do registo, gravada pelo Login.tsx nos
        // metadados do utilizador. Sem isto, todo e qualquer trial entrava no
        // CRM como "Trial SENVIA OS" e nunca contava como tráfego pago, mesmo
        // vindo de um anúncio pago.
        let signupSource = "";
        let signupTracking: Record<string, unknown> | null = null;
        if (member?.user_id) {
          const { data: prof } = await supabase
            .from("profiles")
            .select("full_name, email")
            .eq("id", member.user_id)
            .maybeSingle();
          ownerName = prof?.full_name ?? "";
          ownerEmail = prof?.email ?? "";

          // Passou a ser incondicional: os metadados de atribuição só existem
          // aqui, e antes esta chamada só acontecia quando faltava o email.
          const { data: au } = await supabase.auth.admin.getUserById(member.user_id);
          if (!ownerEmail) ownerEmail = au?.user?.email ?? "";
          const meta = (au?.user?.user_metadata ?? {}) as Record<string, unknown>;
          if (typeof meta.signup_source === "string") signupSource = meta.signup_source;
          if (meta.signup_tracking && typeof meta.signup_tracking === "object") {
            signupTracking = meta.signup_tracking as Record<string, unknown>;
          }
        }

        // "Direto" não acrescenta nada ao rótulo; qualquer outra origem sim.
        // Fica composto de propósito — "Trial SENVIA OS (Facebook Ads)" conta
        // como tráfego pago (o classificador procura "ads") sem perder a
        // informação de que é um trial, que é o que distingue estas leads.
        const leadSource = signupSource && signupSource !== "Direto"
          ? `Trial SENVIA OS (${signupSource})`
          : "Trial SENVIA OS";

        const startStr = new Date(org.created_at).toLocaleString("pt-PT");

        // 1) Cria o lead na org SENVIA (automações desligadas — é contacto interno).
        const { error: leadErr } = await supabase.from("leads").insert({
          organization_id: SENVIA_ORG_ID,
          name: ownerName || org.name || "Novo trial",
          email: ownerEmail || "",
          phone: org.contact_phone || "",
          company_name: org.name,
          source: leadSource,
          status: "new",
          temperature: "hot",
          automation_enabled: false,
          gdpr_consent: false,
          // Mesma forma que as leads dos formulários públicos, para os
          // relatórios de origem poderem tratar as duas da mesma maneira.
          custom_data: signupTracking ?? {},
          notes:
            `🎉 Novo trial do SENVIA OS.\n` +
            `Empresa: ${org.name}\n` +
            `Responsável: ${ownerName || "—"}\n` +
            `Email: ${ownerEmail || "—"}\n` +
            `Início do trial: ${startStr}\n` +
            `➡️ Contactar nas primeiras 24-48h para ajudar na configuração.`,
        });
        if (leadErr) throw new Error(`lead insert: ${leadErr.message}`);

        // 2) Email de alerta (best-effort — não bloqueia se o Brevo falhar).
        if (senvia?.brevo_api_key && senvia?.brevo_sender_email) {
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
                subject: `🎉 Novo trial: ${org.name}`,
                htmlContent: applySenviaEmailTemplate(
                  `<h2>Novo trial do SENVIA OS</h2>` +
                  `<p><b>Empresa:</b> ${org.name}<br>` +
                  `<b>Responsável:</b> ${ownerName || "—"}<br>` +
                  `<b>Email:</b> ${ownerEmail || "—"}<br>` +
                  `<b>Início:</b> ${startStr}</p>` +
                  `<p>Já foi criado um <b>lead na org SENVIA</b>. Contacta nas primeiras 24-48h.</p>`,
                  `Novo trial: ${org.name}`,
                ),
              }),
            });
            if (!r.ok) log("email falhou", { orgId: org.id, status: r.status });
          } catch (e) {
            log("email erro", { orgId: org.id });
          }
        } else {
          log("Brevo não configurado na org SENVIA — só lead criado");
        }

        // 3) Marca como notificado (idempotência).
        await supabase
          .from("organizations")
          .update({ trial_notified_at: new Date().toISOString() })
          .eq("id", org.id);

        done++;
        log("notificado", { orgId: org.id });
      } catch (e) {
        log("falha numa org (continua)", { org: org.id, error: String(e) });
      }
    }

    return json({ ok: true, processed: done, found: newOrgs.length });
  } catch (e) {
    log("erro geral", { error: String(e) });
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
import { internalJobGuard } from "../_shared/internal-auth.ts";
