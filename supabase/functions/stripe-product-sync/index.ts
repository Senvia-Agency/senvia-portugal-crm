import { requestMfaResponse } from "../_shared/user-authorization.ts";
// Sincroniza um produto recorrente do CRM com o Stripe da organização.
//
// Modelo do Stripe: o Product é o serviço (nome, descrição) e é mutável; o Price
// é o valor e é IMUTÁVEL. Mudar o preço não é editar o Price — é criar um novo e
// apontar as subscrições para ele. Por isso mudar o nome não gera Price novo, e
// mudar o valor gera sempre.
//
// A troca de preço usa proration_behavior=none de propósito: o cliente que já
// pagou este mês não recebe um acerto retroactivo pela alteração. O valor novo
// entra no ciclo seguinte, que é o que qualquer pessoa espera de "mudei o preço
// do meu serviço".

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import type Stripe from "https://esm.sh/stripe@18.5.0";
import {
  serviceClient,
  stripeClient,
  getConnectedStripeContext,
} from "../_shared/stripe-connect.ts";
import { stripeGrossUnitAmount, type TaxConfigLike } from "../_shared/fiscal-pricing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const log = (step: string, details?: Record<string, unknown>) => {
  console.log(`[STRIPE-PRODUCT-SYNC] ${step}${details ? ` - ${JSON.stringify(details)}` : ""}`);
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type SyncAction = "enable" | "sync" | "disable";

interface ProductRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  price: number | null;
  is_active: boolean;
  is_recurring: boolean;
  tax_value: number | null;
  price_includes_vat: boolean;
}

interface MappingRow {
  id: string;
  stripe_product_id: string;
  stripe_price_id: string;
  unit_amount: number;
  interval: string;
  active: boolean;
  synced_at: string | null;
  sync_error: string | null;
}

function summary(mapping: MappingRow | null, status: string) {
  return {
    status,
    stripeProductId: mapping?.stripe_product_id ?? null,
    stripePriceId: mapping?.stripe_price_id ?? null,
    syncedAt: mapping?.synced_at ?? null,
    syncError: mapping?.sync_error ?? null,
  };
}

const TERMINAL_SUBSCRIPTION_STATUSES = new Set(["canceled", "incomplete_expired"]);

