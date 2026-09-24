import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { selectVendusApiRegister, VendusError } from './vendus.ts'

Deno.test('Vendus rejects a normal POS register for API issuance', () => {
  const error = assertThrows(() => selectVendusApiRegister([
    { id: 101, type: 'pos', mode: 'normal', situation: 'on' },
  ]))
  assertEquals(error instanceof VendusError && error.code, 'api_register_missing')
})

Deno.test('Vendus requires normal mode on the API register', () => {
  const error = assertThrows(() => selectVendusApiRegister([
    { id: 102, type: 'api', mode: 'tests', situation: 'on' },
  ]))
  assertEquals(error instanceof VendusError && error.code, 'api_register_test_mode')
})

Deno.test('Vendus chooses the single active normal API register', () => {
  assertEquals(selectVendusApiRegister([
    { id: 101, type: 'pos', mode: 'normal', situation: 'on' },
    { id: 102, type: 'api', mode: 'normal', situation: 'on' },
  ]), 102)
})
