// review-video — Senvia reviews the video-review programme (super admins only).
//
// Actions:
//   list          → submissions waiting for Senvia (video, or Instagram post) with a 1 h signed video URL
//   approve_video → pending → video_approved (the organization may now post it on Instagram)
//   approve_post  → post_submitted → approved, and the discount goes on the subscription in Stripe:
//                   a 25% coupon valid once, so it comes out of the next monthly invoice
//   reject        → any open step → rejected, with a reason the organization can read
import { requestMfaResponse } from "../_shared/user-authorization.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const OPEN = ["pending", "video_approved", "post_submitted"];

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
    const { data: isSuper } = await admin.rpc("has_role", { _user_id: user.id, _role: "super_admin" });
    if (isSuper !== true) return json({ error: "Só a Senvia pode rever avaliações." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    if (action === "list") {
      const { data, error } = await admin.from("review_submissions")
        .select("id, organization_id, video_path, duration_seconds, status, instagram_url, post_submitted_at, reject_reason, discount_percent, created_at, organizations(name)")
        .in("status", OPEN).order("created_at", { ascending: true });
      if (error) throw error;
      const items = await Promise.all((data ?? []).map(async (r) => {
        const { data: signed } = await admin.storage.from("review-videos").createSignedUrl(r.video_path, 3600);
        const org = r.organizations as { name?: string } | { name?: string }[] | null;
        return { ...r, organizations: undefined, organization_name: (Array.isArray(org) ? org[0]?.name : org?.name) ?? "—", video_url: signed?.signedUrl ?? null };
      }));
      return json({ items });
    }

    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return json({ error: "Falta o identificador da avaliação." }, 400);
    const { data: review, error: reviewError } = await admin.from("review_submissions").select("*").eq("id", id).maybeSingle();
    if (reviewError) throw reviewError;
    if (!review) return json({ error: "Avaliação não encontrada." }, 404);

    if (action === "reject") {
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (reason.length < 3) return json({ error: "Indique o motivo (pelo menos 3 caracteres)." }, 400);
      if (!OPEN.includes(review.status)) return json({ error: "Esta avaliação já foi decidida." }, 409);
      const { error } = await admin.from("review_submissions")
        .update({ status: "rejected", reject_reason: reason.slice(0, 500), post_reviewed_by: user.id, post_reviewed_at: new Date().toISOString() })
        .eq("id", id).in("status", OPEN);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "approve_video") {
      if (review.status !== "pending") return json({ error: "O vídeo já não está à espera de aprovação." }, 409);
      const { error } = await admin.from("review_submissions")
        .update({ status: "video_approved", video_reviewed_by: user.id, video_reviewed_at: new Date().toISOString(), reject_reason: null })
        .eq("id", id).eq("status", "pending");
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "approve_post") {
      if (review.status !== "post_submitted") return json({ error: "O post ainda não foi enviado." }, 409);
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

      const { data: billing } = await admin.from("organization_billing_accounts")
        .select("stripe_subscription_id, status").eq("organization_id", review.organization_id).maybeSingle();
      if (!billing?.stripe_subscription_id || !["active", "trialing", "past_due"].includes(billing.status ?? "")) {
        return json({ error: "A empresa não tem uma subscrição ativa no Stripe, por isso não há mensalidade a descontar." }, 409);
      }

      // Claim first: two clicks must not create two coupons.
      const { data: claimed } = await admin.from("review_submissions")
        .update({ status: "approved", post_reviewed_by: user.id, post_reviewed_at: new Date().toISOString() })
        .eq("id", id).eq("status", "post_submitted").select("id").maybeSingle();
      if (!claimed) return json({ error: "Esta avaliação já foi decidida." }, 409);

      try {
        const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
        const sub = await stripe.subscriptions.retrieve(billing.stripe_subscription_id);
        const yearly = sub.items.data.filter((item) => item.price.recurring?.interval === "year");
        if (yearly.length) {
          // A 25%-off coupon on an annual invoice would be 25% of a whole year.
          // Annual plans get 25% of one month instead, as customer credit that
          // Stripe takes off the next invoice by itself.
          const monthCents = yearly.reduce((sum, item) =>
            sum + (item.price.unit_amount ?? 0) * (item.quantity ?? 1) / ((item.price.recurring?.interval_count ?? 1) * 12), 0);
          const amount = Math.round(monthCents * review.discount_percent / 100);
          if (amount <= 0) throw new Error("Valor da mensalidade indisponível");
          const credit = await stripe.customers.createBalanceTransaction(
            typeof sub.customer === "string" ? sub.customer : sub.customer.id,
            { amount: -amount, currency: sub.currency, description: "Avaliação em vídeo Senvia OS",
              metadata: { program: "video_review", review_id: id, organization_id: review.organization_id } },
            { idempotencyKey: `video-review-credit-${id}` },
          );
          // stripe_coupon_id keeps the Stripe reference of the reward; here it is the credit (cbtxn_…).
          await admin.from("review_submissions").update({ stripe_coupon_id: credit.id, applied_at: new Date().toISOString() }).eq("id", id);
          return json({ ok: true, credit: credit.id, amount });
        }
        const coupon = await stripe.coupons.create({
          percent_off: review.discount_percent, duration: "once", name: "Avaliação em vídeo Senvia OS",
          metadata: { program: "video_review", review_id: id, organization_id: review.organization_id },
        }, { idempotencyKey: `video-review-coupon-${id}` });
        // `discounts` replaces the list: keep what the subscription already has (e.g. a referral month).
        const existing = (sub.discounts ?? []).map((d) => ({ discount: typeof d === "string" ? d : d.id }));
        await stripe.subscriptions.update(billing.stripe_subscription_id, { discounts: [...existing, { coupon: coupon.id }] });
        await admin.from("review_submissions").update({ stripe_coupon_id: coupon.id, applied_at: new Date().toISOString() }).eq("id", id);
        return json({ ok: true, coupon: coupon.id });
      } catch (e) {
        // Stripe said no: put it back so it can be tried again.
        await admin.from("review_submissions").update({ status: "post_submitted", post_reviewed_by: null, post_reviewed_at: null }).eq("id", id);
        console.error("[review-video] stripe failed", { id, message: (e as Error).message });
        return json({ error: "O Stripe recusou o desconto: " + (e as Error).message }, 502);
      }
    }

    return json({ error: "Ação inválida" }, 400);
  } catch (e) {
    console.error("[review-video] error", (e as Error).message);
    return json({ error: "Não foi possível concluir a ação." }, 500);
  }
});
