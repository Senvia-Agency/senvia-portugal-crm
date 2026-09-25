// Called only after Stripe signature verification. Never resolve a tenant by email.
const PLAN_PRODUCTS = new Set(['prod_U0wAc7Tuy8w6gA', 'prod_U0wGoA4odOBHOZ', 'prod_U0wG6doz0zgZFV']);
const COUPON_ID = 'senvia-referral-month-v2';
const REWARD_COUPON_PREFIX = 'senvia-referral-month-';
const EXTRA_SEAT_PRICE = 'price_1TncdBLWnA81DzXTh3crx8iN';
const objectId = (value: any): string | null => typeof value === 'string' ? value : value?.id ?? null;
const subscriptionId = (invoice: any) => objectId(invoice.parent?.subscription_details?.subscription) ?? objectId(invoice.subscription);
const requireSuccess = (result: any) => { if (result.error) throw new Error(result.error.message || 'Referral ledger unavailable'); return result.data; };
const rewardCouponId = (rewardId: string) => `${REWARD_COUPON_PREFIX}${rewardId}`;
const couponRewardId = (couponId: string | null): string | null => {
  if (!couponId?.startsWith(REWARD_COUPON_PREFIX) || couponId === COUPON_ID) return null;
  const rewardId = couponId.slice(REWARD_COUPON_PREFIX.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rewardId) ? rewardId : null;
};

async function ensureReferralCoupon(stripe: any, couponId: string) {
  const seats = await stripe.prices.retrieve(EXTRA_SEAT_PRICE);
  const seatProduct = objectId(seats.product);
  if (!seatProduct) throw new Error('Seat product unavailable');
  const products = [...PLAN_PRODUCTS, seatProduct];
  let coupon;
  try { coupon = await stripe.coupons.retrieve(couponId); }
  catch (error: any) {
    if (error.code !== 'resource_missing') throw error;
    coupon = await stripe.coupons.create({
      id: couponId, percent_off: 100, duration: 'once', name: 'SENVIA OS — mês por indicação',
      applies_to: { products },
    }, { idempotencyKey: couponId });
  }
  const couponProducts = new Set(coupon.applies_to?.products || []);
  if (coupon.percent_off !== 100 || coupon.duration !== 'once' || coupon.valid === false
    || couponProducts.size !== products.length || !products.every(product => couponProducts.has(product))) {
    throw new Error('Referral coupon configuration mismatch');
  }
  return coupon;
}

async function syncBillingAccount(db: any, sub: any, base: any, observedAt: string) {
  const customerId = objectId(sub.customer);
  if (!customerId) throw new Error('Subscription customer unavailable');
  const binding = requireSuccess(await db.from('organization_billing_accounts')
    .select('organization_id').eq('stripe_customer_id', customerId).maybeSingle());
  if (!binding) {
    if (sub.metadata?.organization_id) throw new Error('Billing binding missing for SENVIA subscription');
    return null;
  }
  if (sub.metadata?.organization_id && sub.metadata.organization_id !== binding.organization_id) throw new Error('Subscription organization mismatch');
  const org = requireSuccess(await db.from('organizations').select('id, billing_exempt')
    .eq('id', binding.organization_id).single());
  const end = base.current_period_end ?? sub.current_period_end;
  const current = requireSuccess(await db.rpc('sync_referral_billing', {
    _organization_id: org.id, _customer_id: customerId, _subscription_id: sub.id, _observed_at: observedAt,
    _snapshot: { status: sub.status, billing_interval: base.price.recurring?.interval ?? null,
      interval_count: base.price.recurring?.interval_count ?? null,
      next_renewal_at: end ? new Date(end * 1000).toISOString() : null,
      cancel_at_period_end: !!sub.cancel_at_period_end, collection_paused: !!sub.pause_collection },
  }));
  return { ...org, current };
}

