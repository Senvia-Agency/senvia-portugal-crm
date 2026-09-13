import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as referrals from '../functions/_shared/referrals.ts';
import * as context from '../functions/_shared/stripe-billing-context.ts';

// Execute the actual HTTP handler and routing. Only external transports/signature verification are substituted.
async function run(type, { replacement = false, email = null, invoiceStatus = 'paid', status = 'active', sessionStatus = 'complete' } = {}) {
  const writes = [];
  const sub = { id: 'sub_B', customer: 'cus_B', metadata: { organization_id: 'org_B' }, status,
    items: { data: [{ current_period_end: 1800000000, price: { product: 'prod_U0wAc7Tuy8w6gA', recurring: { interval: 'month', interval_count: 1 } } }] } };
  const invoice = { id: 'in_B', subscription: 'sub_B', customer: 'cus_B', status: invoiceStatus, amount_paid: 0, created: 1789000000, metadata: {} };
  const session = { id: 'cs_B', subscription: 'sub_B', customer: 'cus_B', mode: 'subscription', status: sessionStatus, customer_email: email };
  const event = { id: 'evt', type, data: { object: { id: 'old_event_object', customer_email: 'shared@example.invalid' } } };
  const binding = { organization_id: 'org_B', stripe_subscription_id: replacement ? 'sub_new' : 'sub_B' };
  const db = { from(table) {
    let write;
    const query = { select() { return this; }, eq(k, v) { if (write) write.filters.push([k, v]); return this; }, is() { return this; },
      update(value) { write = { table, value, filters: [] }; writes.push(write); return this; },
      async single() { return { data: { id: 'org_B', plan: 'starter', billing_exempt: false } }; },
      async maybeSingle() { return { data: table === 'organization_billing_accounts' ? binding : table === 'organization_referrals' ? null : { plan: 'starter', name: 'B' } }; },
      then(resolve) { return Promise.resolve({ data: null, error: null }).then(resolve); } };
    return query;
  }, async rpc(name) { assert.equal(name, 'sync_referral_billing'); return { data: !replacement }; } };
  const stripe = { webhooks: { constructEventAsync: async () => event },
    customers: { retrieve: async () => email ? { email } : { deleted: true } },
    subscriptions: { retrieve: async () => sub }, invoices: { retrieve: async () => invoice },
    checkout: { sessions: { retrieve: async () => session } } };
  let handler;
  const source = fs.readFileSync(new URL('../functions/stripe-webhook/index.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports: {}, console: { log() {}, error() {} }, Request, Response, Date, Set, Map,
    Deno: { env: { get: () => 'fixture-only' } },
    require(id) {
      if (id.includes('server.ts')) return { serve: fn => { handler = fn; } };
      if (id.includes('stripe@')) return { default: function () { return stripe; } };
      if (id.includes('supabase-js')) return { createClient: () => db };
      if (id.endsWith('/referrals.ts')) return referrals;
      if (id.endsWith('/stripe-billing-context.ts')) return context;
      if (id.endsWith('/security.ts')) return { rateLimit: () => ({ allowed: true }) };
      throw new Error(`Unexpected dependency ${id}`);
    },
  });
  const response = await handler(new Request('https://example.invalid', { method: 'POST', headers: { 'stripe-signature': 'fixture' }, body: '{}' }));
  assert.equal(response.status, 200);
  // Every real organization mutation must use the customer-bound tenant B.
  for (const write of writes.filter(w => w.table === 'organizations')) assert.ok(write.filters.some(([k, v]) => k === 'id' && v === 'org_B'));
  return writes;
}

test('actual webhook updates bound organization without an email or auth-user lookup', async () => {
  const writes = await run('customer.subscription.updated');
  assert.ok(writes.some(w => w.value.plan === 'starter'));
  assert.ok(writes.some(w => w.value.current_period_end));
  assert.ok(writes.every(w => !('first_paid_at' in w.value)));
});
test('actual webhook ignores deletion of a replaced subscription', async () => {
  assert.equal((await run('customer.subscription.deleted', { replacement: true, status: 'canceled' })).length, 0);
});
test('actual webhook clears current canceled plan even after customer deletion', async () => {
  assert.ok((await run('customer.subscription.deleted', { status: 'canceled' })).some(w => w.value.plan === null));
});
test('actual webhook ignores a failed-payment replay after invoice settlement', async () => {
  assert.equal((await run('invoice.payment_failed', { status: 'past_due', invoiceStatus: 'paid' })).length, 0);
});
test('actual checkout handler updates access without falsely registering a payment', async () => {
  const writes = await run('checkout.session.completed');
  assert.ok(writes.some(w => w.value.plan === 'starter'));
  assert.ok(writes.every(w => !('first_paid_at' in w.value)));
});
test('actual webhook records current failure against bound tenant without contact email', async () => {
  assert.ok((await run('invoice.payment_failed', { status: 'past_due', invoiceStatus: 'open' })).some(w => w.value.payment_failed_at));
});