async function findSubscriptionItemForPrice(
  stripe: Stripe,
  subscription: Stripe.Subscription,
  priceId: string,
  options: Stripe.RequestOptions,
): Promise<Stripe.SubscriptionItem | null> {
  const embedded = subscription.items.data.find(
    (item: Stripe.SubscriptionItem) => item.price.id === priceId,
  );
  if (embedded) return embedded;

  let startingAfter: string | undefined;
  do {
    const page = await stripe.subscriptionItems.list(
      {
        subscription: subscription.id,
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      options,
    );
    const matching = page.data.find(
      (item: Stripe.SubscriptionItem) => item.price.id === priceId,
    );
    if (matching) return matching;
    startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (startingAfter);

  return null;
}

/** Move every non-terminal subscription item using an old Price. */
async function migrateSubscriptionsToPrice(
  stripe: Stripe,
  oldPriceId: string,
  newPriceId: string,
  options: Stripe.RequestOptions,
): Promise<number> {
  let startingAfter: string | undefined;
  let migrated = 0;

  do {
    const page = await stripe.subscriptions.list(
      {
        price: oldPriceId,
        status: "all",
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      options,
    );

    for (const subscription of page.data) {
      if (TERMINAL_SUBSCRIPTION_STATUSES.has(subscription.status)) continue;
      const item = await findSubscriptionItemForPrice(stripe, subscription, oldPriceId, options);
      if (!item) {
        throw new Error(`Subscrição ${subscription.id} não contém o preço ${oldPriceId}`);
      }
      await stripe.subscriptions.update(
        subscription.id,
        { items: [{ id: item.id, price: newPriceId }], proration_behavior: "none" },
        options,
      );
      migrated += 1;
    }

    startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (startingAfter);

  return migrated;
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

    const body = (await req.json()) as { action?: SyncAction; productId?: string };
    const action = body.action ?? "sync";
    const productId = body.productId ?? "";
    if (!productId) return json({ error: "productId em falta" }, 400);

    // O produto traz consigo a organização — não aceitamos organization_id do
    // pedido. Assim é impossível pedir a sincronização de um produto de outra
    // organização passando um id que não é nosso.
    const { data: product } = await supabase
      .from("products")
      .select("id, organization_id, name, description, price, is_active, is_recurring, tax_value, price_includes_vat")
      .eq("id", productId)
      .maybeSingle<ProductRow>();
    if (!product) return json({ error: "Produto não encontrado" }, 404);

    const { data: isAdmin } = await supabase.rpc("is_org_admin", {
      _user_id: user.id,
      _org_id: product.organization_id,
    });
    if (isAdmin !== true) return json({ error: "Apenas administradores" }, 403);

    const { data: existing } = await supabase
      .from("stripe_product_mappings")
      .select("id, stripe_product_id, stripe_price_id, unit_amount, interval, active, synced_at, sync_error")
      .eq("organization_id", product.organization_id)
      .eq("product_id", product.id)
      .maybeSingle<MappingRow>();

    if (action === "disable") {
      if (!existing) return json({ mapping: summary(null, "not_synced") });
      // Não apagamos o Product/Price no Stripe: subscrições vivas continuam a
      // referenciá-los, e removê-los partia cobranças em curso.
      await supabase
        .from("stripe_product_mappings")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      return json({ mapping: summary({ ...existing, active: false }, "disabled") });
    }

    const connection = await getConnectedStripeContext(supabase, product.organization_id);
    if (!connection) {
      return json({ error: "Nenhuma conta Stripe ligada a esta organização" }, 409);
    }

    if (!product.is_recurring) return json({ error: "O produto não é recorrente" }, 422);
    if (!product.is_active) return json({ error: "O produto está inactivo" }, 422);
    if (!product.price || product.price <= 0) {
      return json({ error: "O produto precisa de um preço positivo" }, 422);
    }

    const { data: organization, error: organizationError } = await supabase
      .from("organizations")
      .select("tax_config")
      .eq("id", product.organization_id)
      .maybeSingle<{ tax_config: TaxConfigLike | null }>();
    if (organizationError || !organization) {
      return json({ error: "Não foi possível obter a configuração fiscal da organização" }, 500);
    }

    const { unitAmount, effectiveTaxRate } = stripeGrossUnitAmount({
      price: product.price,
      priceIncludesVat: product.price_includes_vat,
      productTaxValue: product.tax_value,
      organizationTaxConfig: organization.tax_config,
    });
    const stripe = stripeClient();
    const onAccount = { stripeAccount: connection.stripeAccountId };

    try {
      let stripeProductId = existing?.stripe_product_id ?? null;

      if (stripeProductId) {
        await stripe.products.update(
          stripeProductId,
          {
            name: product.name,
            description: product.description ?? undefined,
            metadata: {
              senvia_organization_id: product.organization_id,
              senvia_product_id: product.id,
              senvia_effective_tax_rate: String(effectiveTaxRate),
              senvia_price_includes_vat: String(product.price_includes_vat),
            },
          },
          onAccount,
        );
      } else {
        // A idempotency key impede que dois cliques criem dois Products. O Stripe
        // devolve o mesmo objecto para a mesma chave em vez de criar outro.
        const created = await stripe.products.create(
          {
            name: product.name,
            description: product.description ?? undefined,
            metadata: {
              senvia_organization_id: product.organization_id,
              senvia_product_id: product.id,
              senvia_effective_tax_rate: String(effectiveTaxRate),
              senvia_price_includes_vat: String(product.price_includes_vat),
            },
          },
          { ...onAccount, idempotencyKey: `product:${product.organization_id}:${product.id}` },
        );
        stripeProductId = created.id;
      }

      // Price novo apenas quando o valor muda. Só o nome mudar não toca no preço.
      let priceId = existing?.stripe_price_id ?? null;
      const amountChanged = !existing || existing.unit_amount !== unitAmount;

      // O intervalo vem do mapeamento existente, não é assumido mensal. Um
      // produto anual (Senvia OS Elite Anual, 1152€/ano) cujo preço mudasse
      // ganhava um preço MENSAL de 1152€ e as subscrições vivas eram migradas
      // para ele — o cliente passava a pagar doze vezes mais, todos os meses.
      const interval: "month" | "year" = existing?.interval === "year" ? "year" : "month";

      if (amountChanged) {
        const price: Stripe.Price = await stripe.prices.create(
          {
            product: stripeProductId,
            currency: "eur",
            unit_amount: unitAmount,
            recurring: { interval, interval_count: 1 },
            metadata: {
              senvia_organization_id: product.organization_id,
              senvia_product_id: product.id,
              senvia_effective_tax_rate: String(effectiveTaxRate),
              senvia_price_includes_vat: String(product.price_includes_vat),
            },
          },
          {
            ...onAccount,
            idempotencyKey: `price:${product.organization_id}:${product.id}:${unitAmount}`,
          },
        );

        // Migrar as subscrições vivas para o preço novo, sem acerto retroactivo.
        if (priceId && priceId !== price.id) {
          const migrated = await migrateSubscriptionsToPrice(stripe, priceId, price.id, onAccount);
          if (migrated > 0) {
            log("subscrições migradas", { count: migrated, priceId: price.id });
          }
        }
        priceId = price.id;
      }

      // Só confirmamos o mapeamento depois de todas as chamadas essenciais
      // terem passado. Gravar antes deixaria a base de dados a afirmar um estado
      // que o Stripe não tem.
      const { data: saved } = await supabase
        .from("stripe_product_mappings")
        .upsert(
          {
            organization_id: product.organization_id,
            product_id: product.id,
            stripe_connection_id: connection.connectionId,
            stripe_product_id: stripeProductId,
            stripe_price_id: priceId,
            currency: "EUR",
            unit_amount: unitAmount,
            // Preserva o intervalo real: gravar "month" num mapeamento anual
            // fazia a sincronização seguinte criar mesmo um preço mensal.
            interval,
            interval_count: 1,
            active: true,
            synced_at: new Date().toISOString(),
            sync_error: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id,product_id" },
        )
        .select("id, stripe_product_id, stripe_price_id, unit_amount, interval, active, synced_at, sync_error")
        .maybeSingle<MappingRow>();

      log("sincronizado", { productId: product.id, priceId, amountChanged, unitAmount, effectiveTaxRate });
      return json({ mapping: summary(saved ?? null, "synced") });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido no Stripe";
      log("falha", { productId: product.id, message });
      // Regista o erro para a UI o poder mostrar e permitir repetir.
      if (existing) {
        await supabase
          .from("stripe_product_mappings")
          .update({ sync_error: message, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      }
      return json({ error: message, mapping: summary(existing ?? null, "error") }, 502);
    }
  } catch (err) {
    log("erro", { message: err instanceof Error ? err.message : "desconhecido" });
    return json({ error: "Erro inesperado" }, 500);
  }
});