// Metadata alone does not prove that a coupon discounted the invoice.
function referralDiscount(invoice: any): { amount: number; rewardId: string | null } | null {
  for (const discount of invoice.discounts || []) {
    const couponId = objectId(discount.coupon ?? discount.source?.coupon);
    const rewardId = couponRewardId(couponId);
    if (couponId !== COUPON_ID && !rewardId) continue;
    const discountId = objectId(discount);
    const amount = (invoice.total_discount_amounts || []).reduce((sum: number, entry: any) =>
      sum + (objectId(entry.discount) === discountId ? Number(entry.amount || 0) : 0), 0);
    if (amount > 0) return { amount, rewardId };
  }
  return null;
}
async function releaseUnusedReservation(db: any, invoiceId: string) {
  requireSuccess(await db.from('organization_referrals').update({ redemption_invoice_id: null })
    .eq('redemption_invoice_id', invoiceId).is('redeemed_at', null));
}
async function reconcileReservation(db: any, invoice: any, org: any, base: any, sub: any) {
  const reward = requireSuccess(await db.from('organization_referrals').select('id, redeemed_at')
    .eq('organization_id', org.id).eq('redemption_invoice_id', invoice.id).maybeSingle());
  if (!reward || reward.redeemed_at) return;
  const applied = referralDiscount(invoice);
  if (invoice.metadata?.senvia_referral_reward !== reward.id || !applied
    || (applied.rewardId !== null && applied.rewardId !== reward.id)) {
    if (invoice.status !== 'draft') await releaseUnusedReservation(db, invoice.id);
    return;
  }
  if (invoice.status !== 'paid') return;
  const paidAt = invoice.status_transitions?.paid_at ?? invoice.created;
  requireSuccess(await db.from('organization_referrals').update({ redeemed_at: new Date(paidAt * 1000).toISOString() })
    .eq('id', reward.id).is('redeemed_at', null));
  if (org.current) {
    const end = base.current_period_end ?? sub.current_period_end;
    requireSuccess(await db.from('organizations').update({
      payment_failed_at: null, ...(end ? { current_period_end: new Date(end * 1000).toISOString() } : {}),
    }).eq('id', org.id));
  }
}
async function hasDiscountablePlanLine(stripe: any, invoice: any): Promise<boolean> {
  let page = invoice.lines;
  if (!page) page = await stripe.invoices.listLineItems(invoice.id, { limit: 100 });
  while (true) {
    for (const line of page.data || []) {
      const product = objectId(line.price?.product ?? line.pricing?.price_details?.product);
      const priceId = objectId(line.price ?? line.pricing?.price_details?.price);
      const remaining = Number(line.amount || 0) - (line.discount_amounts || []).reduce((sum: number, d: any) => sum + Number(d.amount || 0), 0);
      if (line.discountable !== false && remaining > 0 && (PLAN_PRODUCTS.has(product || '') || priceId === EXTRA_SEAT_PRICE)) return true;
    }
    if (!page.has_more) return false;
    const after = page.data?.at(-1)?.id;
    if (!after) throw new Error('Incomplete invoice lines');
    page = await stripe.invoices.listLineItems(invoice.id, { limit: 100, starting_after: after });
  }
}

