// Webhook das contas ligadas (Stripe Connect).
//
// Separado do stripe-webhook antigo de propósito: aquele trata as subscrições do
// PRÓPRIO Senvia na nossa conta; este trata o dinheiro dos clientes das nossas
// organizações, em contas que não são nossas. Segredos de assinatura diferentes,
// contas diferentes, consequências diferentes.
//
// Regra que atravessa tudo: SERVIÇO e COBRANÇA são estados independentes. Um
// pagamento falhado põe a cobrança em atraso e nunca desliga o serviço — quem
// suspende um cliente é uma decisão de negócio tomada no CRM, não o efeito
// automático de um cartão recusado.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { serviceClient, stripeClient } from "../_shared/stripe-connect.ts";
import {
  billingStatusFromSubscription,
  invoiceMetadata,
  invoicePaymentIds,
  invoicePeriod,
  isHandledEvent,
  parseRecurringMetadata,
  settlementAmounts,
} from "../_shared/stripe-recurring.ts";

const log = (step: string, details?: Record<string, unknown>) => {
  console.log(`[STRIPE-CONNECTED-WEBHOOK] ${step}${details ? ` - ${JSON.stringify(details)}` : ""}`);
};

type Supabase = ReturnType<typeof serviceClient>;

interface Identity {
  organizationId: string;
  saleId: string;
  recurrenceId: string;
}

/**
 * Confirma que a identidade da metadata pertence mesmo à conta que enviou o
 * evento. Sem isto, uma organização podia gravar na metadata o id de outra e
 * escrever ciclos e pagamentos na venda alheia.
 */
async function identityMatchesAccount(
  supabase: Supabase,
  identity: Identity,
  account: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("stripe_connections")
    .select("organization_id")
    .eq("stripe_account_id", account)
    .maybeSingle<{ organization_id: string }>();
  return !!data && data.organization_id === identity.organizationId;
}

