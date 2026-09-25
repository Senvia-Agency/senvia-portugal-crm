import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { recordStripeFeeExpense } from "../_shared/stripe-fee-expense.ts";

// Daily safety net for the finance pipeline: lists PAID Stripe invoices from
// the last N days and records any that stripe-webhook missed (delivery failure,
// signature mismatch, downtime). Mirrors handleInvoicePaid in
// ../stripe-webhook/index.ts — keep the two in sync when the money logic
// changes. Idempotent: an invoice already present in sale_payments (matched by
// its Stripe invoice id in the notes) or stripe_commission_records is skipped.

const SENVIA_AGENCY_ORG_ID = "06fe9e1d-9670-45b0-8717-c5a6e90be380";

const PRODUCT_TO_PLAN: Record<string, string> = {
  "prod_U0wAc7Tuy8w6gA": "starter",
  "prod_U0wGoA4odOBHOZ": "pro",
  "prod_U0wG6doz0zgZFV": "elite",
};

const PLAN_LIST_NAMES: Record<string, string> = {
  starter: "Plano Starter",
  pro: "Plano Pro",
  elite: "Plano Elite",
};

const DEFAULT_LOOKBACK_DAYS = 10;
const BILLING_FEE_RATE = 0.007;
const round2 = (n: number) => Math.round(n * 100) / 100;

const logStep = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[RECONCILE-STRIPE-PAYMENTS] ${step}${d}`);
};

// Money-path failures go to console.error so log-level alerting can see them.
const logError = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : "";
  console.error(`[RECONCILE-STRIPE-PAYMENTS] ERROR ${step}${d}`);
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

/**
 * Authorises the caller against `stripe_cron_secret`, which lives only in
 * Supabase Vault. The pg_cron job reads it from Vault to build the request
 * header, and `public.verify_stripe_cron_secret` (SECURITY DEFINER, executable
 * by service_role only) compares it here — the secret itself is never returned
 * to anyone, never stored in an env var, and never appears in the cron
 * definition. CRON_SECRET remains as a manual escape hatch. Fails closed.
 */
async function isAuthorized(req: Request, supabase: any): Promise<boolean> {
  const provided = req.headers.get("x-cron-secret") || new URL(req.url).searchParams.get("key");
  if (!provided) return false;

  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && provided === cronSecret) return true;

  const { data, error } = await supabase.rpc("verify_stripe_cron_secret", { p_secret: provided });
  if (error) {
    logError("authorization check failed", { error: error.message });
    return false;
  }
  return data === true;
}

// Lightweight Stripe API calls without the heavy SDK
async function stripeGet(path: string, key: string, params?: Record<string, string>) {
  const url = new URL(`https://api.stripe.com/v1${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${key}` } });
  const body = await res.json();
  if (!res.ok) throw new Error(`Stripe ${path}: ${body?.error?.message || res.status}`);
  return body;
}

// The subscription/charge/payment_intent fields moved around across Stripe API
// versions (Basil moved invoice.subscription under parent.subscription_details).
// Read both shapes.
function invoiceSubscriptionId(inv: any): string | null {
  const idOf = (v: any): string | null => (typeof v === "string" ? v : v?.id) || null;
  return idOf(inv.subscription) ?? idOf(inv.parent?.subscription_details?.subscription);
}

function invoiceChargeIds(inv: any): { chargeId: string | null; piId: string | null } {
  const idOf = (v: any): string | null => (typeof v === "string" ? v : v?.id) || null;
  let chargeId = idOf(inv.charge);
  let piId = idOf(inv.payment_intent);
  if (!chargeId && !piId && inv.payments?.data?.length) {
    piId = idOf(inv.payments.data[0]?.payment?.payment_intent);
  }
  return { chargeId, piId };
}

