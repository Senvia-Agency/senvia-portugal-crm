// Recupera pagamentos Stripe que nunca chegaram por webhook.
//
// Webhooks perdem-se: o endpoint esteve em baixo, o segredo foi rodado, a função
// devolveu 500 e o Stripe desistiu ao fim das tentativas, ou o endpoint só foi
// criado depois de já haver subscrições a correr. Quando isso acontece o dinheiro
// entrou na conta do cliente e o CRM nunca soube — a venda fica eternamente por
// liquidar e ninguém repara.
//
// Já aconteceu neste projecto: o reconcile-stripe-payments existe exactamente
// porque o webhook das subscrições do Senvia deixou de registar pagamentos
// durante meses. Esta função é o mesmo remédio, para as contas ligadas.
//
// Percorre as facturas pagas de cada conta ligada e materializa as que faltam,
// reutilizando o mesmo caminho do webhook: mesma competência, mesmo valor bruto,
// mesma idempotência. Correr duas vezes não duplica nada.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.2";
import { stripeClient, modeFromSecretKey } from "../_shared/stripe-connect.ts";
import {
  invoiceMetadata,
  invoicePaymentIds,
  invoicePeriod,
  parseRecurringMetadata,
  settlementAmounts,
} from "../_shared/stripe-recurring.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const log = (step: string, details?: Record<string, unknown>) => {
  console.log(`[RECONCILE-CONNECTED-STRIPE] ${step}${details ? ` - ${JSON.stringify(details)}` : ""}`);
};

async function isAuthorized(req: Request, supabase: SupabaseClient): Promise<boolean> {
  const provided = req.headers.get("x-cron-secret") || new URL(req.url).searchParams.get("key");
  if (!provided) return false;

  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && provided === cronSecret) return true;

  const { data, error } = await supabase.rpc("verify_stripe_cron_secret", { p_secret: provided });
  if (error) {
    log("verificação de autorização falhou", { message: error.message });
    return false;
  }
  return data === true;
}

interface Connection {
  organization_id: string;
  stripe_account_id: string;
}

interface Recovered {
  organizationId: string;
  invoiceId: string;
  gross: number;
}