/** Cria (ou reaproveita) o ciclo desta fatura. Idempotente por stripe_invoice_id. */
async function materializeInvoiceCycle(
  supabase: Supabase,
  invoice: Stripe.Invoice,
  identity: Identity,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("sale_recurring_cycles")
    .select("id")
    .eq("stripe_invoice_id", invoice.id)
    .maybeSingle<{ id: string }>();
  if (existing) return existing.id;

  const period = invoicePeriod(invoice);
  const amount = settlementAmounts(invoice).gross;
  if (amount <= 0) return null;

  // A fatura pode chegar depois de o ciclo já ter sido criado manualmente para
  // o mesmo período: nesse caso adopta-se esse ciclo em vez de criar um segundo.
  const { data: sameperiod } = await supabase
    .from("sale_recurring_cycles")
    .select("id, stripe_invoice_id")
    .eq("recurrence_id", identity.recurrenceId)
    .eq("period_start", period.periodStart)
    .eq("period_end", period.periodEnd)
    .maybeSingle<{ id: string; stripe_invoice_id: string | null }>();

  if (sameperiod && !sameperiod.stripe_invoice_id) {
    await supabase
      .from("sale_recurring_cycles")
      .update({ stripe_invoice_id: invoice.id, stripe_invoice_status: invoice.status ?? null })
      .eq("id", sameperiod.id);
    return sameperiod.id;
  }
  if (sameperiod) return sameperiod.id;

  const { data: created, error } = await supabase
    .from("sale_recurring_cycles")
    .insert({
      recurrence_id: identity.recurrenceId,
      sale_id: identity.saleId,
      organization_id: identity.organizationId,
      period_start: period.periodStart,
      period_end: period.periodEnd,
      due_date: period.dueDate,
      amount,
      currency: "EUR",
      status: "pending",
      stripe_invoice_id: invoice.id,
      stripe_invoice_status: invoice.status ?? null,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    log("falha a criar ciclo", { invoice: invoice.id, message: error.message });
    return null;
  }
  return created?.id ?? null;
}

/** Marca o ciclo como pago e regista o pagamento pelo valor BRUTO. */
async function settleInvoiceCycle(
  supabase: Supabase,
  stripe: Stripe,
  invoice: Stripe.Invoice,
  identity: Identity,
  account: string,
): Promise<void> {
  const cycleId = await materializeInvoiceCycle(supabase, invoice, identity);
  if (!cycleId) return;

  // A taxa só existe na balance transaction; a fatura não a traz. A Basil
  // removeu invoice.charge, por isso o id vem de invoice.payments.
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
    if (typeof bt === "string") {
      bt = await stripe.balanceTransactions.retrieve(bt, { stripeAccount: account });
    }
    if (bt && typeof bt !== "string") balanceTransaction = { fee: bt.fee, net: bt.net };
  } catch (err) {
    log("balance transaction indisponível", {
      message: err instanceof Error ? err.message : "desconhecido",
    });
  }

  const { gross, fee, net } = settlementAmounts(invoice, balanceTransaction);
  const paidAt = new Date((invoice.status_transitions?.paid_at ?? invoice.created) * 1000).toISOString();

  await supabase
    .from("sale_recurring_cycles")
    .update({
      status: "paid",
      paid_at: paidAt,
      stripe_invoice_status: invoice.status ?? null,
      failure_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cycleId);

  // Um pagamento por ciclo: o índice único em recurring_cycle_id garante que uma
  // reentrega do mesmo evento não duplica dinheiro.
  const { data: already } = await supabase
    .from("sale_payments")
    .select("id")
    .eq("recurring_cycle_id", cycleId)
    .maybeSingle<{ id: string }>();

  if (!already) {
    const period = invoicePeriod(invoice);
    const { error } = await supabase.from("sale_payments").insert({
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
      notes: `Stripe ${invoice.id} · bruto ${gross.toFixed(2)}€, taxa ${fee.toFixed(2)}€`,
    });
    // 23505 = corrida com outra entrega do mesmo evento; já está registado.
    if (error && error.code !== "23505") {
      log("falha a registar pagamento", { cycleId, message: error.message });
    }
  } else if (chargeId || paymentIntentId) {
    // Older rows predate these identities. Backfilling them here lets a later
    // refund/dispute find the payment without guessing by amount or customer.
    const { error } = await supabase
      .from("sale_payments")
      .update({
        stripe_charge_id: chargeId,
        stripe_payment_intent_id: paymentIntentId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", already.id);
    if (error) log("falha a guardar identidade do pagamento Stripe", { cycleId, message: error.message });
  }

  // A cobrança volta a 'current' apenas se não houver outro ciclo por pagar.
  const { count } = await supabase
    .from("sale_recurring_cycles")
    .select("id", { count: "exact", head: true })
    .eq("recurrence_id", identity.recurrenceId)
    .in("status", ["pending", "failed"])
    .lt("due_date", new Date().toISOString().slice(0, 10));

  if ((count ?? 0) === 0) {
    await supabase
      .from("sale_recurrences")
      .update({ billing_status: "current", updated_at: new Date().toISOString() })
      .eq("id", identity.recurrenceId);
  }

  log("ciclo liquidado", { cycleId, gross, fee, net });
}

function objectId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

/**
 * Refunds and disputes do not reliably carry our subscription metadata. They
 * are therefore linked through the immutable Stripe charge/payment-intent ids
 * captured when the recurring payment was first recorded.
 */
async function handlePaymentReversal(
  supabase: Supabase,
  event: Stripe.Event,
  organizationId: string,
): Promise<void> {
  const object = event.data.object as unknown as Record<string, unknown>;
  let chargeId: string | null = null;
  let paymentIntentId: string | null = null;
  let reversalStatus: "none" | "refunded" | "chargeback" = "none";
  let reversedAmount = 0;
  let reversalReference = event.id;
  let reversedAt = new Date(event.created * 1000).toISOString();

  if (event.type === "charge.refunded") {
    chargeId = objectId(object.id);
    paymentIntentId = objectId(object.payment_intent);
    reversalStatus = "refunded";
    reversedAmount = Math.max(0, Number(object.amount_refunded ?? 0)) / 100;
    const refunds = object.refunds as { data?: Array<{ id?: string; created?: number }> } | undefined;
    const latest = refunds?.data?.[0];
    reversalReference = latest?.id ?? chargeId ?? event.id;
    if (latest?.created) reversedAt = new Date(latest.created * 1000).toISOString();
  } else {
    chargeId = objectId(object.charge);
    paymentIntentId = objectId(object.payment_intent);
    const disputeStatus = typeof object.status === "string" ? object.status : "";
    reversalReference = objectId(object.id) ?? event.id;
    reversedAmount = Math.max(0, Number(object.amount ?? 0)) / 100;

    // Winning a dispute restores the funds and clears the fiscal review flag.
    // Every other dispute state remains a review item; a bank dispute does not
    // itself prove that the underlying sale should be fiscally cancelled.
    reversalStatus = event.type === "charge.dispute.closed" && disputeStatus === "won"
      ? "none"
      : "chargeback";
    if (reversalStatus === "none") reversedAmount = 0;
  }

  let query = supabase
    .from("sale_payments")
    .select("id")
    .eq("organization_id", organizationId);
  if (chargeId) query = query.eq("stripe_charge_id", chargeId);
  else if (paymentIntentId) query = query.eq("stripe_payment_intent_id", paymentIntentId);
  else {
    log("reversão sem identidade Stripe — revisão necessária", { event: event.id, type: event.type });
    return;
  }

  const { data: payment, error: findError } = await query.maybeSingle<{ id: string }>();
  if (findError) throw findError;
  if (!payment) {
    log("reversão sem pagamento local — reconciliação necessária", {
      event: event.id,
      type: event.type,
      chargeId,
      paymentIntentId,
    });
    return;
  }

  const { error: updateError } = await supabase
    .from("sale_payments")
    .update({
      reversal_status: reversalStatus,
      reversed_amount: reversedAmount,
      reversal_reference: reversalReference,
      reversed_at: reversalStatus === "none" ? null : reversedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payment.id)
    .eq("organization_id", organizationId);
  if (updateError) throw updateError;

  log("reversão de pagamento registada", {
    paymentId: payment.id,
    type: event.type,
    reversalStatus,
    reversedAmount,
  });
}

async function handleEvent(
  supabase: Supabase,
  stripe: Stripe,
  event: Stripe.Event,
  account: string,
  identity: Identity,
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      await supabase
        .from("sale_recurrences")
        .update({
          stripe_subscription_id: subscriptionId ?? null,
          stripe_customer_id:
            typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
          service_status: "active",
          billing_status: "current",
          updated_at: new Date().toISOString(),
        })
        .eq("id", identity.recurrenceId);
      return;
    }

    case "invoice.created":
    case "invoice.finalized": {
      await materializeInvoiceCycle(supabase, event.data.object as Stripe.Invoice, identity);
      return;
    }

    case "invoice.paid":
    case "invoice.payment_succeeded": {
      await settleInvoiceCycle(supabase, stripe, event.data.object as Stripe.Invoice, identity, account);
      return;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const cycleId = await materializeInvoiceCycle(supabase, invoice, identity);
      if (cycleId) {
        await supabase
          .from("sale_recurring_cycles")
          .update({
            status: "failed",
            failure_reason: "Pagamento recusado pelo Stripe",
            updated_at: new Date().toISOString(),
          })
          .eq("id", cycleId);
      }
      // Apenas cobrança. O serviço NÃO é tocado.
      await supabase
        .from("sale_recurrences")
        .update({ billing_status: "past_due", updated_at: new Date().toISOString() })
        .eq("id", identity.recurrenceId);
      return;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const billing = billingStatusFromSubscription(subscription.status);
      if (billing) {
        await supabase
          .from("sale_recurrences")
          .update({ billing_status: billing, updated_at: new Date().toISOString() })
          .eq("id", identity.recurrenceId);
      }
      return;
    }

    case "customer.subscription.deleted": {
      // Estado terminal confirmado pelo Stripe: aqui sim o serviço termina.
      await supabase
        .from("sale_recurrences")
        .update({
          service_status: "cancelled",
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", identity.recurrenceId);
      return;
    }
  }
}

serve(async (req) => {
  const secret = Deno.env.get("STRIPE_CONNECT_WEBHOOK_SECRET");
  if (!secret) {
    log("STRIPE_CONNECT_WEBHOOK_SECRET em falta — a recusar");
    return new Response("not configured", { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("missing signature", { status: 400 });

  // Corpo BRUTO: qualquer reserialização invalida a assinatura.
  const raw = await req.text();
  const stripe = stripeClient();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, secret);
  } catch (err) {
    log("assinatura inválida", { message: err instanceof Error ? err.message : "desconhecido" });
    return new Response("invalid signature", { status: 400 });
  }

  const account = event.account;
  if (!account) return new Response("ok", { status: 200 });

  const supabase = serviceClient();
  const isReversalEvent = [
    "charge.refunded",
    "charge.dispute.created",
    "charge.dispute.closed",
  ].includes(event.type);

  if (isReversalEvent) {
    const { data: connection, error: connectionError } = await supabase
      .from("stripe_connections")
      .select("organization_id")
      .eq("stripe_account_id", account)
      .maybeSingle<{ organization_id: string }>();
    if (connectionError) {
      log("falha a resolver conta da reversão", { event: event.id, message: connectionError.message });
      return new Response("processing error", { status: 500 });
    }
    if (!connection) return new Response("ok", { status: 200 });

    const { error: ledgerError } = await supabase.from("stripe_events").insert({
      stripe_event_id: event.id,
      stripe_account_id: account,
      organization_id: connection.organization_id,
      event_type: event.type,
      livemode: event.livemode,
      status: "processing",
    });
    if (ledgerError?.code === "23505") return new Response("ok", { status: 200 });
    if (ledgerError) return new Response("ledger error", { status: 500 });

    try {
      await handlePaymentReversal(supabase, event, connection.organization_id);
      await supabase
        .from("stripe_events")
        .update({ status: "processed", processed_at: new Date().toISOString() })
        .eq("stripe_event_id", event.id);
      return new Response("ok", { status: 200 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "desconhecido";
      console.error("stripe_reversal_processing_failed", { event: event.id, type: event.type, message });
      await supabase
        .from("stripe_events")
        .update({ status: "failed", last_error: message })
        .eq("stripe_event_id", event.id);
      return new Response("processing error", { status: 500 });
    }
  }

  // Faturas guardam a nossa metadata na subscrição, não em si próprias — ler
  // `object.metadata` numa fatura devolve sempre vazio e descartava o
  // pagamento. Sessões e subscrições trazem-na directamente.
  const object = event.data.object as Record<string, unknown>;
  const rawMetadata = event.type.startsWith("invoice.")
    ? invoiceMetadata(object)
    : (object.metadata as Record<string, string> | undefined);
  const parsed = parseRecurringMetadata(rawMetadata);

  if (!parsed.ok || !isHandledEvent(event.type)) {
    // Devolve 200: não é um erro nosso, e um não-2xx faria o Stripe repetir
    // indefinidamente um evento que nunca vamos tratar.
    return new Response("ok", { status: 200 });
  }

  const identity = parsed.value;
  if (!(await identityMatchesAccount(supabase, identity, account))) {
    log("metadata de outra organização — recusado", { account });
    return new Response("ok", { status: 200 });
  }

  // Livro de eventos: a chave única (stripe_event_id) é o que impede uma
  // reentrega de processar o mesmo dinheiro duas vezes.
  const { error: ledgerError } = await supabase.from("stripe_events").insert({
    stripe_event_id: event.id,
    stripe_account_id: account,
    organization_id: identity.organizationId,
    event_type: event.type,
    livemode: event.livemode,
    status: "processing",
  });
  if (ledgerError) {
    if (ledgerError.code === "23505") {
      log("evento repetido — ignorado", { event: event.id });
      return new Response("ok", { status: 200 });
    }
    log("falha no livro de eventos", { message: ledgerError.message });
    return new Response("ledger error", { status: 500 });
  }

  try {
    await handleEvent(supabase, stripe, event, account, identity);
    await supabase
      .from("stripe_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("stripe_event_id", event.id);
    return new Response("ok", { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "desconhecido";
    log("falha a processar", { event: event.id, message });
    await supabase
      .from("stripe_events")
      .update({ status: "failed", last_error: message })
      .eq("stripe_event_id", event.id);
    // 500 para o Stripe repetir: é uma falha nossa, e o evento traz dinheiro.
    return new Response("processing error", { status: 500 });
  }
});
