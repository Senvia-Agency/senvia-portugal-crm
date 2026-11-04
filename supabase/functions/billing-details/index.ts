// billing-details — an organization admin reads or saves the company's billing
// details. Saving also updates the Stripe customer, when the company has one
// (name, address, invoice email, NIF as EU VAT id); otherwise create-checkout
// uses them when it creates the customer.
import { requestMfaResponse } from "../_shared/user-authorization.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { BILLING_COLUMNS, parseBillingDetails, stripeCustomerFields, syncStripeTaxId } from "../_shared/billing-details.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Não autorizado" }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Não autorizado" }, 401);
    const mfaResponse = await requestMfaResponse(req, user.id, corsHeaders);
    if (mfaResponse) return mfaResponse;

    const body = await req.json().catch(() => ({}));
    const organizationId = typeof body.organization_id === "string" ? body.organization_id : "";
    const { data: allowed } = await admin.rpc("is_org_admin", { _user_id: user.id, _org_id: organizationId });
    if (allowed !== true) return json({ error: "Só um administrador da empresa pode ver os dados de faturação." }, 403);

    if (body.action === "get") {
      const { data, error } = await admin.from("organizations").select(BILLING_COLUMNS).eq("id", organizationId).single();
      if (error) throw error;
      return json({ details: data });
    }
    if (body.action !== "save") return json({ error: "Ação inválida" }, 400);

    const parsed = parseBillingDetails(body.details ?? {});
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const { data: org, error: orgError } = await admin.from("organizations")
      .update(parsed.value).eq("id", organizationId).select("id, name").single();
    if (orgError) throw orgError;

    // Stripe, when the company is already a customer.
    let stripeSynced = false;
    const { data: binding } = await admin.from("organization_billing_accounts")
      .select("stripe_customer_id").eq("organization_id", organizationId).maybeSingle();
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (binding?.stripe_customer_id && stripeKey) {
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
      try {
        await stripe.customers.update(binding.stripe_customer_id, stripeCustomerFields(parsed.value, org.name));
        await syncStripeTaxId(stripe, binding.stripe_customer_id, parsed.value);
        await admin.from("organizations").update({ billing_synced_at: new Date().toISOString() }).eq("id", organizationId);
        stripeSynced = true;
      } catch (e) {
        // Saved here; Stripe refused (usually the VAT number). Say so instead of failing the save.
        console.error("[billing-details] stripe sync failed", { organizationId, message: (e as Error).message });
        return json({ saved: true, stripeSynced: false, stripeError: (e as Error).message });
      }
    }
    return json({ saved: true, stripeSynced, hasStripeCustomer: !!binding?.stripe_customer_id });
  } catch (e) {
    console.error("[billing-details] error", (e as Error).message);
    return json({ error: "Não foi possível guardar os dados de faturação." }, 500);
  }
});
