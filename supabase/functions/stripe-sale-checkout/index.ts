import { requestMfaResponse } from "../_shared/user-authorization.ts";
// Gera o Checkout de uma venda recorrente, ligado inequivocamente à venda.
//
// O problema que isto resolve: quando o dinheiro chega, é preciso saber a que
// venda pertence. Procurar o cliente por e-mail é o erro clássico — duas vendas
// do mesmo cliente, ou dois clientes com o mesmo e-mail de contacto, e o
// pagamento vai parar à venda errada. Uma vez creditado ao sítio errado, na
// prática não se desfaz.
//
// Por isso a identidade viaja em metadata (organization_id, sale_id,
// recurrence_id) no Customer, na Checkout Session e na Subscription, e o
// client_reference_id leva o sale_id. O webhook lê IDs, nunca nomes.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  serviceClient,
  stripeClient,
  getConnectedStripeContext,
} from "../_shared/stripe-connect.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const APP_BASE = "https://app.senvia.pt";

const log = (step: string, details?: Record<string, unknown>) => {
  console.log(`[STRIPE-SALE-CHECKOUT] ${step}${details ? ` - ${JSON.stringify(details)}` : ""}`);
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface RecurrenceRow {
  id: string;
  organization_id: string;
  sale_id: string;
  amount: number;
  billing_provider: string;
  service_status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

interface SaleRow {
  id: string;
  client_id: string | null;
  code: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = serviceClient();

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return json({ error: "Não autenticado" }, 401);

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user) return json({ error: "Não autenticado" }, 401);
    const mfaResponse = await requestMfaResponse(req, user.id, corsHeaders);
    if (mfaResponse) return mfaResponse;

    const body = (await req.json()) as { recurrenceId?: string };
    const recurrenceId = body.recurrenceId ?? "";
    if (!recurrenceId) return json({ error: "recurrenceId em falta" }, 400);

    // A organização vem da recorrência, nunca do pedido.
    const { data: recurrence } = await supabase
      .from("sale_recurrences")
      .select(
        "id, organization_id, sale_id, amount, billing_provider, service_status, stripe_customer_id, stripe_subscription_id",
      )
      .eq("id", recurrenceId)
      .maybeSingle<RecurrenceRow>();
    if (!recurrence) return json({ error: "Recorrência não encontrada" }, 404);

    const { data: isMember } = await supabase.rpc("is_org_member", {
      _user_id: user.id,
      _org_id: recurrence.organization_id,
    });
    if (isMember !== true) return json({ error: "Sem acesso" }, 403);

    if (recurrence.billing_provider !== "stripe") {
      return json({ error: "Esta recorrência é de cobrança manual" }, 422);
    }
    if (recurrence.stripe_subscription_id) {
      return json({ error: "Esta recorrência já tem uma subscrição activa" }, 409);
    }

    const connection = await getConnectedStripeContext(supabase, recurrence.organization_id);
    if (!connection) return json({ error: "Nenhuma conta Stripe ligada" }, 409);
    const stripe = stripeClient();
    const onAccount = { stripeAccount: connection.stripeAccountId };

    // Prefer the Price frozen on the sale line. Falling back to the current
    // mapping is limited to legacy rows created before Price snapshots existed.
    const { data: items } = await supabase
      .from("sale_items")
      .select("product_id, quantity, stripe_price_id")
      .eq("sale_id", recurrence.sale_id);

    const productIds = (items ?? [])
      .map((item) => item.product_id)
      .filter((id): id is string => typeof id === "string");
    if (productIds.length === 0) {
      return json({ error: "A venda não tem produtos associados" }, 422);
    }

    const { data: mappings } = await supabase
      .from("stripe_product_mappings")
      .select("product_id, stripe_price_id, active")
      .eq("organization_id", recurrence.organization_id)
      .in("product_id", productIds);

    const priceByProduct = new Map<string, string>();
    for (const mapping of mappings ?? []) {
      if (mapping.active) priceByProduct.set(mapping.product_id, mapping.stripe_price_id);
    }

    const lineItems: Array<{ price: string; quantity: number }> = [];
    for (const item of items ?? []) {
      if (typeof item.product_id !== "string") continue;
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return json({ error: "Produtos recorrentes cobrados pelo Stripe exigem quantidades inteiras positivas" }, 422);
      }
      const priceId = item.stripe_price_id ?? priceByProduct.get(item.product_id);
      if (!priceId) continue;
      lineItems.push({ price: priceId, quantity });
    }

    if (lineItems.length === 0) {
      return json(
        { error: "Nenhum produto desta venda está sincronizado com o Stripe" },
        422,
      );
    }

    let checkoutAmountCents = 0;
    for (const line of lineItems) {
      const price = await stripe.prices.retrieve(line.price, {}, onAccount);
      if (!price.active || !price.recurring || price.currency.toLowerCase() !== "eur" || price.unit_amount == null) {
        return json({ error: `O preço Stripe ${line.price} não é um preço recorrente EUR válido` }, 409);
      }
      checkoutAmountCents += price.unit_amount * line.quantity;
    }
    const recurrenceAmountCents = Math.round((Number(recurrence.amount) + Number.EPSILON) * 100);
    if (checkoutAmountCents !== recurrenceAmountCents) {
      return json({
        error: "O valor congelado da recorrência não coincide com os preços Stripe desta venda. Atualiza a venda antes de abrir o checkout.",
        recurrenceAmount: recurrence.amount,
        stripeAmount: checkoutAmountCents / 100,
      }, 409);
    }

    const { data: sale } = await supabase
      .from("sales")
      .select("id, client_id, code")
      .eq("id", recurrence.sale_id)
      .maybeSingle<SaleRow>();

    const metadata = {
      senvia_organization_id: recurrence.organization_id,
      senvia_sale_id: recurrence.sale_id,
      senvia_recurrence_id: recurrence.id,
    };

    // Customer: reutiliza o ID já guardado. Nunca procura por e-mail — é assim
    // que pagamentos acabam creditados ao cliente errado.
    let customerId = recurrence.stripe_customer_id;
    if (!customerId) {
      const { data: client } = sale?.client_id
        ? await supabase
            .from("crm_clients")
            .select("name, email")
            .eq("id", sale.client_id)
            .maybeSingle<{ name: string | null; email: string | null }>()
        : { data: null };

      const customer = await stripe.customers.create(
        {
          name: client?.name ?? undefined,
          email: client?.email ?? undefined,
          metadata,
        },
        { ...onAccount, idempotencyKey: `customer:${recurrence.id}` },
      );
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        line_items: lineItems,
        client_reference_id: recurrence.sale_id,
        metadata,
        // A metadata da sessão não passa sozinha para a subscrição criada; sem
        // isto, os eventos de renovação chegariam sem forma de saber a venda.
        subscription_data: { metadata },
        success_url: `${APP_BASE}/sales?stripe=checkout_ok&sale=${recurrence.sale_id}`,
        cancel_url: `${APP_BASE}/sales?stripe=checkout_cancelado&sale=${recurrence.sale_id}`,
      },
      onAccount,
    );

    // Regenerar substitui apenas a sessão; a recorrência mantém-se a mesma.
    const { error: updateError } = await supabase
      .from("sale_recurrences")
      .update({
        stripe_customer_id: customerId,
        stripe_checkout_session_id: session.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", recurrence.id);
    if (updateError) {
      log("falha a guardar sessão", { message: updateError.message });
      return json({ error: "Checkout criado mas não ficou guardado" }, 500);
    }

    log("checkout criado", { recurrenceId: recurrence.id, sessionId: session.id });
    return json({
      checkoutUrl: session.url,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    });
  } catch (err) {
    log("erro", { message: err instanceof Error ? err.message : "desconhecido" });
    return json({ error: err instanceof Error ? err.message : "Erro inesperado" }, 500);
  }
});