// One earned month has one coupon. Create all confirmed coupons immediately,
// but attach only the oldest unused one to the subscription at any time.
export async function prepareReferralMonths(db: any, stripe: any, organizationId: string) {
  const rows = requireSuccess(await db.from('organization_referrals')
    .select('id, qualified_at, redemption_invoice_id, redeemed_at, revoked_at, stripe_coupon_id')
    .eq('organization_id', organizationId));
  const confirmed = (rows || []).filter((row: any) => row.qualified_at && !row.redeemed_at && !row.revoked_at)
    .sort((a: any, b: any) => a.qualified_at.localeCompare(b.qualified_at) || a.id.localeCompare(b.id));
  if (!confirmed.length) return;

  for (const reward of confirmed) {
    const couponId = rewardCouponId(reward.id);
    if (reward.stripe_coupon_id && reward.stripe_coupon_id !== couponId) throw new Error('Referral coupon mismatch');
    if (!reward.stripe_coupon_id) {
      await ensureReferralCoupon(stripe, couponId);
      requireSuccess(await db.from('organization_referrals').update({ stripe_coupon_id: couponId })
        .eq('id', reward.id).is('stripe_coupon_id', null));
    }
  }

  // A reserved invoice or an existing referral discount must finish first.
  if (confirmed.some((row: any) => row.redemption_invoice_id)) return;
  const binding = requireSuccess(await db.from('organization_billing_accounts')
    .select('stripe_customer_id, stripe_subscription_id').eq('organization_id', organizationId).maybeSingle());
  if (!binding?.stripe_subscription_id) return;
  const org = requireSuccess(await db.from('organizations').select('id, billing_exempt')
    .eq('id', organizationId).single());
  if (org.billing_exempt) return;
  const sub = await stripe.subscriptions.retrieve(binding.stripe_subscription_id, { expand: ['discounts'] });
  if (objectId(sub.customer) !== binding.stripe_customer_id
    || (sub.metadata?.organization_id && sub.metadata.organization_id !== organizationId)) {
    throw new Error('Referral subscription binding mismatch');
  }
  const base = sub.items.data.find((item: any) => PLAN_PRODUCTS.has(objectId(item.price?.product) || ''));
  const nextRenewal = base?.current_period_end ?? sub.current_period_end;
  if (sub.status !== 'active' || sub.pause_collection || sub.cancel_at_period_end || !nextRenewal
    || nextRenewal <= Math.floor(Date.now() / 1000)
    || base?.price.recurring?.interval !== 'month' || base?.price.recurring?.interval_count !== 1) return;

  const discounts = Array.isArray(sub.discounts) ? sub.discounts : sub.discount ? [sub.discount] : [];
  if (discounts.some((discount: any) => !objectId(discount))) throw new Error('Unidentified subscription discount');
  const confirmedIds = new Set(confirmed.map((row: any) => row.id));
  const priorMonthRedeemed = (rows || []).some((row: any) => row.redeemed_at && row.redemption_invoice_id);
  const activeDiscounts = discounts.filter((discount: any) => {
    const couponId = objectId(discount.coupon ?? discount.source?.coupon);
    const rewardId = couponRewardId(couponId);
    if (couponId === COUPON_ID) return !priorMonthRedeemed;
    return !rewardId || confirmedIds.has(rewardId);
  });
  if (activeDiscounts.some((discount: any) => {
    const couponId = objectId(discount.coupon ?? discount.source?.coupon);
    return couponId === COUPON_ID || !!couponRewardId(couponId);
  })) return;

  const reward = confirmed[0];
  const couponId = rewardCouponId(reward.id);
  await stripe.subscriptions.update(sub.id, {
    discounts: [...activeDiscounts.map((discount: any) => ({ discount: objectId(discount) })), { coupon: couponId }],
    proration_behavior: 'none',
  }, { idempotencyKey: `referral-attach-${sub.id}-${reward.id}` });
}

// Daily reconciliation covers missed webhooks and rewards earned before rollout.
export async function prepareAvailableReferralMonths(db: any, stripe: any) {
  const organizations = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const rows = requireSuccess(await db.from('organization_referrals').select('organization_id')
      .not('qualified_at', 'is', null).is('redeemed_at', null).is('revoked_at', null)
      .order('id').range(offset, offset + 999));
    for (const row of rows || []) organizations.add(row.organization_id);
    if ((rows || []).length < 1000) break;
  }
  const failed: Array<{ organization_id: string; reason: string }> = [];
  for (const organizationId of organizations) {
    try { await prepareReferralMonths(db, stripe, organizationId); }
    catch (error) { failed.push({ organization_id: organizationId, reason: (error as Error).message }); }
  }
  return { scanned: organizations.size, failed };
}

