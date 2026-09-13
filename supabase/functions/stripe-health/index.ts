import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

// Read-only health check for the whole Stripe ↔ CRM integration. Answers, in
// one call, the questions that went unanswered while renewals silently stopped
// being recorded in finance:
//   1. Is the webhook endpoint pointing at THIS project, enabled, and
//      subscribed to the events we handle?
//   2. Are recent events actually being delivered? (pending_webhooks > 0 on an
//      old event means Stripe could not deliver it.)
//   3. Does every paid invoice have a matching payment row in the CRM?
//   4. Does every live subscription match its organization row?
//
// Writes nothing. Never returns secrets — only a fingerprint of the webhook
// signing secret (length + last 4 chars) so it can be compared by eye with the
// value shown in the Stripe Dashboard without exposing it.

const SENVIA_AGENCY_ORG_ID = "06fe9e1d-9670-45b0-8717-c5a6e90be380";

const PRODUCT_TO_PLAN: Record<string, string> = {
  "prod_U0wAc7Tuy8w6gA": "starter",
  "prod_U0wGoA4odOBHOZ": "pro",
  "prod_U0wG6doz0zgZFV": "elite",
};

// Events the webhook implements. Missing any of these from the endpoint config
// means that part of the integration is dead.
const REQUIRED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.created",
  "invoice.created",
  "invoice.finalized",
  "invoice.voided",
  "invoice.deleted",
];

const DEFAULT_LOOKBACK_DAYS = 120;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

/**
 * Same rule as reconcile-stripe-payments: the caller must present
 * `stripe_cron_secret`, which lives only in Supabase Vault and is compared by
 * the SECURITY DEFINER function `public.verify_stripe_cron_secret` without ever
 * being returned. Fails closed.
 */
async function isAuthorized(req: Request, supabase: any): Promise<boolean> {
  const provided = req.headers.get("x-cron-secret") || new URL(req.url).searchParams.get("key");
  if (!provided) return false;

  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && provided === cronSecret) return true;

  const { data, error } = await supabase.rpc("verify_stripe_cron_secret", { p_secret: provided });
  if (error) {
    console.error("[STRIPE-HEALTH] authorization check failed", error.message);
    return false;
  }
  return data === true;
}

async function stripeGet(path: string, key: string, params?: Record<string, string>) {
  const url = new URL(`https://api.stripe.com/v1${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${key}` } });
  const body = await res.json();
  if (!res.ok) throw new Error(`Stripe ${path}: ${body?.error?.message || res.status}`);
  return body;
}

