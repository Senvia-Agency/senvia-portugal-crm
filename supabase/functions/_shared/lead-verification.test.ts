import { createLeadVerificationSecrets, leadVerificationWhatsAppUrl, parseLeadVerificationCode } from './lead-verification.ts';

function assertEquals<T>(actual: T, expected: T): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

function assertNotEquals<T>(actual: T, expected: T): void {
  if (actual === expected) throw new Error(`Did not expect ${String(actual)}`);
}

Deno.test('confirmation message parser accepts only the exact verification format', () => {
  assertEquals(parseLeadVerificationCode('SENVIA CONFIRMAR 0123456789abcdef0123456789abcdef'), '0123456789abcdef0123456789abcdef');
  assertEquals(parseLeadVerificationCode('Olá, SENVIA CONFIRMAR 0123456789abcdef0123456789abcdef'), null);
  assertEquals(parseLeadVerificationCode('SENVIA CONFIRMAR 123'), null);
});

Deno.test('verification secrets are independent and WhatsApp codes are derived securely', async () => {
  const first = await createLeadVerificationSecrets('test-service-key');
  const second = await createLeadVerificationSecrets('test-service-key');
  assertNotEquals(first.emailToken, second.emailToken);
  assertNotEquals(first.whatsappCode, second.whatsappCode);
  assertNotEquals(first.whatsappCodeHash, second.whatsappCodeHash);
  assertEquals(first.whatsappCode.length, 32);
});

Deno.test('WhatsApp confirmation link targets the verified business number and encoded message', () => {
  const url = leadVerificationWhatsAppUrl('351939135114', '0123456789abcdef0123456789abcdef');
  assertEquals(url, 'https://wa.me/351939135114?text=SENVIA%20CONFIRMAR%200123456789abcdef0123456789abcdef');
  assertEquals(leadVerificationWhatsAppUrl('bad number', '0123456789abcdef0123456789abcdef'), null);
});
