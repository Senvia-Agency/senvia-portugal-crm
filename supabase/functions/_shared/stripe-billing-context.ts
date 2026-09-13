// Resolve financial ownership from a service-owned binding, never from an email.
const idOf = (value: any): string | null => typeof value === 'string' ? value : value?.id ?? null;
const PRODUCTS = new Set(['prod_U0wAc7Tuy8w6gA', 'prod_U0wGoA4odOBHOZ', 'prod_U0wG6doz0zgZFV']);
export type BillingContext = { organizationId: string; current: boolean; subscription: any; invoice: any; session: any };

export async function resolveBillingContext(db: any, stripe: any, event: any): Promise<BillingContext | null> {
  const supported = ['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'];
  if (!supported.includes(event.type)) return null;
  let invoice: any = null;
  let session: any = null;
  let subscriptionId: string | null = null;
  if (event.type.startsWith('invoice.')) {
    invoice = await stripe.invoices.retrieve(event.data.object.id);
    subscriptionId = idOf(invoice.parent?.subscription_details?.subscription) ?? idOf(invoice.subscription);
  } else if (event.type.startsWith('checkout.')) {
    session = await stripe.checkout.sessions.retrieve(event.data.object.id);
    if (session.mode !== 'subscription') return null;
    subscriptionId = idOf(session.subscription);
  } else subscriptionId = event.data.object.id;
  if (!subscriptionId) return null;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (!subscription.items.data.some((item: any) => PRODUCTS.has(idOf(item.price?.product) || ''))) return null;
  const customerId = idOf(subscription.customer);
  if (!customerId || (invoice && idOf(invoice.customer) !== customerId) || (session && idOf(session.customer) !== customerId)) {
    throw new Error('Stripe billing customer mismatch');
  }
  const { data: binding, error } = await db.from('organization_billing_accounts')
    .select('organization_id, stripe_subscription_id').eq('stripe_customer_id', customerId).maybeSingle();
  if (error) throw new Error(error.message);
  // Fail for retry instead of silently crediting an arbitrary legacy membership.
  if (!binding) throw new Error('Stripe customer requires a reviewed organization billing binding');
  const organizationId = binding.organization_id;
  for (const metadataOrg of [subscription.metadata?.organization_id, session?.metadata?.organization_id, session?.client_reference_id]) {
    if (metadataOrg && metadataOrg !== organizationId) throw new Error('Stripe billing organization mismatch');
  }
  return { organizationId, current: binding.stripe_subscription_id === subscription.id, subscription, invoice, session };
}

export function shouldProcessBillingEvent(type: string, context: BillingContext | null): boolean {
  if (!context) return false;
  const { current, subscription, invoice, session } = context;
  // Historical paid invoices still belong in the ledger, but must not change current access.
  if (type === 'invoice.paid') return invoice.status === 'paid';
  if (!current) return false;
  if (type === 'invoice.payment_failed') return invoice.status === 'open' && ['past_due', 'unpaid'].includes(subscription.status);
  if (type === 'customer.subscription.deleted') return subscription.status === 'canceled';
  if (type === 'customer.subscription.updated') return !['canceled', 'incomplete_expired', 'incomplete'].includes(subscription.status);
  if (type === 'checkout.session.completed') return session.status === 'complete' && ['active', 'trialing'].includes(subscription.status);
  return false;
}