async function recoverInvoice(
  supabase: SupabaseClient,
  stripe: Stripe,
  invoice: Stripe.Invoice,
  account: string,
  organizationId: string,
): Promise<Recovered | null> {
  // A nossa metadata vive na subscricao; a Basil moveu-a para invoice.parent.
  const parsed = parseRecurringMetadata(invoiceMetadata(invoice as unknown as Record<string, unknown>));
  // Sem a nossa metadata não há forma segura de saber a que venda pertence, e
  // adivinhar é como o dinheiro vai parar ao cliente errado. Fica de fora.
  if (!parsed.ok) return null;
  const identity = parsed.value;
  if (identity.organizationId !== organizationId) return null;

  // Já registada? O índice único garante-o, mas verificar evita chamadas à API.
  const { data: existingCycle } = await supabase
    .from("sale_recurring_cycles")
    .select("id, status")
    .eq("stripe_invoice_id", invoice.id)
    .maybeSingle<{ id: string; status: string }>();
  if (existingCycle?.status === "paid") {
    const ids = invoicePaymentIds(invoice as unknown as Record<string, unknown>);
    if (ids.chargeId || ids.paymentIntentId) {
      await supabase
        .from("sale_payments")
        .update({
          stripe_charge_id: ids.chargeId,
          stripe_payment_intent_id: ids.paymentIntentId,
          updated_at: new Date().toISOString(),
        })
        .eq("recurring_cycle_id", existingCycle.id);
    }
    return null;
  }

  const period = invoicePeriod(invoice);

  let cycleId = existingCycle?.id ?? null;
  if (!cycleId) {
    const { data: created, error } = await supabase
      .from("sale_recurring_cycles")
      .insert({
        recurrence_id: identity.recurrenceId,
        sale_id: identity.saleId,
        organization_id: identity.organizationId,
        period_start: period.periodStart,
        period_end: period.periodEnd,
        due_date: period.dueDate,
        amount: settlementAmounts(invoice).gross,
        currency: "EUR",
        status: "pending",
        stripe_invoice_id: invoice.id,
        stripe_invoice_status: invoice.status ?? null,
      })
      .select("id")
      .maybeSingle<{ id: string }>();
    if (error) {
      if (error.code !== "23505") log("falha a criar ciclo", { invoice: invoice.id, message: error.message });
      return null;
    }
    cycleId = created?.id ?? null;
  }
  if (!cycleId) return null;

  // A Basil removeu invoice.charge: o id vem de invoice.payments.
  let balanceTransaction: { fee?: number | null; net?: number | null } | null = null;
  const { chargeId, paymentIntentId } = invoicePaymentIds(invoice as unknown as Record<string, unknown>);
  try {
    let charge: Stripe.Charge | null = null;
    if (chargeId) {
      charge = await stripe.charges.retrieve(chargeId, { expand: ["balance_transaction"] }, { stripeAccount: account });
    } else if (paymentIntentId) {
      const intent = await stripe.paymentIntents.retrieve(
        paymentIntentId,
        { expand: ["latest_charge.balance_transaction"] },
        { stripeAccount: account },
      );
      const latest = intent.latest_charge;
      charge = latest && typeof latest !== "string" ? latest : null;
    }
    let bt = charge?.balance_transaction ?? null;
    if (typeof bt === "string") bt = await stripe.balanceTransactions.retrieve(bt, { stripeAccount: account });
    if (bt && typeof bt !== "string") balanceTransaction = { fee: bt.fee, net: bt.net };
  } catch {
    // Sem a balance transaction o líquido deduz-se do bruto. O que liquida a
    // dívida é o bruto, por isso a recuperação não fica bloqueada por isto.
  }

  const { gross, fee, net } = settlementAmounts(invoice, balanceTransaction);
  const paidAt = new Date(
    (invoice.status_transitions?.paid_at ?? invoice.created) * 1000,
  ).toISOString();

  await supabase
    .from("sale_recurring_cycles")
    .update({
      status: "paid",
      paid_at: paidAt,
      stripe_invoice_status: invoice.status ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cycleId);

  const { error: paymentError } = await supabase.from("sale_payments").insert({
    organization_id: identity.organizationId,
    sale_id: identity.saleId,
    recurring_cycle_id: cycleId,
    amount: gross,
    payment_date: paidAt.slice(0, 10),
    status: "paid",
    payment_method: "card",
    stripe_invoice_id: invoice.id,
    stripe_charge_id: chargeId,
    stripe_payment_intent_id: paymentIntentId,
    stripe_gross_amount: gross,
    stripe_fee_amount: fee,
    stripe_net_amount: net,
    billing_period_start: period.periodStart,
    billing_period_end: period.periodEnd,
    notes: `Stripe ${invoice.id} · recuperado por reconciliação · bruto ${gross.toFixed(2)}€`,
  });
  if (paymentError && paymentError.code !== "23505") {
    log("falha a registar pagamento", { cycleId, message: paymentError.message });
    return null;
  }

  return { organizationId: identity.organizationId, invoiceId: invoice.id, gross };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  if (!(await isAuthorized(req, supabase))) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days") ?? "7")));
  const since = Math.floor((Date.now() - days * 86_400_000) / 1000);

  const { data: connections } = await supabase
    .from("stripe_connections")
    .select("organization_id, stripe_account_id")
    .in("status", ["active", "restricted"])
    .eq("mode", modeFromSecretKey());

  const stripe = stripeClient();
  const recovered: Recovered[] = [];
  const failures: Array<{ account: string; message: string }> = [];

  for (const connection of (connections ?? []) as Connection[]) {
    try {
      const invoices = await stripe.invoices.list(
        { status: "paid", created: { gte: since }, limit: 100 },
        { stripeAccount: connection.stripe_account_id },
      );
      for (const invoice of invoices.data) {
        const result = await recoverInvoice(
          supabase,
          stripe,
          invoice,
          connection.stripe_account_id,
          connection.organization_id,
        );
        if (result) recovered.push(result);
      }
    } catch (err) {
      // Uma conta com problemas não pode impedir a reconciliação das restantes.
      failures.push({
        account: connection.stripe_account_id,
        message: err instanceof Error ? err.message : "desconhecido",
      });
    }
  }

  log("concluído", { contas: connections?.length ?? 0, recuperados: recovered.length });

  return new Response(
    JSON.stringify({
      accounts: connections?.length ?? 0,
      days,
      recovered: recovered.length,
      totalGross: recovered.reduce((sum, r) => sum + r.gross, 0),
      failures,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
