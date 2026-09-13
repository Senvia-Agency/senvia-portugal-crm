import test from 'node:test';
import assert from 'node:assert/strict';
import { planSubscriptionMigration, MONTHLY_BASE_PRICE } from './single-plan-policy.mjs';
const base={id:'si_base',quantity:1,price:{id:'old_price',product:'prod_U0wGoA4odOBHOZ',currency:'eur',recurring:{interval:'month',interval_count:1}}};
test('monthly migration changes only base price and never prorates extra users',()=>{
  const result=planSubscriptionMigration({status:'active',items:{data:[base,{id:'si_seats',quantity:7,price:{product:'extra'}}]}});
  assert.deepEqual(result.parameters,{items:[{id:'si_base',price:MONTHLY_BASE_PRICE,quantity:1}],proration_behavior:'none'});
});
test('annual subscriptions are scheduled; existing schedules remain untouched',()=>{
  const annual={id:'sub1',status:'active',items:{data:[{...base,price:{...base.price,recurring:{interval:'year',interval_count:1}}}]}};
  assert.equal(planSubscriptionMigration(annual).kind,'annual');
  assert.equal(planSubscriptionMigration({...annual,schedule:'existing'}).status,'review');
  assert.equal(planSubscriptionMigration({...annual,cancel_at_period_end:true}).status,'review');
  assert.equal(planSubscriptionMigration({...annual,discounts:['di_legacy']}).status,'review');
});
