import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PRODUCT_TO_PLAN: Record<string, string> = {
  "prod_U0wAc7Tuy8w6gA": "starter",
  "prod_U0wGoA4odOBHOZ": "pro",
  "prod_U0wG6doz0zgZFV": "elite",
};

const logStep = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[RECONCILE-PLANS] ${step}${d}`);
};

// Daily maintenance job: keep organizations.plan aligned with the real Stripe
// subscription product, so a manually-edited or stale plan (e.g. a Starter
// customer left as 'elite' from an old workaround) self-heals. Also clears a
// temporary billing_exempt for real payers whose subscription is active again.
//
// SAFEGUARDS:
//   * Never NULL an existing plan when no Stripe sub is found — cancellation is
//     handled by the stripe-webhook (customer.subscription.deleted).
//   * Never touch demo/partner orgs (billing_exempt = true AND first_paid_at
//     IS NULL) — their plan is set on purpose.
//   * Never set first_paid_at here (that's the webhook's job).
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not set");
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    logStep("Starting reconciliation");

    // Pull every subscription that means "this customer has a plan right now",
    // including overdue ones (past_due/unpaid) so we don't wrongly think a late
    // payer has no plan.
    const allSubs: Stripe.Subscription[] = [];
    for (const status of ["active", "trialing", "past_due", "unpaid"] as const) {
      let hasMore = true;
      let startingAfter: string | undefined;
      while (hasMore) {
        const params: Stripe.SubscriptionListParams = { status, limit: 100 };
        if (startingAfter) params.starting_after = startingAfter;
        const batch = await stripe.subscriptions.list(params);
        allSubs.push(...batch.data);
        hasMore = batch.has_more;
        if (batch.data.length > 0) startingAfter = batch.data[batch.data.length - 1].id;
      }
    }

    const { data: orgs, error: orgError } = await supabase.from('organizations')
      .select('id, name, plan, billing_exempt, first_paid_at');
    if (orgError) throw orgError;
    const { data: bindings, error: bindingError } = await supabase.from('organization_billing_accounts')
      .select('organization_id, stripe_customer_id, stripe_subscription_id');
    if (bindingError) throw bindingError;
    const subByOrg: Record<string, { plan: string | null; status: string }> = {};
    for (const binding of bindings || []) {
      const sub = allSubs.find(s => s.id === binding.stripe_subscription_id &&
        (typeof s.customer === 'string' ? s.customer : s.customer.id) === binding.stripe_customer_id);
      if (!sub) continue;
      const base = sub.items.data.find((item: any) => PRODUCT_TO_PLAN[typeof item.price.product === 'string' ? item.price.product : item.price.product.id]);
      const productId = typeof base?.price.product === 'string' ? base.price.product : base?.price.product?.id;
      subByOrg[binding.organization_id] = { plan: productId ? PRODUCT_TO_PLAN[productId] : null, status: sub.status };
    }

    let planUpdates = 0;
    let exemptCleared = 0;
    const changes: Array<Record<string, unknown>> = [];

    for (const org of (orgs || [])) {
      // Demo/partner: exempt and never paid → leave exactly as configured.
      if (org.billing_exempt && !org.first_paid_at) continue;

      const sub = subByOrg[org.id];

      // No live sub found → do nothing (never null an existing plan).
      if (!sub) continue;

      const updates: Record<string, any> = {};

      // Align plan to the real Stripe product (only when we recognise it).
      if (sub.plan && sub.plan !== org.plan && !(sub.plan === 'starter' && ['pro', 'elite'].includes(org.plan))) {
        updates.plan = sub.plan;
      }

      // Real payer whose subscription is active again → drop any temporary
      // billing_exempt that was used as a stop-gap (mirrors webhook
      // clearTempBillingExempt). Only for active — not past_due/unpaid.
      if (org.billing_exempt && org.first_paid_at && sub.status === "active") {
        updates.billing_exempt = false;
      }

      if (Object.keys(updates).length === 0) continue;

      const { error } = await supabase.from("organizations").update(updates).eq("id", org.id);
      if (error) {
        logStep("update failed", { org: org.id, error: error.message });
        continue;
      }
      if ("plan" in updates) planUpdates++;
      if ("billing_exempt" in updates) exemptCleared++;
      changes.push({ org_id: org.id, name: org.name, from_plan: org.plan, ...updates });
    }

    logStep("Reconciliation complete", { planUpdates, exemptCleared, scanned: orgs?.length ?? 0 });

    return new Response(JSON.stringify({
      plan_updates: planUpdates,
      exempt_cleared: exemptCleared,
      scanned: orgs?.length ?? 0,
      changes,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
