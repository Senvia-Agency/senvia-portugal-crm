import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { selectNormalVendusRegister, VendusError } from './vendus.ts'

Deno.test('a single training register can be used with an explicit normal document mode', () => {
  assertEquals(selectNormalVendusRegister([
    { id: 1, type: 'pos', mode: 'tests', situation: 'on' },
  ]), 1)
})

Deno.test('an active normal API register wins over a POS register', () => {
  assertEquals(selectNormalVendusRegister([
    { id: 1, type: 'pos', mode: 'normal', situation: 'on' },
    { id: 2, type: 'api', mode: 'normal', situation: 'on' },
  ]), 2)
})

Deno.test('multiple normal registers without a unique API register are ambiguous', () => {
  const error = assertThrows(() => selectNormalVendusRegister([
    { id: 1, type: 'pos', mode: 'normal', situation: 'on' },
    { id: 2, type: 'pos', mode: 'normal', situation: 'on' },
  ]))
  assertEquals(error instanceof VendusError, true)
  if (error instanceof VendusError) assertEquals(error.code, 'ambiguous_register')
})