async function invoiceFeeBreakdown(invoice: any, stripeKey: string): Promise<{ fee: number; net: number }> {
  const amount = (invoice.amount_paid || 0) / 100;
  try {
    let { chargeId, piId } = invoiceChargeIds(invoice);
    if (!chargeId && !piId) {
      const full = await stripeGet(`/invoices/${invoice.id}`, stripeKey, { "expand[]": "payments" });
      ({ chargeId, piId } = invoiceChargeIds(full));
    }
    let charge: any = null;
    if (chargeId) {
      charge = await stripeGet(`/charges/${chargeId}`, stripeKey, { "expand[]": "balance_transaction" });
    } else if (piId) {
      const pi = await stripeGet(`/payment_intents/${piId}`, stripeKey, { "expand[]": "latest_charge.balance_transaction" });
      charge = pi.latest_charge;
    }
    let transaction: any = charge && typeof charge !== "string" ? charge.balance_transaction : null;
    if (typeof transaction === "string") transaction = await stripeGet(`/balance_transactions/${transaction}`, stripeKey);
    if (!transaction) return { fee: 0, net: amount };

    // Stripe's invoice balance transaction contains the card fee; Stripe
    // Billing's usage fee is charged separately and is calculated as before.
    const cardFee = (transaction.fee || 0) / 100;
    const billingFee = round2(amount * BILLING_FEE_RATE);
    const fee = round2(cardFee + billingFee);
    return { fee, net: round2(amount - fee) };
  } catch (error) {
    logStep("could not fetch Stripe fee, temporarily using gross", {
      invoice: invoice.id,
      error: (error as Error).message,
    });
    return { fee: 0, net: amount };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  // Guard: this function writes sale_payments, stripe_commission_records and
  // organizations with the service-role key, and its response lists customer
  // emails and amounts — it must never be publicly invokable. Fails closed.
  if (!(await isAuthorized(req, supabase))) {
    return new Response(JSON.stringify({ error: "Não autorizado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not set");

    let lookbackDays = DEFAULT_LOOKBACK_DAYS;
    try {
      const body = await req.json();
      if (body?.lookback_days && Number(body.lookback_days) > 0) {
        // Capped well above the daily 10-day run so an occasional manual call
        // can also backfill billing_period_start/end on older rows.
        lookbackDays = Math.min(Number(body.lookback_days), 180);
      }
    } catch { /* empty body is fine */ }

    const createdGte = Math.floor(Date.now() / 1000) - lookbackDays * 86400;
    logStep("Starting", { lookbackDays });

    // All paid invoices in the window
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
    logStep("Paid invoices in window", { count: invoices.length });

    // email -> orgId map built once per run (webhook resolves per event)
    const { data: usersPage, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) throw new Error(`listUsers: ${listErr.message}`);
    const userByEmail: Record<string, string> = {};
    for (const u of usersPage.users) {
      if (u.email) userByEmail[u.email.toLowerCase()] = u.id;
    }
    const orgByUser: Record<string, string> = {};
    const { data: members } = await supabase
      .from("organization_members")
      .select("user_id, organization_id")
      .eq("is_active", true);
    for (const m of members ?? []) {
      if (!orgByUser[m.user_id]) orgByUser[m.user_id] = m.organization_id;
    }
    const findOrgByEmail = (email: string): string | null => {
      const uid = userByEmail[email.toLowerCase()];
      return uid ? orgByUser[uid] ?? null : null;
    };

    const summary = {
      scanned: invoices.length,
      recorded: [] as Array<Record<string, unknown>>,
      already_recorded: 0,
      no_org: [] as string[],
      no_sale: [] as string[],
      zero_amount: 0,
      no_email: [] as string[],
      /** Invoices skipped because a manually-entered payment appears to be the same money. */
      skipped_possible_manual: [] as Array<Record<string, unknown>>,
      /** Invoices this run tried and failed to record. Non-empty means action is needed. */
      failed: [] as Array<Record<string, unknown>>,
    };

    for (const invoice of invoices) {
      const email = invoice.customer_email;
      const amount = (invoice.amount_paid || 0) / 100;
      if (amount <= 0) { summary.zero_amount++; continue; }

      // Dedupe on the dedicated column (backed by a unique index). The notes
      // match is kept for rows written before the column existed.
      const { data: existingPayment } = await supabase
        .from("sale_payments")
        .select("id, billing_period_start, billing_period_end")
        .eq("organization_id", SENVIA_AGENCY_ORG_ID)
        .or(`stripe_invoice_id.eq.${invoice.id},notes.ilike.%${invoice.id}%`)
        .limit(1);
      if (existingPayment && existingPayment.length > 0) {
        summary.already_recorded++;
        const { fee, net } = await invoiceFeeBreakdown(invoice, stripeKey);
        const paidAt = new Date((invoice.status_transitions?.paid_at ?? invoice.created) * 1000)
          .toISOString().split("T")[0];
        const paymentUpdate: Record<string, unknown> = {
          amount,
          stripe_gross_amount: amount,
          stripe_fee_amount: fee,
          stripe_net_amount: net,
          updated_at: new Date().toISOString(),
        };
        if (!existingPayment[0].billing_period_start && invoice.period_start) {
          paymentUpdate.billing_period_start = new Date(invoice.period_start * 1000).toISOString().split("T")[0];
        }
        if (!existingPayment[0].billing_period_end && invoice.period_end) {
          paymentUpdate.billing_period_end = new Date(invoice.period_end * 1000).toISOString().split("T")[0];
        }
        const { error: paymentUpdateError } = await supabase.from("sale_payments")
          .update(paymentUpdate).eq("id", existingPayment[0].id);
        if (paymentUpdateError) {
          summary.failed.push({ invoice_id: invoice.id, reason: `payment repair: ${paymentUpdateError.message}` });
          continue;
        }
        try {
          await recordStripeFeeExpense(supabase, {
            organizationId: SENVIA_AGENCY_ORG_ID,
            invoiceId: invoice.id,
            fee,
            gross: amount,
            net,
            expenseDate: paidAt,
          });
        } catch (error) {
          summary.failed.push({ invoice_id: invoice.id, reason: (error as Error).message });
          continue;
        }
        // Backfill: rows written before billing_period_start/end existed (or by
        // the pre-fix webhook) show only the charge date, not the month they pay
        // for — the exact confusion that made a real August payment look missing
        // when Finance was filtered to August. One-time repair, then skip.
        const row = existingPayment[0];
        if (!row.billing_period_start && !row.billing_period_end && invoice.period_start && invoice.period_end) {
          const { error: backfillErr } = await supabase
            .from("sale_payments")
            .update({
              billing_period_start: new Date(invoice.period_start * 1000).toISOString().split("T")[0],
              billing_period_end: new Date(invoice.period_end * 1000).toISOString().split("T")[0],
            })
            .eq("id", row.id);
          if (backfillErr) logError("billing period backfill error", { invoice: invoice.id, error: backfillErr.message });
          else logStep("backfilled billing period on existing payment", { invoice: invoice.id, payment_id: row.id });
        }
        continue;
      }

      if (!email) { summary.no_email.push(invoice.id); continue; }

      const clientOrgId = findOrgByEmail(email);
      if (!clientOrgId) { logStep("no org for email", { email }); summary.no_org.push(invoice.id); continue; }

      // Plan + real recurring total from the live subscription
      let plan: string | null = null;
      let recurringTotal = 0;
      let subscriptionRenewalDate: string | null = null;
      let subPeriodEndUnix: number | null = null;
      const subId = invoiceSubscriptionId(invoice);
      if (subId) {
        try {
          const sub = await stripeGet(`/subscriptions/${subId}`, stripeKey);
          const productId = sub.items?.data?.[0]?.price?.product as string | undefined;
          plan = productId ? PRODUCT_TO_PLAN[productId] || null : null;
          recurringTotal = (sub.items?.data ?? []).reduce((sum: number, item: any) => {
            if (item.price?.recurring && item.price.unit_amount != null) {
              return sum + (item.price.unit_amount / 100) * (item.quantity || 1);
            }
            return sum;
          }, 0);
          subPeriodEndUnix = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
          if (subPeriodEndUnix) {
            subscriptionRenewalDate = new Date(subPeriodEndUnix * 1000).toISOString().split("T")[0];
          }
        } catch (e) {
          logStep("failed to fetch sub details", { error: (e as Error).message });
        }
      }

      const paidAtUnix = invoice.status_transitions?.paid_at ?? invoice.created;
      const paidAtIso = new Date(paidAtUnix * 1000).toISOString();
      const paymentDate = paidAtIso.split("T")[0];
      const periodEnd = invoice.period_end
        ? new Date(invoice.period_end * 1000).toISOString().split("T")[0]
        : null;
      // See the matching comment in stripe-webhook: the invoice is dated
      // paymentDate but pays for periodStart→periodEnd, which is frequently a
      // different calendar month.
      const periodStart = invoice.period_start
        ? new Date(invoice.period_start * 1000).toISOString().split("T")[0]
        : null;

      // Org bookkeeping (all idempotent): paying customer stamp, renewal date,
      // and clear a failure clock that predates this payment (never a newer one).
      await supabase
        .from("organizations")
        .update({ first_paid_at: paidAtIso })
        .eq("id", clientOrgId)
        .is("first_paid_at", null);
      if (subPeriodEndUnix) {
        await supabase
          .from("organizations")
          .update({ current_period_end: new Date(subPeriodEndUnix * 1000).toISOString() })
          .eq("id", clientOrgId);
      }
      await supabase
        .from("organizations")
        .update({ payment_failed_at: null })
        .eq("id", clientOrgId)
        .lt("payment_failed_at", paidAtIso);

      // Linked sale in the agency org
      // Mirrors the webhook: `pending` included (a sale can be paid before it is
      // moved out of pending) and ordering fixed so multi-sale client orgs always
      // resolve to the same sale.
      const { data: sales, error: salesErr } = await supabase
        .from("sales")
        .select("id, created_by, total_value, has_recurring, status")
        .eq("organization_id", SENVIA_AGENCY_ORG_ID)
        .eq("client_org_id", clientOrgId)
        .in("status", ["pending", "in_progress", "fulfilled", "delivered"])
        .order("created_at", { ascending: true })
        .limit(1);
      if (salesErr) {
        logError("sales query error", { error: salesErr.message });
        summary.failed.push({ invoice_id: invoice.id, reason: `sales query: ${salesErr.message}` });
        continue;
      }
      if (!sales || sales.length === 0) { logStep("no linked sale", { clientOrgId }); summary.no_sale.push(invoice.id); continue; }
      const sale = sales[0];

      // Legacy safety net: payments entered by hand carry no invoice id, so the
      // dedupe above cannot see them. If this sale already has a manual payment
      // of the same amount within a few days, assume it is the same money and
      // report it for review instead of recording it twice.
      const windowDays = 7;
      const from = new Date(paidAtUnix * 1000 - windowDays * 86400_000).toISOString().split("T")[0];
      const to = new Date(paidAtUnix * 1000 + windowDays * 86400_000).toISOString().split("T")[0];
      const { data: manualNearby } = await supabase
        .from("sale_payments")
        .select("id, amount, payment_date, notes")
        .eq("sale_id", sale.id)
        .is("stripe_invoice_id", null)
        .gte("payment_date", from)
        .lte("payment_date", to);
      const manualMatch = (manualNearby ?? []).find(
        (p: any) => Math.abs(Number(p.amount) - amount) < 0.5
      );
      if (manualMatch) {
        logStep("skipping invoice: a manual payment of the same amount already exists", {
          invoice: invoice.id, manual_payment_id: manualMatch.id,
        });
        summary.skipped_possible_manual.push({
          invoice_id: invoice.id,
          amount,
          invoice_paid_at: paymentDate,
          existing_payment_id: manualMatch.id,
          existing_payment_date: manualMatch.payment_date,
          existing_notes: manualMatch.notes,
        });
        continue;
      }

      const updatePayload: Record<string, any> = {
        recurring_status: "active",
        next_renewal_date: subscriptionRenewalDate || periodEnd,
        last_renewal_date: paymentDate,
      };
      if (recurringTotal > 0) updatePayload.recurring_value = recurringTotal;
      const { error: saleUpdateErr } = await supabase.from("sales").update(updatePayload).eq("id", sale.id);
      if (saleUpdateErr) logStep("sale update error", { error: saleUpdateErr.message });

      // Commission (same rules and dedupe key as the webhook)
      if (sale.created_by) {
        const { data: existingCommission } = await supabase
          .from("stripe_commission_records")
          .select("id")
          .eq("stripe_invoice_id", invoice.id)
          .limit(1);
        if (!existingCommission || existingCommission.length === 0) {
          const { data: orgSettings } = await supabase
            .from("organizations")
            .select("sales_settings")
            .eq("id", SENVIA_AGENCY_ORG_ID)
            .maybeSingle();
          const globalRate = orgSettings?.sales_settings?.commission_percentage || 0;
          const { data: member } = await supabase
            .from("organization_members")
            .select("commission_rate")
            .eq("organization_id", SENVIA_AGENCY_ORG_ID)
            .eq("user_id", sale.created_by)
            .eq("is_active", true)
            .maybeSingle();
          const rate = globalRate > 0 ? globalRate : Number(member?.commission_rate || 0);
          if (rate > 0) {
            const periodStart = invoice.period_start
              ? new Date(invoice.period_start * 1000).toISOString().split("T")[0]
              : null;
            const { error: commissionErr } = await supabase.from("stripe_commission_records").insert({
              organization_id: SENVIA_AGENCY_ORG_ID,
              sale_id: sale.id,
              user_id: sale.created_by,
              client_org_id: clientOrgId,
              amount,
              commission_rate: rate,
              commission_amount: amount * (rate / 100),
              stripe_invoice_id: invoice.id,
              period_start: periodStart,
              period_end: periodEnd,
              plan,
              status: "pending",
            });
            if (commissionErr) logStep("commission insert error", { error: commissionErr.message });
          }
        }
      }

      const { fee: stripeFee, net: netAmount } = await invoiceFeeBreakdown(invoice, stripeKey);

      const planLabel = plan ? PLAN_LIST_NAMES[plan] || plan : "subscription";
      const feeNote = stripeFee > 0 ? ` · bruto ${amount.toFixed(2)}€, taxa ${stripeFee.toFixed(2)}€` : "";
      try {
        await recordStripeFeeExpense(supabase, {
          organizationId: SENVIA_AGENCY_ORG_ID,
          invoiceId: invoice.id,
          fee: stripeFee,
          gross: amount,
          net: netAmount,
          expenseDate: paymentDate,
        });
      } catch (error) {
        logError("Stripe fee expense insert error", { invoice: invoice.id, error: (error as Error).message });
        summary.failed.push({ invoice_id: invoice.id, reason: (error as Error).message });
        continue;
      }
      const { error: paymentErr } = await supabase.from("sale_payments").insert({
        organization_id: SENVIA_AGENCY_ORG_ID,
        sale_id: sale.id,
        amount,
        payment_date: paymentDate,
        status: "paid",
        payment_method: "card",
        stripe_invoice_id: invoice.id,
        stripe_gross_amount: amount,
        stripe_fee_amount: stripeFee,
        stripe_net_amount: netAmount,
        billing_period_start: periodStart,
        billing_period_end: periodEnd,
        notes: `Stripe ${planLabel} · ${invoice.id}${feeNote} (reconciliado)`,
      });
      if (paymentErr) {
        // 23505 = the webhook recorded it between our dedupe check and this
        // insert. That is the unique index doing its job, not a failure.
        if ((paymentErr as any).code === "23505") {
          logStep("payment already recorded concurrently", { invoice: invoice.id });
          summary.already_recorded++;
          continue;
        }
        logError("payment insert error", { invoice: invoice.id, error: paymentErr.message });
        summary.failed.push({ invoice_id: invoice.id, reason: paymentErr.message });
        continue;
      }

      logStep("recovered missed payment", { invoice: invoice.id, email, amount, netAmount });
      summary.recorded.push({
        invoice_id: invoice.id,
        email,
        client_org_id: clientOrgId,
        sale_id: sale.id,
        amount,
        net_amount: netAmount,
        payment_date: paymentDate,
      });
    }

    if (summary.failed.length > 0) {
      logError("run finished WITH FAILURES — these invoices are still unrecorded", { failed: summary.failed });
    }
    if (summary.no_sale.length > 0) {
      logError("invoices with no linked sale — payment not recorded", { invoices: summary.no_sale });
    }
    logStep("Done", {
      scanned: summary.scanned,
      recorded: summary.recorded.length,
      already_recorded: summary.already_recorded,
      failed: summary.failed.length,
    });

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
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