// Basil (2025-08-27) moved these off the Invoice object; read both shapes.
function invoiceSubscriptionId(inv: any): string | null {
  const idOf = (v: any): string | null => (typeof v === "string" ? v : v?.id) || null;
  return idOf(inv.subscription) ?? idOf(inv.parent?.subscription_details?.subscription);
}
function subPeriodEnd(sub: any): number | null {
  return sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end ?? null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  // Guard: the report exposes customer emails, revenue and the webhook secret
  // fingerprint. Fails closed.
  if (!(await isAuthorized(req, supabase))) {
    return new Response(JSON.stringify({ error: "Não autorizado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not set");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

    let lookbackDays = DEFAULT_LOOKBACK_DAYS;
    let releaseReview = false;
    try {
      const body = await req.json();
      releaseReview = body?.release_review === true;
      if (body?.lookback_days && Number(body.lookback_days) > 0) {
        lookbackDays = Math.min(Number(body.lookback_days), 365);
      }
    } catch { /* empty body is fine */ }

    if (releaseReview) {
      // Read-only release inventory. Secrets stay in the Edge Function runtime.
      const all = async (path: string, params: Record<string,string> = {}) => {
        const rows: any[] = []; let after = '';
        for (let page = 0; page < 30; page++) {
          const batch = await stripeGet(path, stripeKey, { ...params, limit: '100', ...(after ? { starting_after: after } : {}) });
          rows.push(...batch.data);
          if (!batch.has_more) return rows;
          after = batch.data.at(-1).id;
        }
        throw new Error('Inventory exceeds review limit');
      };
      const subscriptions = await all('/subscriptions', { status: 'all' });
      const invoices = await all('/invoices', { status: 'paid' });
      const customers = [];
      for (const id of new Set([...subscriptions, ...invoices].map(row => row.customer))) {
        const customer = await stripeGet(`/customers/${id}`, stripeKey);
        customers.push({ id, name: customer.name, email: customer.email, deleted: customer.deleted, organization_id: customer.metadata?.organization_id });
      }
      const endpoints = await all('/webhook_endpoints');
      const prices = [];
      for (const id of ['price_1T2uHzLWnA81DzXTHdexakfL','price_1TncdBLWnA81DzXTh3crx8iN']) {
        const price = await stripeGet(`/prices/${id}`, stripeKey);
        prices.push({ id, active: price.active, livemode: price.livemode, currency: price.currency, unit_amount: price.unit_amount, recurring: price.recurring, product: price.product });
      }
      return new Response(JSON.stringify({ customers, prices, subscriptions: subscriptions.map(s => ({
        id: s.id, customer: s.customer, status: s.status, livemode: s.livemode, metadata: s.metadata,
        items: s.items, current_period_end: s.current_period_end, cancel_at_period_end: s.cancel_at_period_end,
        pause_collection: s.pause_collection, schedule: s.schedule,
      })), invoices: invoices.map(i => ({ id: i.id, customer: i.customer, subscription: invoiceSubscriptionId(i),
        amount_paid: i.amount_paid, paid_at: i.status_transitions?.paid_at, created: i.created, livemode: i.livemode,
        paid_out_of_band: i.paid_out_of_band, amount_paid_off_stripe: i.amount_paid_off_stripe,
      })), endpoints: endpoints.map(e => ({ id: e.id, url: e.url, status: e.status, enabled_events: e.enabled_events })) }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const projectUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const projectRef = projectUrl.replace("https://", "").split(".")[0];
    const problems: string[] = [];

    // --- 1. Webhook endpoints ------------------------------------------------
    const endpointsRes = await stripeGet("/webhook_endpoints", stripeKey, { limit: "100" });
    const endpoints = (endpointsRes.data ?? []).map((e: any) => {
      const pointsHere = typeof e.url === "string" && e.url.includes(projectRef);
      const events: string[] = e.enabled_events ?? [];
      const listensToAll = events.includes("*");
      const missing = listensToAll ? [] : REQUIRED_EVENTS.filter((ev) => !events.includes(ev));
      return {
        id: e.id,
        url: e.url,
        status: e.status,
        api_version: e.api_version ?? null,
        created: e.created ? new Date(e.created * 1000).toISOString() : null,
        points_to_this_project: pointsHere,
        missing_required_events: missing,
        enabled_events_count: events.length,
      };
    });

    const liveEndpoints = endpoints.filter((e: any) => e.points_to_this_project && e.status === "enabled");
    const staleEndpoints = endpoints.filter((e: any) => !e.points_to_this_project);

    if (liveEndpoints.length === 0) {
      problems.push("CRITICAL: no enabled Stripe webhook endpoint points to this Supabase project — no event will ever reach the CRM.");
    }
    for (const e of liveEndpoints) {
      if (e.missing_required_events.length > 0) {
        problems.push(`Webhook ${e.url} is not subscribed to: ${e.missing_required_events.join(", ")}`);
      }
    }
    for (const e of staleEndpoints) {
      problems.push(`Stale webhook endpoint still configured in Stripe (points elsewhere): ${e.url} [${e.status}] — delete it; its signing secret is a common cause of signature failures.`);
    }

    // --- 2. Event delivery ---------------------------------------------------
    // pending_webhooks > 0 on an event older than a few minutes means Stripe
    // has not managed to deliver it to every configured endpoint.
    const recentEvents = await stripeGet("/events", stripeKey, { limit: "100" });
    const nowSec = Math.floor(Date.now() / 1000);
    const undelivered = (recentEvents.data ?? [])
      .filter((ev: any) => ev.pending_webhooks > 0 && nowSec - ev.created > 900)
      .map((ev: any) => ({
        id: ev.id,
        type: ev.type,
        created: new Date(ev.created * 1000).toISOString(),
        pending_webhooks: ev.pending_webhooks,
      }));
    if (undelivered.length > 0) {
      problems.push(`${undelivered.length} Stripe event(s) older than 15 min are still undelivered — the endpoint is rejecting or unreachable (a wrong STRIPE_WEBHOOK_SECRET returns 400 and looks exactly like this).`);
    }

    // Delivery detail for the money events specifically. Stripe only retains
    // events for ~30 days, so this window is naturally short.
    const paidEvents = await stripeGet("/events", stripeKey, { limit: "100", "types[]": "invoice.paid" });
    const invoicePaidEvents = (paidEvents.data ?? []).map((ev: any) => ({
      id: ev.id,
      created: new Date(ev.created * 1000).toISOString(),
      invoice_id: ev.data?.object?.id ?? null,
      pending_webhooks: ev.pending_webhooks,
      delivered: ev.pending_webhooks === 0,
    }));

    // --- 3. Paid invoices vs CRM finance rows --------------------------------
    const createdGte = nowSec - lookbackDays * 86400;
    const invoices: any[] = [];
    let startingAfter: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const params: Record<string, string> = { status: "paid", limit: "100", "created[gte]": String(createdGte) };
      if (startingAfter) params.starting_after = startingAfter;
      const batch = await stripeGet("/invoices", stripeKey, params);
      invoices.push(...(batch.data ?? []));
      hasMore = !!batch.has_more;
      if (batch.data?.length) startingAfter = batch.data[batch.data.length - 1].id;
    }

    const { data: payments } = await supabase
      .from("sale_payments")
      .select("id, amount, payment_date, notes, stripe_invoice_id")
      .eq("organization_id", SENVIA_AGENCY_ORG_ID);
    const paymentNotes = (payments ?? []).map((p: any) => `${p.stripe_invoice_id ?? ""} ${p.notes ?? ""}`);

    const invoiceReport = invoices
      .filter((inv: any) => (inv.amount_paid || 0) > 0)
      .map((inv: any) => {
        const recorded = paymentNotes.some((n: string) => n.includes(inv.id));
        return {
          invoice_id: inv.id,
          subscription_id: invoiceSubscriptionId(inv),
          email: inv.customer_email,
          amount: (inv.amount_paid || 0) / 100,
          paid_at: new Date((inv.status_transitions?.paid_at ?? inv.created) * 1000).toISOString().split("T")[0],
          recorded_in_crm: recorded,
        };
      });
    const missingInvoices = invoiceReport.filter((i: any) => !i.recorded_in_crm);
    if (missingInvoices.length > 0) {
      problems.push(`${missingInvoices.length} paid Stripe invoice(s) in the last ${lookbackDays} days have no matching payment row in the CRM. Run reconcile-stripe-payments.`);
    }

    // --- 4. Live subscriptions vs organizations ------------------------------
    const subs: any[] = [];
    for (const status of ["active", "trialing", "past_due", "unpaid"]) {
      let sa: string | undefined;
      let more = true;
      while (more) {
        const params: Record<string, string> = { status, limit: "100" };
        if (sa) params.starting_after = sa;
        const batch = await stripeGet("/subscriptions", stripeKey, params);
        subs.push(...(batch.data ?? []));
        more = !!batch.has_more;
        if (batch.data?.length) sa = batch.data[batch.data.length - 1].id;
      }
    }

    const { data: usersPage } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const userByEmail: Record<string, string> = {};
    for (const u of usersPage?.users ?? []) if (u.email) userByEmail[u.email.toLowerCase()] = u.id;
    const { data: members } = await supabase
      .from("organization_members")
      .select("user_id, organization_id")
      .eq("is_active", true);
    const orgByUser: Record<string, string> = {};
    for (const m of members ?? []) if (!orgByUser[m.user_id]) orgByUser[m.user_id] = m.organization_id;

    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, name, plan, billing_exempt, first_paid_at, payment_failed_at, current_period_end");
    const orgById: Record<string, any> = {};
    for (const o of orgs ?? []) orgById[o.id] = o;

    const subscriptionReport: any[] = [];
    for (const sub of subs) {
      let email: string | null = null;
      try {
        const cust = await stripeGet(`/customers/${sub.customer}`, stripeKey);
        email = cust?.deleted ? null : cust.email;
      } catch { /* customer gone */ }
      const uid = email ? userByEmail[email.toLowerCase()] : null;
      const orgId = uid ? orgByUser[uid] : null;
      const org = orgId ? orgById[orgId] : null;
      const productId = sub.items?.data?.[0]?.price?.product as string | undefined;
      const stripePlan = productId ? PRODUCT_TO_PLAN[productId] ?? null : null;
      const periodEndUnix = subPeriodEnd(sub);
      const stripePeriodEnd = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString().split("T")[0] : null;
      const orgPeriodEnd = org?.current_period_end ? String(org.current_period_end).split("T")[0] : null;

      const issues: string[] = [];
      if (!email) issues.push("Stripe customer has no email — the CRM matches customers to organizations by email, so this subscription can never be linked.");
      else if (!orgId) issues.push(`No active CRM user/organization matches ${email} — payments for this subscription will never be recorded.`);
      if (org && stripePlan && org.plan !== stripePlan) issues.push(`Plan mismatch: Stripe says ${stripePlan}, CRM says ${org.plan}.`);
      if (org && stripePeriodEnd && orgPeriodEnd !== stripePeriodEnd) issues.push(`Renewal date mismatch: Stripe ${stripePeriodEnd}, CRM ${orgPeriodEnd ?? "null"}.`);
      if (org && sub.status === "active" && org.payment_failed_at) issues.push("Subscription is active in Stripe but the CRM still has a payment failure clock running — the customer may get blocked wrongly.");
      if (org && ["past_due", "unpaid"].includes(sub.status) && !org.payment_failed_at) issues.push(`Subscription is ${sub.status} in Stripe but the CRM has no failure clock — this customer will never be blocked.`);
      if (org && !org.first_paid_at && sub.status === "active") issues.push("Active subscription but the organization has no first_paid_at stamp.");

      problems.push(...issues.map((i) => `Subscription ${sub.id} (${email ?? "no email"}): ${i}`));
      subscriptionReport.push({
        subscription_id: sub.id,
        status: sub.status,
        email,
        org_name: org?.name ?? null,
        stripe_plan: stripePlan,
        crm_plan: org?.plan ?? null,
        stripe_period_end: stripePeriodEnd,
        crm_period_end: orgPeriodEnd,
        issues,
      });
    }

    // --- 5. Cron safety net --------------------------------------------------
    const { data: cronJobs } = await supabase
      .from("cron_job_status")
      .select("jobname, schedule, active")
      .in("jobname", ["reconcile-stripe-payments-daily", "reconcile-plans-daily"]);
    // The view may not exist in every environment — absence is not an error.
    const reconcileCron = (cronJobs ?? []).find((j: any) => j.jobname === "reconcile-stripe-payments-daily");
    if (cronJobs && !reconcileCron) {
      problems.push("The daily reconcile-stripe-payments cron job is not scheduled — the safety net that recovers missed payments is off.");
    }

    const report = {
      checked_at: new Date().toISOString(),
      project_ref: projectRef,
      healthy: problems.length === 0,
      problems,
      webhook: {
        endpoints,
        signing_secret_fingerprint: webhookSecret
          ? `len=${webhookSecret.length} …${webhookSecret.slice(-4)}`
          : "NOT SET",
        undelivered_events: undelivered,
        invoice_paid_events: invoicePaidEvents,
      },
      invoices: {
        lookback_days: lookbackDays,
        paid_count: invoiceReport.length,
        missing_in_crm: missingInvoices,
      },
      subscriptions: subscriptionReport,
      cron: cronJobs ?? "cron_job_status view unavailable",
    };

    console.log(`[STRIPE-HEALTH] healthy=${report.healthy} problems=${problems.length}`);
    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[STRIPE-HEALTH] ERROR", msg);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
