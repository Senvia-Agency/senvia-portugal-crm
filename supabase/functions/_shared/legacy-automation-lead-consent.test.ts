import assert from 'node:assert/strict';
import test from 'node:test';
import { isLeadTrigger, leadAutomationBlocked, leadIdForTrigger } from './legacy-automation-lead-consent.ts';

function fakeLookup(row: { automation_enabled?: boolean | null } | null, error: { message: string } | null = null) {
  const calls: string[] = [];
  const lookup = async (id: string) => { calls.push(id); return { data: row, error }; };
  return { lookup, calls };
}

test('only lead triggers resolve a lead id', () => {
  assert.equal(isLeadTrigger('lead_created'), true);
  assert.equal(isLeadTrigger('lead_status_changed'), true);
  assert.equal(isLeadTrigger('sale_created'), false);
  assert.equal(leadIdForTrigger('lead_created', { id: 'lead-1' }), 'lead-1');
  assert.equal(leadIdForTrigger('sale_created', { id: 'sale-1' }), null);
  assert.equal(leadIdForTrigger('lead_created', {}), null);
});

test('regressão 25/11: lead criada com a automação desligada não recebe o e-mail de boas-vindas', async () => {
  const { lookup, calls } = fakeLookup({ automation_enabled: true });
  assert.equal(await leadAutomationBlocked(lookup, 'lead-1', { id: 'lead-1', automation_enabled: false }), true);
  assert.deepEqual(calls, [], 'o registo do evento já basta, sem ir à base');
});

test('mudança de estado e envio da fila confirmam o valor atual da lead na base', async () => {
  const off = fakeLookup({ automation_enabled: false });
  assert.equal(await leadAutomationBlocked(off.lookup, 'lead-1', { id: 'lead-1', status: 'contacted' }), true);
  assert.deepEqual(off.calls, ['lead-1']);
  const on = fakeLookup({ automation_enabled: true });
  assert.equal(await leadAutomationBlocked(on.lookup, 'lead-1', { id: 'lead-1', automation_enabled: true }), false);
  const unset = fakeLookup({ automation_enabled: null });
  assert.equal(await leadAutomationBlocked(unset.lookup, 'lead-1'), false, 'null mantém o comportamento por omissão (ligada)');
  const missing = fakeLookup(null);
  assert.equal(await leadAutomationBlocked(missing.lookup, 'lead-1'), false, 'lead apagada não bloqueia vendas ou clientes antigos');
});

test('fila: item sem lead (vendas, clientes, itens antigos) segue sem consulta', async () => {
  const { lookup, calls } = fakeLookup(null);
  assert.equal(await leadAutomationBlocked(lookup, null), false);
  assert.deepEqual(calls, []);
});

test('falha fechada quando a base não responde', async () => {
  const { lookup } = fakeLookup(null, { message: 'timeout' });
  await assert.rejects(() => leadAutomationBlocked(lookup, 'lead-1'), /autorização de automações/);
});
