import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBillingContext, shouldProcessBillingEvent } from './stripe-billing-context.ts';

function fixture() {
  const sub: any = { id: 'sub_B', customer: 'cus_B', metadata: { organization_id: 'org_B' }, status: 'active', items: { data: [{ price: { product: 'prod_U0wAc7Tuy8w6gA' } }] } };
  const invoice: any = { id: 'in_B', customer: 'cus_B', subscription: 'sub_B', status: 'paid', customer_email: 'shared@example.invalid' };
  const session: any = { id: 'cs_B', customer: 'cus_B', subscription: 'sub_B', mode: 'subscription', status: 'complete', metadata: { organization_id: 'org_B' }, client_reference_id: 'org_B' };
  const state: any = { binding: { organization_id: 'org_B', stripe_subscription_id: 'sub_B' }, error: null };
  const queries: any[] = [];
  const db: any = { from(table: string) { assert.equal(table, 'organization_billing_accounts'); return { select() { return this; }, eq(k: string, v: string) { queries.push([k, v]); return this; }, async maybeSingle() { return { data: state.binding, error: state.error }; } }; } };
  const stripe: any = { subscriptions: { retrieve: async () => sub }, invoices: { retrieve: async () => invoice }, checkout: { sessions: { retrieve: async () => session } } };
  const event = (type = 'invoice.paid') => ({ type, data: { object: { id: 'old_snapshot', customer: 'cus_A', customer_email: 'shared@example.invalid', status: 'canceled' } } });
  return { sub, invoice, session, state, queries, db, stripe, event };
}

test('shared admin email never chooses organization A when customer belongs to B', async () => {
  const f = fixture(); const result = await resolveBillingContext(f.db, f.stripe, f.event());
  assert.equal(result?.organizationId, 'org_B'); assert.equal(result?.current, true);
  assert.deepEqual(f.queries, [['stripe_customer_id', 'cus_B']]);
});
test('missing or conflicting bindings fail instead of guessing or acknowledging a lost payment', async () => {
  const f = fixture(); f.state.binding = null;
  await assert.rejects(resolveBillingContext(f.db, f.stripe, f.event()), /reviewed organization/);
  f.state.binding = { organization_id: 'org_A' };
  await assert.rejects(resolveBillingContext(f.db, f.stripe, f.event()), /organization mismatch/);
});
test('invoice and checkout customer mismatches cannot target another tenant', async () => {
  const f = fixture(); f.invoice.customer = 'cus_A'; f.session.customer = 'cus_A';
  for (const type of ['invoice.paid', 'checkout.session.completed']) await assert.rejects(resolveBillingContext(f.db, f.stripe, f.event(type)), /customer mismatch/);
});
test('checkout reference must agree with the service-owned binding', async () => {
  const f = fixture(); f.session.client_reference_id = 'org_A';
  await assert.rejects(resolveBillingContext(f.db, f.stripe, f.event('checkout.session.completed')), /organization mismatch/);
});
test('deletion of a replaced subscription cannot clear the current plan', async () => {
  const f = fixture(); f.sub.status = 'canceled'; f.state.binding.stripe_subscription_id = 'sub_new';
  const context = await resolveBillingContext(f.db, f.stripe, f.event('customer.subscription.deleted'));
  assert.equal(shouldProcessBillingEvent('customer.subscription.deleted', context), false);
});
test('current cancellation works without customer email', async () => {
  const f = fixture(); f.sub.status = 'canceled';
  const context = await resolveBillingContext(f.db, f.stripe, f.event('customer.subscription.deleted'));
  assert.equal(shouldProcessBillingEvent('customer.subscription.deleted', context), true);
});
test('late failed-payment event for an already paid invoice does not block access', async () => {
  const f = fixture(); f.sub.status = 'past_due';
  const context = await resolveBillingContext(f.db, f.stripe, f.event('invoice.payment_failed'));
  assert.equal(shouldProcessBillingEvent('invoice.payment_failed', context), false);
  f.invoice.status = 'open';
  assert.equal(shouldProcessBillingEvent('invoice.payment_failed', context), true);
  f.sub.status = 'active';
  assert.equal(shouldProcessBillingEvent('invoice.payment_failed', context), false);
});
test('historical paid invoice retains its owner for accounting without current access writes', async () => {
  const f = fixture(); f.state.binding.stripe_subscription_id = 'sub_new';
  const context = await resolveBillingContext(f.db, f.stripe, f.event());
  assert.equal(context?.current, false); assert.equal(context?.organizationId, 'org_B');
  assert.equal(shouldProcessBillingEvent('invoice.paid', context), true);
});
test('Basil expanded customer and subscription references are accepted', async () => {
  const f = fixture(); delete f.invoice.subscription;
  f.invoice.parent = { subscription_details: { subscription: { id: 'sub_B' } } };
  f.invoice.customer = { id: 'cus_B' }; f.sub.customer = { id: 'cus_B' };
  assert.equal((await resolveBillingContext(f.db, f.stripe, f.event()))?.organizationId, 'org_B');
});
test('unrelated invoices and products cannot change SENVIA access', async () => {
  const f = fixture(); delete f.invoice.subscription;
  assert.equal(await resolveBillingContext(f.db, f.stripe, f.event()), null);
  f.sub.items.data[0].price.product = 'unrelated';
  assert.equal(await resolveBillingContext(f.db, f.stripe, f.event('customer.subscription.deleted')), null);
});
