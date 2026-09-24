import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  billingStatusFromSubscription,
  centsToAmount,
  invoiceMetadata,
  invoicePaymentIds,
  invoicePeriod,
  isHandledEvent,
  parseRecurringMetadata,
  settlementAmounts,
} from "./stripe-recurring.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const SALE = "22222222-2222-4222-8222-222222222222";
const REC = "33333333-3333-4333-8333-333333333333";

Deno.test("metadata completa e válida é aceite", () => {
  const result = parseRecurringMetadata({
    senvia_organization_id: ORG,
    senvia_sale_id: SALE,
    senvia_recurrence_id: REC,
  });
  assertEquals(result, { ok: true, value: { organizationId: ORG, saleId: SALE, recurrenceId: REC } });
});

Deno.test("evento sem metadata nossa é 'missing', não um palpite", () => {
  assertEquals(parseRecurringMetadata(null).ok, false);
  assertEquals(parseRecurringMetadata({}).ok, false);
});

Deno.test("metadata parcial é recusada em vez de completada", () => {
  const result = parseRecurringMetadata({ senvia_organization_id: ORG, senvia_sale_id: SALE });
  assertEquals(result, { ok: false, reason: "malformed" });
});

Deno.test("ids que não são UUID são recusados", () => {
  const result = parseRecurringMetadata({
    senvia_organization_id: "a-organizacao-do-joao",
    senvia_sale_id: SALE,
    senvia_recurrence_id: REC,
  });
  assertEquals(result, { ok: false, reason: "malformed" });
});

Deno.test("a metadata da fatura vem da subscrição, não da fatura", () => {
  // Este era o defeito que matava tudo em silêncio: a metadata é gravada na
  // SUBSCRIÇÃO, e invoice.metadata está vazia. Ler o sítio errado descartava
  // todos os pagamentos com um 200 a dizer que tinha corrido bem.
  const meta = invoiceMetadata({
    metadata: {},
    parent: { subscription_details: { metadata: { senvia_sale_id: SALE } } },
  });
  assertEquals(meta?.senvia_sale_id, SALE);
});

Deno.test("aceita o caminho antigo, anterior à Basil", () => {
  const meta = invoiceMetadata({ subscription_details: { metadata: { senvia_sale_id: SALE } } });
  assertEquals(meta?.senvia_sale_id, SALE);
});

Deno.test("faturas avulsas caem na metadata própria", () => {
  assertEquals(invoiceMetadata({ metadata: { senvia_sale_id: SALE } })?.senvia_sale_id, SALE);
});

Deno.test("o payment intent vem de invoice.payments na Basil", () => {
  // A Basil removeu invoice.charge; sem este caminho a taxa fica sempre a zero
  // e o líquido passa a ser igual ao bruto.
  const ids = invoicePaymentIds({ payments: { data: [{ payment: { payment_intent: "pi_123" } }] } });
  assertEquals(ids, { chargeId: null, paymentIntentId: "pi_123" });
});

Deno.test("ainda aceita o charge directo das versões antigas", () => {
  assertEquals(invoicePaymentIds({ charge: "ch_9" }).chargeId, "ch_9");
});

Deno.test("cêntimos convertem para euros", () => {
  assertEquals(centsToAmount(4990), 49.9);
  assertEquals(centsToAmount(0), 0);
  assertEquals(centsToAmount(null), 0);
});

Deno.test("a dívida é liquidada pelo BRUTO, não pelo líquido", () => {
  // 49,00 € cobrados; o Stripe fica com 1,33 €. O cliente pagou 49,00 € e é isso
  // que abate à dívida — a taxa é custo nosso, não desconto dele.
  const result = settlementAmounts({ amount_paid: 4900 }, { fee: 133, net: 4767 });
  assertEquals(result.gross, 49);
  assertEquals(result.fee, 1.33);
  assertEquals(result.net, 47.67);
});

Deno.test("sem balance transaction, o líquido deduz-se do bruto", () => {
  assertEquals(settlementAmounts({ amount_paid: 5400 }, null), { gross: 54, fee: 0, net: 54 });
});

Deno.test("o líquido nunca excede o bruto", () => {
  const result = settlementAmounts({ amount_paid: 1000 }, { fee: 0, net: 9999 });
  assertEquals(result.net, 10);
});

Deno.test("a competência vem da linha da fatura, não da emissão", () => {
  // Fatura emitida a 1 de julho para o período de junho: a receita pertence a
  // junho. Usar a data de emissão punha-a no mês errado.
  const period = invoicePeriod({
    created: Math.floor(Date.UTC(2026, 6, 1) / 1000),
    period_start: Math.floor(Date.UTC(2026, 6, 1) / 1000),
    period_end: Math.floor(Date.UTC(2026, 6, 1) / 1000),
    lines: {
      data: [
        {
          period: {
            start: Math.floor(Date.UTC(2026, 5, 1) / 1000),
            end: Math.floor(Date.UTC(2026, 5, 30) / 1000),
          },
        },
      ],
    },
  });
  assertEquals(period.periodStart, "2026-06-01");
  assertEquals(period.periodEnd, "2026-06-30");
});

Deno.test("o vencimento fica dentro do período, como a base de dados exige", () => {
  // Emitida antes do período começar: sem o ajuste, a constraint
  // due_date >= period_start rejeitava a linha e o evento ficava por processar.
  const period = invoicePeriod({
    created: Math.floor(Date.UTC(2026, 4, 20) / 1000),
    lines: {
      data: [
        {
          period: {
            start: Math.floor(Date.UTC(2026, 5, 1) / 1000),
            end: Math.floor(Date.UTC(2026, 5, 30) / 1000),
          },
        },
      ],
    },
  });
  assertEquals(period.dueDate, "2026-06-01");
  assertEquals(period.periodStart, "2026-06-01");
});

Deno.test("estado da subscrição traduz-se em cobrança, nunca em serviço", () => {
  assertEquals(billingStatusFromSubscription("active"), "current");
  assertEquals(billingStatusFromSubscription("trialing"), "current");
  assertEquals(billingStatusFromSubscription("past_due"), "past_due");
  assertEquals(billingStatusFromSubscription("unpaid"), "uncollectible");
  // 'canceled' não devolve estado de cobrança: cancelar é decisão de serviço.
  assertEquals(billingStatusFromSubscription("canceled"), null);
});

Deno.test("só os eventos conhecidos são tratados", () => {
  assertEquals(isHandledEvent("invoice.paid"), true);
  assertEquals(isHandledEvent("charge.refunded"), true);
  assertEquals(isHandledEvent("charge.dispute.created"), true);
  assertEquals(isHandledEvent("customer.subscription.deleted"), true);
  assertEquals(isHandledEvent("payout.paid"), false);
});
