import { requestMfaResponse } from "../_shared/user-authorization.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXTRA_SEAT_PRICE = "price_1TncdBLWnA81DzXTh3crx8iN";

interface RequestBody {
  quantity?: number;
  organization_id?: string; // optional — for super admin purchasing on behalf of another org
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Get user and org from JWT
    const { data: { user }, error: userErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userErr || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const mfaResponse = await requestMfaResponse(req, user.id, corsHeaders);
    if (mfaResponse) return mfaResponse;

    // If organization_id is provided and user is super admin, use that org
    const body: RequestBody = await req.json();
    let orgId: string | null = body.organization_id ?? null;

    if (!orgId) {
      const { data: memberships, error } = await supabase.from('organization_members')
        .select('organization_id').eq('user_id', user.id).eq('is_active', true).limit(2);
      if (error) throw error;
      if (memberships?.length !== 1) return new Response(JSON.stringify({ error: 'Seleciona uma organização.' }), { status: 400, headers: corsHeaders });
      orgId = memberships[0].organization_id;
    }
    const { data: allowed, error: permissionError } = await supabase.rpc('is_org_admin', { _user_id: user.id, _org_id: orgId });
    if (permissionError || allowed !== true) return new Response(JSON.stringify({ error: 'Sem permissão para gerir utilizadores.' }), { status: 403, headers: corsHeaders });

    // Get org data
    const { data: org, error: orgErr } = await supabase
      .from("organizations")
      .select("plan, extra_seats, extra_seats_stripe_price_id")
      .eq("id", orgId)
      .single();

    if (orgErr || !org) {
      return new Response(
        JSON.stringify({ error: "Organização não encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (org.plan === "elite") {
      return new Response(
        JSON.stringify({ error: "O plano Elite não precisa de utilizadores extra — tem utilizadores ilimitados" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const quantity = body.quantity ?? 0;
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 10000) return new Response(JSON.stringify({ error: 'Quantidade inválida.' }), { status: 400, headers: corsHeaders });
    const currentExtra = org.extra_seats ?? 0;

    if (quantity === currentExtra) {
      return new Response(
        JSON.stringify({ message: "Nenhuma alteração necessária" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: binding, error: bindingError } = await supabase.from('organization_billing_accounts')
      .select('stripe_customer_id, stripe_subscription_id').eq('organization_id', orgId).maybeSingle();
    if (bindingError) throw bindingError;
    if (binding?.stripe_subscription_id) {
      const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
      if (!stripeKey) throw new Error('Stripe unavailable');
      const stripe = new Stripe(stripeKey);
      const sub = await stripe.request('GET', '/subscriptions/' + binding.stripe_subscription_id);
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
      if (customerId !== binding.stripe_customer_id) throw new Error('Billing customer mismatch');
      if (['active','trialing','past_due'].includes(sub.status)) {
        const extras = sub.items.data.filter((item: any) => item.price.id === EXTRA_SEAT_PRICE);
        if (extras.length > 1) throw new Error('Duplicate seat items require review');
        if (quantity === 0 && extras[0]) await stripe.subscriptionItems.del(extras[0].id);
        else if (extras[0]) await stripe.subscriptionItems.update(extras[0].id, { quantity });
        else if (quantity > 0) await stripe.subscriptionItems.create({ subscription: sub.id, price: EXTRA_SEAT_PRICE, quantity });
      }
    }
    // Persist only after Stripe accepted the update; errors must not grant unpaid seats.
    const { error: updateErr } = await supabase.from('organizations').update({
      extra_seats: quantity, extra_seats_stripe_price_id: quantity > 0 ? EXTRA_SEAT_PRICE : null,
    }).eq('id', orgId);
    if (updateErr) throw updateErr;

    return new Response(
      JSON.stringify({
        message: `Utilizadores extra atualizados para ${quantity}`,
        quantity,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[buy-extra-seats] error", err);
    return new Response(
      JSON.stringify({ error: "Erro interno do servidor" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Minimal Stripe client — only the methods we need
class Stripe {
  private key: string;
  constructor(key: string) { this.key = key; }

  async request(method: string, path: string, body?: any) {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body ? new URLSearchParams(body).toString() : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Stripe error: ${res.status}`);
    return data;
  }

  subscriptions = {
    list: (params: any) => this.request("GET", `/subscriptions?${new URLSearchParams(params)}`),
  };

  subscriptionItems = {
    create: (params: any) => this.request("POST", "/subscription_items", params),
    update: (id: string, params: any) =>
      this.request("POST", `/subscription_items/${id}`, params),
    del: (id: string) => this.request("DELETE", `/subscription_items/${id}`),
  };
}
