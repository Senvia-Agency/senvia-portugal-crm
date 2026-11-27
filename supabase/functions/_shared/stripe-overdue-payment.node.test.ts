import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findPendingStripePayment,
  OVERDUE_NOTE_PREFIX,
  recordOverdueStripeInvoice,
  settlePendingStripePayment,
} from './stripe-overdue-payment.ts';

type Row = Record<string, any>;

/** Minimal sale_payments table: eq/neq filters, insert with the unique invoice index, update. */
function fakeDb(initial: Row[] = []) {
  const rows: Row[] = initial.map((r) => ({ ...r }));
  let nextId = rows.length + 1;
  const from = (_table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: Row | null = null;
    const run = () => {
      if (op === 'insert') {
        if (payload!.stripe_invoice_id && rows.some((r) => r.stripe_invoice_id === payload!.stripe_invoice_id)) {
          return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        rows.push({ id: `p${nextId++}`, ...payload });
        return { data: null, error: null };
      }
      const matched = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') {
        matched.forEach((r) => Object.assign(r, payload));
        return { data: matched.map((r) => ({ id: r.id })), error: null };
      }
      return { data: matched.map((r) => ({ id: r.id })), error: null };
    };
    const chain: any = {
      select: () => chain,
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return chain; },
      limit: () => chain,
      insert: (p: Row) => { op = 'insert'; payload = p; return chain; },
      update: (p: Row) => { op = 'update'; payload = p; return chain; },
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return chain;
  };
  return { db: { from }, rows };
}

const AGENCY = 'org-senvia';
const invoice = {
  id: 'in_escolha_nov',
  created: Date.UTC(2026, 10, 25, 9) / 1000,
  amount_due: 5400,
  amount_remaining: 5400,
  period_start: Date.UTC(2026, 10, 25) / 1000,
  period_end: Date.UTC(2026, 11, 25) / 1000,
};

test('a refused charge becomes a pending payment on the client sale', async () => {
  const { db, rows } = fakeDb();
  const result = await recordOverdueStripeInvoice(db, { agencyOrgId: AGENCY, saleId: 'sale-0009', invoice });
  assert.equal(result, 'created');
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { amount: rows[0].amount, status: rows[0].status, date: rows[0].payment_date, sale: rows[0].sale_id, inv: rows[0].stripe_invoice_id },
    { amount: 54, status: 'pending', date: '2026-11-25', sale: 'sale-0009', inv: 'in_escolha_nov' },
  );
  assert.equal(rows[0].billing_period_start, '2026-11-25');
  assert.equal(rows[0].billing_period_end, '2026-12-25');
  assert.ok(rows[0].notes.startsWith(OVERDUE_NOTE_PREFIX));
});

test('Stripe retries of the same invoice do not duplicate the row', async () => {
  const { db, rows } = fakeDb();
  await recordOverdueStripeInvoice(db, { agencyOrgId: AGENCY, saleId: 'sale-0009', invoice });
  const again = await recordOverdueStripeInvoice(db, { agencyOrgId: AGENCY, saleId: 'sale-0009', invoice });
  assert.equal(again, 'exists');
  assert.equal(rows.length, 1);
});

test('an invoice already paid is not turned back into a debt', async () => {
  const { db, rows } = fakeDb([{ id: 'p1', stripe_invoice_id: 'in_escolha_nov', status: 'paid', amount: 54 }]);
  const result = await recordOverdueStripeInvoice(db, { agencyOrgId: AGENCY, saleId: 'sale-0009', invoice });
  assert.equal(result, 'exists');
  assert.equal(rows[0].status, 'paid');
});

test('nothing is recorded without a sale or without an amount', async () => {
  const { db, rows } = fakeDb();
  assert.equal(await recordOverdueStripeInvoice(db, { agencyOrgId: AGENCY, saleId: null, invoice }), 'skipped');
  assert.equal(await recordOverdueStripeInvoice(db, { agencyOrgId: AGENCY, saleId: 'sale-0009', invoice: { ...invoice, amount_due: 0, amount_remaining: 0 } }), 'skipped');
  assert.equal(rows.length, 0);
});

test('paying the invoice settles the same row instead of adding a second one', async () => {
  const { db, rows } = fakeDb();
  await recordOverdueStripeInvoice(db, { agencyOrgId: AGENCY, saleId: 'sale-0009', invoice });
  const pendingId = await findPendingStripePayment(db, 'in_escolha_nov');
  assert.ok(pendingId);
  const settled = await settlePendingStripePayment(db, pendingId!, { amount: 54, payment_date: '2026-11-28', stripe_fee_amount: 1.2 });
  assert.equal(settled, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'paid');
  assert.equal(rows[0].payment_date, '2026-11-28');
  // A second settlement (webhook redelivery or the daily reconciler) changes nothing.
  assert.equal(await findPendingStripePayment(db, 'in_escolha_nov'), null);
  assert.equal(await settlePendingStripePayment(db, pendingId!, { amount: 99 }), false);
  assert.equal(rows[0].amount, 54);
});
