import { assertEquals, assertRejects } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { buildFiscalBrevoPayload, sendFiscalPdfWithBrevo } from "./fiscal-email.ts";

const config = {
  to: "Cliente@Example.com",
  toName: "Cliente",
  cc: ["contabilidade@example.com", "contabilidade@example.com"],
  bcc: [],
  senderEmail: "faturas@senvia.pt",
  senderName: "Senvia",
  replyTo: "apoio@senvia.pt",
  subject: "A sua fatura",
  html: "<p>Segue o documento.</p>",
  pdfName: "FT 2026/10.pdf",
  idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
};

Deno.test("payload fiscal normaliza destinatários e anexa um PDF", () => {
  const payload = buildFiscalBrevoPayload(config, new Uint8Array([37, 80, 68, 70]));
  assertEquals(payload.to, [{ email: "cliente@example.com", name: "Cliente" }]);
  assertEquals(payload.cc, [{ email: "contabilidade@example.com" }]);
  assertEquals(payload.attachment, [{ content: "JVBERg==", name: "FT-2026-10.pdf" }]);
  assertEquals(payload.headers, {
    "X-SENVIA-Category": "fiscal-document",
    idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
  });
});

Deno.test("email inválido é recusado antes da chamada externa", async () => {
  let called = false;
  await assertRejects(
    () => sendFiscalPdfWithBrevo("key", { ...config, to: "inválido" }, new Uint8Array([1]), async () => {
      called = true;
      return new Response('{}');
    }),
  );
  assertEquals(called, false);
});

Deno.test("identificador Brevo é devolvido ao ledger", async () => {
  const result = await sendFiscalPdfWithBrevo(
    "key",
    config,
    new Uint8Array([1, 2, 3]),
    async (_url, request) => {
      assertEquals((request?.headers as Record<string, string>)["api-key"], "key");
      return new Response(JSON.stringify({ messageId: "<abc@brevo>" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  );
  assertEquals(result, { messageId: "<abc@brevo>" });
});

Deno.test("resposta duplicada da Brevo confirma o envio idempotente", async () => {
  const result = await sendFiscalPdfWithBrevo(
    "key",
    config,
    new Uint8Array([1, 2, 3]),
    async () => new Response(JSON.stringify({
      code: "duplicate_parameter",
      message: "idempotencyKey already used",
    }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }),
  );
  assertEquals(result, {
    messageId: "brevo-idempotency:123e4567-e89b-42d3-a456-426614174000",
  });
});
