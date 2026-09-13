import { requestMfaResponse } from "../_shared/user-authorization.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-CHECKOUT] ${step}${d}`);
};

// Stripe only accepts http(s) return URLs. The Origin header is whatever the
// caller sends, and the Chrome extension calls from `chrome-extension://<id>`,
// which Stripe rejects outright — the checkout session never gets created and
// the user is stuck with no way to pay. Fall back to the canonical app URL for
// anything that is not http(s).
function returnBase(req: Request): string {
  const origin = req.headers.get("origin") ?? "";
  return /^https?:\/\//.test(origin) ? origin : "https://app.senvia.pt";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  );

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (!user?.email) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const mfaResponse = await requestMfaResponse(req, user.id, corsHeaders);
    if (mfaResponse) return mfaResponse;

    const { priceId, organization_id } = await req.json();
    if (priceId !== 'price_1T2uHzLWnA81DzXTHdexakfL') throw new Error('Plano indisponível');
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: allowed, error: permissionError } = await admin.rpc('is_org_admin', { _user_id: user.id, _org_id: organization_id });
    if (permissionError || allowed !== true) return new Response(JSON.stringify({ error: 'Sem permissão para gerir faturação' }), { status: 403, headers: corsHeaders });
    const { data: org, error: orgError } = await admin.from('organizations').select('id, name, extra_seats, first_paid_at, current_period_end').eq('id', organization_id).single();
    if (orgError || !org) throw new Error('Organização não encontrada');
    logStep("Creating checkout", { email: user.email, priceId });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const { data: binding, error: bindingError } = await admin.from('organization_billing_accounts').select('stripe_customer_id').eq('organization_id', org.id).maybeSingle();
    if (bindingError) throw bindingError;
    let customerId = binding?.stripe_customer_id;
    if (!customerId) {
      if (org.first_paid_at || org.current_period_end) throw new Error('A ligação da subscrição existente precisa de ser verificada antes de iniciar outro pagamento.');
      const customer = await stripe.customers.create({ email: user.email, name: org.name, metadata: { organization_id: org.id } }, { idempotencyKey: 'senvia-customer-' + org.id });
      customerId = customer.id;
      const { error } = await admin.from('organization_billing_accounts').insert({ organization_id: org.id, stripe_customer_id: customerId });
      if (error) throw error;
    }
    const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
    if (subscriptions.data.some((sub: Stripe.Subscription) => !['canceled', 'incomplete_expired'].includes(sub.status))) throw new Error('Já existe uma subscrição. Usa Gerir Subscrição.');
    const parameters: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      client_reference_id: org.id,
      metadata: { organization_id: org.id },
      subscription_data: { metadata: { organization_id: org.id } },
      line_items: [{ price: priceId, quantity: 1 }, ...(org.extra_seats > 0 ? [{ price: 'price_1TncdBLWnA81DzXTh3crx8iN', quantity: org.extra_seats }] : [])],
      mode: "subscription",
      success_url: `${returnBase(req)}/settings?billing=success`,
      cancel_url: `${returnBase(req)}/settings?billing=cancel`,
      allow_promotion_codes: true,
    };
    const { data: attempt, error: attemptError } = await admin.rpc('claim_referral_checkout', {
      _organization_id: org.id, _parameters: parameters,
    });
    if (attemptError || !attempt?.attempt) throw attemptError || new Error('Não foi possível iniciar o pagamento');
    const session = await stripe.checkout.sessions.create({ ...parameters, expires_at: attempt.expires_at }, {
      idempotencyKey: `senvia-checkout-${org.id}-${attempt.attempt}`,
    });

    logStep("Checkout session created", { sessionId: session.id });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
