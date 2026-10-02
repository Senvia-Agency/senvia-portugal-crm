import assert from 'node:assert/strict';
import test from 'node:test';

import { announceSaleCycles } from './sale-cycle-automations.ts';

const iso = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

/** A db that answers each table with fixed rows, whatever the filters. */
function fakeDb(tables: Record<string, unknown[]>) {
  const query = (rows: unknown[]) => {
    const chain: any = new Proxy({}, {
      get: (_t, prop) => (prop === 'then'
        ? (resolve: (v: unknown) => void) => resolve({ data: rows, error: null })
        : () => chain),
    });
    return chain;
  };
  return { from: (table: string) => query(tables[table] ?? []) };
}

// The 2026-10-02 case: monthly renewals that exist as a cycle AND as the
// pending payment generated for it, next to a real instalment.
const SALE_NUNO = 'sale-0014';
const SALE_JOAO = 'sale-0007';
const SALE_PARCELA = 'sale-0018';
const tables = {
  sale_recurrences: [],
  sale_recurring_cycles: [
    { id: 'cycle-nuno', sale_id: SALE_NUNO, organization_id: 'org', amount: 50, due_date: iso(0), period_start: iso(0), period_end: iso(30), recurrence: { service_status: 'active', billing_provider: 'manual' } },
    { id: 'cycle-joao', sale_id: SALE_JOAO, organization_id: 'org', amount: 75, due_date: iso(-1), period_start: iso(-1), period_end: iso(29), recurrence: { service_status: 'active', billing_provider: 'manual' } },
  ],
  sale_payments: [
    { id: 'pay-nuno', sale_id: SALE_NUNO, organization_id: 'org', amount: 50, payment_date: iso(0), status: 'pending', notes: 'Renovação mensal', recurring_cycle_id: 'cycle-nuno', sale: { status: 'active' } },
    { id: 'pay-joao', sale_id: SALE_JOAO, organization_id: 'org', amount: 75, payment_date: iso(-1), status: 'pending', notes: 'Renovação mensal', recurring_cycle_id: 'cycle-joao', sale: { status: 'active' } },
    // Same sale and date as a cycle, but not linked to it: still one charge.
    { id: 'pay-nuno-unlinked', sale_id: SALE_NUNO, organization_id: 'org', amount: 50, payment_date: iso(0), status: 'pending', notes: 'Renovação mensal', recurring_cycle_id: null, sale: { status: 'active' } },
    { id: 'pay-parcela', sale_id: SALE_PARCELA, organization_id: 'org', amount: 500, payment_date: iso(-3), status: 'pending', notes: 'Parcela 1/2', recurring_cycle_id: null, sale: { status: 'active' } },
  ],
  sales: [
    { id: SALE_NUNO, code: '0014', organization_id: 'org', client_id: 'c-nuno' },
    { id: SALE_JOAO, code: '0007', organization_id: 'org', client_id: 'c-joao' },
    { id: SALE_PARCELA, code: '0018', organization_id: 'org', client_id: 'c-nuno' },
  ],
  crm_clients: [
    { id: 'c-nuno', name: 'Nuno Dias', email: 'nuno@x.pt', phone: '+351931040317', company: null, assigned_to: null },
    { id: 'c-joao', name: 'João Basílio', email: 'joao@x.pt', phone: '+351967020258', company: null, assigned_to: null },
  ],
  profiles: [],
};

test('each charge is announced once: a cycle speaks for its payment, instalments still go', async () => {
  const sent: Array<{ trigger: string; id: string }> = [];
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    sent.push({ trigger: body.trigger_type, id: body.record.id });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const summary = await announceSaleCycles(fakeDb(tables), { supabaseUrl: 'https://x', serviceKey: 'k' });

  const ids = sent.map((s) => s.id).sort();
  assert.deepEqual(ids, ['cycle-joao', 'cycle-nuno', 'pay-parcela']);
  assert.equal(sent.filter((s) => s.id.includes('nuno')).length, 1, 'Nuno: one due-today reminder');
  assert.equal(sent.filter((s) => s.id.includes('joao')).length, 1, 'João: one overdue reminder');
  assert.equal(summary.due_today, 1);
  assert.equal(summary.overdue, 2);
});
