import { requestMfaResponse } from "../_shared/user-authorization.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PRODUCT_TO_PLAN: Record<string, string> = {
  "prod_U0wAc7Tuy8w6gA": "starter",
  "prod_U0wGoA4odOBHOZ": "pro",
  "prod_U0wG6doz0zgZFV": "elite",
};

const PLAN_BASE_USERS: Record<string, number> = {
  starter: 5,
  pro: 15,
  elite: 999999,
};

const EXTRA_SEAT_PRICE = "price_1TncdBLWnA81DzXTh3crx8iN";

function baseUsersForPlan(planId: string): number {
  return PLAN_BASE_USERS[planId] || 5;
}

function maxUsersForOrg(orgData: any): number {
  if (orgData?.max_users_override != null) return Number(orgData.max_users_override);
  const base = baseUsersForPlan(orgData?.plan ?? "starter");
  const extra = Number(orgData?.extra_seats ?? 0);
  return base + extra;
}

// How many days after a failed payment the org keeps full access while the
// customer settles the renewal. The clock is anchored on payment_failed_at
// (the real failure date) — NOT current_period_end, which can be stale. Within
// this window the customer sees a warning banner; past it, the plan-expired
// blocker shows up.
const GRACE_DAYS = 4;

const DAY_MS = 24 * 60 * 60 * 1000;

// Single source of truth for the grace math. Given the failure timestamp,
// decides whether the org is still in the warning window (payment_overdue) or
// already past it (plan_expired), and exposes when the block happens.
//   - payment_overdue: overdue but still inside the grace window → show banner
//   - plan_expired:    grace window elapsed → show the full-screen blocker
// The two are mutually exclusive. No failure timestamp → neither (fail open).
function computeOverdueState(failedAtIso: string | null | undefined) {
  if (!failedAtIso) {
    return { payment_overdue: false, plan_expired: false, block_at: null, days_until_block: null };
  }
  const blockAtMs = new Date(failedAtIso).getTime() + GRACE_DAYS * DAY_MS;
  const blocked = Date.now() > blockAtMs;
  return {
    payment_overdue: !blocked,
    plan_expired: blocked,
    block_at: new Date(blockAtMs).toISOString(),
    days_until_block: Math.max(0, Math.ceil((blockAtMs - Date.now()) / DAY_MS)),
  };
}

// Lightweight Stripe API calls without the heavy SDK
async function stripeGet(path: string, key: string, params?: Record<string, string>) {
  const url = new URL(`https://api.stripe.com/v1${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${key}` },
  });
  return res.json();
}

