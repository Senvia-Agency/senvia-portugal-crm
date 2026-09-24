import { assertEquals, assertRejects, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { VendusError, vendusRequest } from './vendus.ts'

Deno.test('Vendus validation errors keep the provider code and scrub private details', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ errors: [{
    code: 'E123', message: 'Caixa inválida para 123456789 e cliente@example.pt',
  }] }), { status: 422, headers: { 'Content-Type': 'application/json' } })
  try {
    const error = await assertRejects(() => vendusRequest('test-key', '/documents/', { method: 'POST', body: '{}' }))
    assertEquals(error instanceof VendusError, true)
    if (error instanceof VendusError) {
      assertEquals(error.code, 'invalid_document')
      assertEquals(error.providerCode, 'E123')
      assertStringIncludes(error.message, 'Caixa inválida')
      assertEquals(error.message.includes('123456789'), false)
      assertEquals(error.message.includes('cliente@example.pt'), false)
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})
