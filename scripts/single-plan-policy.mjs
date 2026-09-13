export const MONTHLY_BASE_PRICE = 'price_1T2uHzLWnA81DzXTHdexakfL';
export const BASE_PRODUCTS = new Set(['prod_U0wAc7Tuy8w6gA','prod_U0wGoA4odOBHOZ','prod_U0wG6doz0zgZFV']);
const id = value => typeof value === 'string' ? value : value?.id;
export function planSubscriptionMigration(sub) {
  const bases = sub.items.data.filter(item => BASE_PRODUCTS.has(id(item.price.product)));
  if (bases.length !== 1) return { status:'skip', reason:'Not exactly one SENVIA OS base item' };
  const base = bases[0];
  if (!['active','trialing','past_due'].includes(sub.status)) return { status:'skip', reason:'Inactive subscription' };
  if (base.price.id === MONTHLY_BASE_PRICE) return { status:'unchanged' };
  if (sub.schedule) return { status:'review', reason:'Existing schedule must be preserved' };
  if (base.quantity !== 1 || base.price.currency !== 'eur') return { status:'review', reason:'Nonstandard quantity or currency' };
  if (base.price.recurring.interval === 'month' && base.price.recurring.interval_count === 1) {
    return { status:'ready', kind:'monthly', parameters:{ items:[{id:base.id, price:MONTHLY_BASE_PRICE, quantity:1}], proration_behavior:'none' } };
  }
  if (base.price.recurring.interval === 'year' && sub.items.data.length === 1) {
    if (sub.cancel_at_period_end || sub.cancel_at || sub.pause_collection || sub.trial_end
      || sub.discounts?.length || sub.default_tax_rates?.length || sub.automatic_tax?.enabled
      || sub.billing_thresholds || sub.transfer_data || sub.application_fee_percent
      || sub.collection_method === 'send_invoice') {
      return { status:'review', reason:'Annual contract has cancellation, trial, discounts or billing settings to preserve explicitly' };
    }
    return { status:'ready', kind:'annual', subscription:sub.id, newPrice:MONTHLY_BASE_PRICE };
  }
  return { status:'review', reason:'Mixed intervals require a schedule preserving all add-ons' };
}