export async function handleReferralEvent(db: any, stripe: any, event: any) {
  const observedAt = new Date().toISOString();
  if (event.type === 'checkout.session.completed') {
    const session = await stripe.checkout.sessions.retrieve(event.data.object.id);
    if (session.mode !== 'subscription' || !objectId(session.subscription)) return;
    const sub = await stripe.subscriptions.retrieve(objectId(session.subscription));
    if (objectId(session.customer) !== objectId(sub.customer)) throw new Error('Checkout customer mismatch');
    const base = sub.items.data.find((item: any) => PLAN_PRODUCTS.has(objectId(item.price?.product) || ''));
    if (base) {
      const org = await syncBillingAccount(db, sub, base, observedAt);
      if (org?.current) await prepareReferralMonths(db, stripe, org.id);
    }
    return;
  }
  if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
    const sub = await stripe.subscriptions.retrieve(event.data.object.id);
    const base = sub.items.data.find((item: any) => PLAN_PRODUCTS.has(objectId(item.price?.product) || ''));
    if (base) {
      const org = await syncBillingAccount(db, sub, base, observedAt);
      if (org?.current) await prepareReferralMonths(db, stripe, org.id);
    }
    return;
  }
  if (!['invoice.created', 'invoice.paid', 'invoice.finalized', 'invoice.voided', 'invoice.deleted'].includes(event.type)) return;
  const eventInvoice = event.data.object;
  if (!eventInvoice.id) return;
  if (event.type === 'invoice.deleted') {
    await releaseUnusedReservation(db, eventInvoice.id);
    return;
  }
  // Always reconcile against current Stripe state, not an old webhook snapshot.
  const invoice = await stripe.invoices.retrieve(eventInvoice.id, { expand: ['discounts'] });
  if (invoice.status === 'void') { await releaseUnusedReservation(db, invoice.id); return; }
  const subId = subscriptionId(invoice);
  if (!subId) return;
  const sub = await stripe.subscriptions.retrieve(subId);
  const base = sub.items.data.find((item: any) => PLAN_PRODUCTS.has(objectId(item.price?.product) || ''));
  if (!base) return;
  if (objectId(invoice.customer) !== objectId(sub.customer)) throw new Error('Invoice customer mismatch');
  const org = await syncBillingAccount(db, sub, base, observedAt);
  if (!org) return;

  const monthlyRenewal = org.current && !org.billing_exempt && !sub.pause_collection
    && invoice.billing_reason === 'subscription_cycle' && base.price.recurring?.interval === 'month'
    && base.price.recurring?.interval_count === 1;
  // The coupon may have been put on the subscription before Stripe created
  // the invoice. Link its actual discount to the ledger even when a delayed
  // invoice.created delivery observes an invoice that is already paid.
  const applied = referralDiscount(invoice);
  if (monthlyRenewal && (invoice.status === 'draft' || invoice.status === 'paid')
    && !invoice.metadata?.senvia_referral_reward && applied) {
    const rewardId = requireSuccess(await db.rpc(
      applied.rewardId ? 'reserve_referral_month_for_reward' : 'reserve_referral_month',
      { _organization_id: org.id, _invoice_id: invoice.id,
        ...(applied.rewardId ? { _reward_id: applied.rewardId } : {}) },
    ));
    if (rewardId) {
      await stripe.invoices.update(invoice.id, {
        metadata: { senvia_referral_reward: rewardId },
      }, { idempotencyKey: `referral-month-link-${invoice.id}-${rewardId}` });
      invoice.metadata = { ...invoice.metadata, senvia_referral_reward: rewardId };
    }
  }

  if (invoice.status === 'paid') {
    if (invoice.amount_paid > 0 && !invoice.paid_out_of_band && !(invoice.amount_paid_off_stripe > 0)) {
      requireSuccess(await db.rpc('qualify_referral', {
        _organization_id: org.id, _invoice_id: invoice.id,
        _paid_at: new Date((invoice.status_transitions?.paid_at ?? invoice.created) * 1000).toISOString(),
      }));
      const referrer = requireSuccess(await db.from('organization_referrals')
        .select('organization_id').eq('referred_organization_id', org.id).maybeSingle());
      if (referrer?.organization_id) await prepareReferralMonths(db, stripe, referrer.organization_id);
    }
    await reconcileReservation(db, invoice, org, base, sub);
    await prepareReferralMonths(db, stripe, org.id);
    return;
  }
  if (invoice.status !== 'draft') { await reconcileReservation(db, invoice, org, base, sub); return; }
  if (event.type !== 'invoice.created' || !monthlyRenewal) return;
  if (invoice.metadata?.senvia_referral_reward) return;
  if (invoice.total <= 0 || !await hasDiscountablePlanLine(stripe, invoice)) return;
  const rewardId = requireSuccess(await db.rpc('reserve_referral_month', { _organization_id: org.id, _invoice_id: invoice.id }));
  if (!rewardId) return;
  const couponId = rewardCouponId(rewardId);
  await ensureReferralCoupon(stripe, couponId);
  requireSuccess(await db.from('organization_referrals').update({ stripe_coupon_id: couponId })
    .eq('id', rewardId).is('stripe_coupon_id', null));
  await stripe.invoices.update(invoice.id, {
    discounts: [...(invoice.discounts || []).map((discount: any) => ({ discount: objectId(discount) })), { coupon: couponId }],
    metadata: { senvia_referral_reward: rewardId },
  }, { idempotencyKey: `referral-month-${invoice.id}-${rewardId}` });
}