// Look for a subscription in any of the statuses that mean "this customer has
// already paid at some point" — active, trialing (managed by Stripe trial),
// past_due (failed renewal but still recoverable) and unpaid (final dunning
// state before cancellation). canceled and incomplete are NOT included.
const PAYER_STATUSES = ["active", "trialing", "past_due", "unpaid"];


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
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const user = userData.user;
    if (!user?.email) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const mfaResponse = await requestMfaResponse(req, user.id, corsHeaders);
    if (mfaResponse) return mfaResponse;

    const body = await req.json().catch(() => ({}));
    let orgId: string | null = body.organization_id ?? null;
    if (!orgId) {
      const { data: memberships, error } = await supabase.from('organization_members')
        .select('organization_id').eq('user_id', user.id).eq('is_active', true).limit(2);
      if (error) throw error;
      if (memberships?.length !== 1) return json({ error: 'Seleciona uma organização.' }, 400);
      orgId = memberships[0].organization_id;
    }
    const { data: allowed, error: accessError } = await supabase.rpc('is_org_member', { _user_id: user.id, _org_id: orgId });
    const { data: adminAllowed } = await supabase.rpc('is_org_admin', { _user_id: user.id, _org_id: orgId });
    if (accessError || (!allowed && !adminAllowed)) return json({ error: 'Sem acesso à organização.' }, 403);

    let orgData: any = null;
    if (orgId) {
      const { data, error: orgErr } = await supabase
        .from('organizations')
        .select('billing_exempt, trial_ends_at, payment_failed_at, first_paid_at, current_period_end, plan, extra_seats, max_users_override')
        .eq('id', orgId)
        .maybeSingle();
      orgData = data;
      if (orgErr) console.error("[check-subscription] org fetch error", orgErr);

      // Active member count for extra seats UI
      if (orgData) {
        const { count: memCount } = await supabase
          .from('organization_members')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('is_active', true);
        orgData.active_member_count = memCount ?? 0;
      }
    }

    console.log("[check-subscription] entry", {
      user_email: user.email,
      org_id: orgId,
      org_data: orgData,
    });

    // billing_exempt means "skip all blockers" — NOT "grant Elite access".
    // The actual plan tier (and therefore which modules are unlocked) is
    // controlled by the org's `plan` column. Demo orgs that should have full
    // Elite access must have `plan = 'elite'` set explicitly.
    //
    // This avoids the bug where the workaround `billing_exempt = true` to
    // bypass a misbehaving trial blocker silently elevated a Starter customer
    // to Elite-level module access.
    if (orgData?.billing_exempt === true) {
      return json({
        subscribed: true,
        plan_id: orgData.plan ?? 'starter',
        product_id: null,
        subscription_end: null,
        billing_exempt: true,
        first_paid_at: orgData.first_paid_at ?? null,
      });
    }

    const { data: binding, error: bindingError } = await supabase.from('organization_billing_accounts')
      .select('stripe_customer_id, stripe_subscription_id').eq('organization_id', orgId).maybeSingle();
    if (bindingError) throw bindingError;
    let subscription: any = null;
    if (binding?.stripe_subscription_id) {
      const candidate = await stripeGet('/subscriptions/' + binding.stripe_subscription_id, stripeKey);
      if (candidate.error) throw new Error(candidate.error.message);
      const customerId = typeof candidate.customer === 'string' ? candidate.customer : candidate.customer?.id;
      if (customerId !== binding.stripe_customer_id) throw new Error('Billing customer mismatch');
      if (PAYER_STATUSES.includes(candidate.status)) subscription = candidate;
    }

    if (!subscription) {
      return json(buildTrialResponse(orgData));
    }

    const productId = subscription.items?.data?.[0]?.price?.product as string | undefined;
    // An unrecognised product must NOT silently rewrite the org down to
    // 'starter' — that is how a paying Elite customer loses module access after
    // a product is renamed or added in Stripe. Unknown → keep whatever the org
    // already has and shout about it (reconcile-plans applies the same rule).
    const mappedPlan = productId ? PRODUCT_TO_PLAN[productId] : undefined;
    if (productId && !mappedPlan) {
      console.error("[check-subscription] UNKNOWN Stripe product — plan left unchanged", { productId });
    }
    const planId = ['pro', 'elite'].includes(orgData?.plan) ? orgData.plan : mappedPlan || orgData?.plan || 'starter';

    const periodEnd = subscription.current_period_end ?? subscription.items.data[0]?.current_period_end;
    const subscriptionEnd = (periodEnd && typeof periodEnd === "number" && periodEnd > 0)
      ? new Date(periodEnd * 1000).toISOString()
      : null;

    const status = subscription.status as string;
    const isHealthy = status === "active" || status === "trialing";
    const isOverdue = status === "past_due" || status === "unpaid";

    // Only the confirmed invoice webhook records the first payment.
    const firstPaidAt = orgData?.first_paid_at ?? null;

    // Persist the renewal date so the cleanup cron, the
    // protected route and the blocker components have a single source of truth.
    if (orgId) {
      // Only write `plan` when Stripe gave us a product we recognise, so an
      // unknown product never overwrites a good value.
      const orgUpdates: Record<string, any> = {};
      if (mappedPlan) orgUpdates.plan = mappedPlan;
      if (subscriptionEnd) orgUpdates.current_period_end = subscriptionEnd;
      // Sub healthy again → clear any lingering failure clock ONLY via webhook.
      // Do NOT clear here: Stripe keeps "active" during retry attempts, which
      // would reset the grace window and give the customer infinite free access.
      if (Object.keys(orgUpdates).length > 0) {
        const { error: updErr } = await supabase.from('organizations').update(orgUpdates).eq('id', orgId);
        // Silently dropping this write is how plan/current_period_end/first_paid_at
        // go stale, which then feeds the blocker logic with wrong data.
        if (updErr) console.error("[check-subscription] org update FAILED", { orgId, error: updErr.message, orgUpdates });
      }
    }

    // Always compute overdue state from payment_failed_at if it exists.
    // Even if Stripe says "active" (during retry attempts), if a payment
    // failed and the grace window has passed, the customer is blocked.
    let failedAt: string | null = orgData?.payment_failed_at ?? null;
    if (isOverdue && !failedAt) {
      // Anchor on NOW, not on current_period_end. The period end is already in
      // the past by the time Stripe reports past_due, so using it consumed the
      // whole grace window instantly and hard-blocked a customer who was
      // entitled to GRACE_DAYS to settle. First observation starts the clock.
      failedAt = new Date().toISOString();
      if (orgId) {
        const { error: failErr } = await supabase
          .from('organizations')
          .update({ payment_failed_at: failedAt })
          .eq('id', orgId)
          .is('payment_failed_at', null);
        if (failErr) console.error("[check-subscription] failed to record payment_failed_at", { orgId, error: failErr.message });
      }
    }

    // payment_overdue (in grace → banner) vs plan_expired (past grace →
    // PaymentOverdueBlocker, "renew your plan" — they're NOT a trial).
    const overdue = computeOverdueState(failedAt);

    return json({
      subscribed: isHealthy,
      plan_id: planId,
      product_id: productId,
      subscription_end: subscriptionEnd,
      status,
      payment_overdue: overdue.payment_overdue,
      plan_expired: overdue.plan_expired,
      block_at: overdue.block_at,
      days_until_block: overdue.days_until_block,
      payment_failed_at: failedAt,
      first_paid_at: firstPaidAt,
      current_period_end: subscriptionEnd,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return json({ error: msg }, 500);
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function getLegacyPaymentOverdue(orgData: any) {
  if (!orgData?.payment_failed_at) return { payment_failed_at: null, payment_overdue: false };
  const overdue = (Date.now() - new Date(orgData.payment_failed_at).getTime()) > GRACE_DAYS * DAY_MS;
  return { payment_failed_at: orgData.payment_failed_at, payment_overdue: overdue };
}

// Builds the response for an org with no Stripe subscription found.
//
// Failure modes we explicitly DO NOT allow (no silent downgrade):
//   * Payer (first_paid_at set) → never returns trial_expired: true
//   * Payer with NULL current_period_end → returns plan_expired: false
//     (we have no period info, so we MUST NOT lock them out)
//   * Indeterminate state (no first_paid_at, no trial_ends_at) → returns
//     trial_expired: false. Letting an unknown org in for one session is
//     much less bad than locking out a real payer whose stamp got lost.
//
// Additional "has paid before" signals beyond first_paid_at:
//   * current_period_end set (means a Stripe webhook or manual SQL touched it)
//   * payment_failed_at set (means a sub existed and failed)
// Any of these is enough to skip the trial branch entirely.
function buildTrialResponse(orgData: any) {
  const po = getLegacyPaymentOverdue(orgData);

  const hasPaidBefore = !!(
    orgData?.first_paid_at ||
    orgData?.current_period_end ||
    orgData?.payment_failed_at
  );

  console.log("[check-subscription] buildTrialResponse", {
    has_org_data: !!orgData,
    first_paid_at: orgData?.first_paid_at ?? null,
    current_period_end: orgData?.current_period_end ?? null,
    trial_ends_at: orgData?.trial_ends_at ?? null,
    payment_failed_at: orgData?.payment_failed_at ?? null,
    hasPaidBefore,
  });

  // PAYING CUSTOMER FALL-OUT: previously paid, no live sub right now.
  // We treat as plan-expired (renew CTA), never as trial. Same grace anchor as
  // the live path: the real failure date, falling back to the renewal date
  // (current_period_end) when we never recorded a failure. No anchor at all →
  // fail open (don't lock the payer out; super admin can patch later).
  if (hasPaidBefore) {
    const anchor = orgData?.payment_failed_at ?? orgData?.current_period_end ?? null;
    const overdue = computeOverdueState(anchor);
    return {
      subscribed: false,
      plan_id: null,
      subscription_end: orgData?.current_period_end ?? null,
      on_trial: false,
      trial_expired: false,
      first_paid_at: orgData?.first_paid_at ?? null,
      current_period_end: orgData?.current_period_end ?? null,
      payment_failed_at: orgData?.payment_failed_at ?? null,
      plan_expired: overdue.plan_expired,
      payment_overdue: overdue.payment_overdue,
      block_at: overdue.block_at,
      days_until_block: overdue.days_until_block,
      extra_seats: orgData?.extra_seats ?? 0,
      plan_base_users: baseUsersForPlan(orgData?.plan ?? 'starter'),
      active_members: orgData?.active_member_count ?? 0,
      max_users: maxUsersForOrg(orgData),
    };
  }

  // INDETERMINATE: no payer signal AND no trial_ends_at. Could be a brand-new
  // org mid-onboarding, a corrupted row, or a payer whose stamps were wiped.
  // Fail open — return trial_expired: false so the user can at least enter.
  // The cleanup-expired-trials cron will not touch this org either because it
  // requires trial_ends_at to be set + in the past.
  if (!orgData?.trial_ends_at) {
    console.warn("[check-subscription] indeterminate org state — failing open", {
      org_data_present: !!orgData,
    });
    return {
      subscribed: false,
      plan_id: null,
      subscription_end: null,
      on_trial: false,
      trial_expired: false,
      first_paid_at: null,
      ...po,
      extra_seats: orgData?.extra_seats ?? 0,
      plan_base_users: baseUsersForPlan(orgData?.plan ?? 'starter'),
      active_members: orgData?.active_member_count ?? 0,
      max_users: maxUsersForOrg(orgData),
    };
  }
  const diffMs = new Date(orgData.trial_ends_at).getTime() - Date.now();
  const days = Math.max(0, Math.ceil(diffMs / 86400000));
  if (diffMs > 0) {
    return {
      subscribed: false,
      plan_id: null,
      subscription_end: null,
      on_trial: true,
      trial_ends_at: orgData.trial_ends_at,
      days_remaining: days,
      trial_expired: false,
      first_paid_at: null,
      ...po,
      extra_seats: orgData?.extra_seats ?? 0,
      plan_base_users: baseUsersForPlan(orgData?.plan ?? 'starter'),
      active_members: orgData?.active_member_count ?? 0,
      max_users: maxUsersForOrg(orgData),
    };
  }
  return {
    subscribed: false,
    plan_id: null,
    subscription_end: null,
    on_trial: false,
    trial_ends_at: orgData.trial_ends_at,
    days_remaining: 0,
    trial_expired: true,
    first_paid_at: null,
    ...po,
    extra_seats: orgData?.extra_seats ?? 0,
    plan_base_users: baseUsersForPlan(orgData?.plan ?? 'starter'),
    active_members: orgData?.active_member_count ?? 0,
    max_users: maxUsersForOrg(orgData),
  };
}
