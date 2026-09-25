import test from 'node:test';
import assert from 'node:assert/strict';
import { handleReferralEvent, prepareReferralMonths } from './referrals.ts';

function fixture() {
 const calls:any[]=[];
 const org={id:'org1',billing_exempt:false};
 const sub:any={id:'sub1',customer:'cus1',status:'active',items:{data:[{price:{product:'prod_U0wAc7Tuy8w6gA',recurring:{interval:'month',interval_count:1}}}]}};
 const current:any={id:'inv1',customer:'cus1',subscription:'sub1',status:'draft',amount_paid:0,created:1789000000,billing_reason:'subscription_cycle',total:5900,discounts:[],metadata:{},lines:{data:[{id:'il1',amount:5900,discountable:true,price:{product:'prod_U0wAc7Tuy8w6gA'}}],has_more:false}};
 const state:any={reward:null,binding:{organization_id:org.id},current:true};
 const db:any={rpc:async(name:string,args:any)=>{calls.push([name,args]);return {data:name==='reserve_referral_month'||name==='reserve_referral_month_for_reward'?'11111111-1111-4111-8111-111111111111':name==='sync_referral_billing'?state.current:null};},from:(table:string)=>{
  const query:any={select:()=>query,eq:(k:string,v:any)=>{calls.push(['filter',table,k,v]);return query;},is:(k:string,v:any)=>{calls.push(['is',table,k,v]);return query;},
   update:(value:any)=>{calls.push([table,value]);return query;},single:async()=>({data:org}),
   maybeSingle:async()=>({data:table==='organization_billing_accounts'?state.binding:table==='organization_referrals'?state.reward:org}),
   then:(resolve:any)=>Promise.resolve({data:null,error:null}).then(resolve)};return query;
 }};
 const validCoupon={id:'senvia-referral-month-v2',percent_off:100,duration:'once',valid:true,applies_to:{products:['prod_U0wAc7Tuy8w6gA','prod_U0wGoA4odOBHOZ','prod_U0wG6doz0zgZFV','prod_seats']}};
 const stripe:any={prices:{retrieve:async()=>({product:'prod_seats'})},subscriptions:{retrieve:async()=>sub},invoices:{retrieve:async()=>current,update:async(_:string,value:any)=>{
  calls.push(['invoice_update',value]);current.metadata={...current.metadata,...value.metadata};
  current.discounts=[{id:'di_ref',coupon:{id:'senvia-referral-month-v2'}}];current.total_discount_amounts=[{discount:'di_ref',amount:5900}];return current;
 }},coupons:{retrieve:async()=>validCoupon}};
 const event=(type='invoice.created')=>({type,data:{object:{id:current.id}}});
 return {db,stripe,calls,current,sub,org,state,event};
}

test('zero-value and off-Stripe payments never qualify a referral',async()=>{
 const f=fixture();f.current.status='paid';
 for(const patch of [{amount_paid:0},{amount_paid:5900,paid_out_of_band:true},{amount_paid:5900,amount_paid_off_stripe:5900}]){
  Object.assign(f.current,{paid_out_of_band:false,amount_paid_off_stripe:0},patch);await handleReferralEvent(f.db,f.stripe,f.event('invoice.paid'));
 }
 assert.equal(f.calls.filter(c=>c[0]==='qualify_referral').length,0);
 Object.assign(f.current,{amount_paid:5900,paid_out_of_band:false,amount_paid_off_stripe:0});
 await handleReferralEvent(f.db,f.stripe,f.event('invoice.paid'));assert.equal(f.calls.filter(c=>c[0]==='qualify_referral').length,1);
});
test('renewal replay does not reserve another reward or duplicate an existing discount',async()=>{
 const f=fixture();f.current.discounts=[{id:'di_existing',coupon:{id:'existing'}}];
 await handleReferralEvent(f.db,f.stripe,f.event());await handleReferralEvent(f.db,f.stripe,f.event());
 assert.equal(f.calls.filter(c=>c[0]==='reserve_referral_month').length,1);
 const updates=f.calls.filter(c=>c[0]==='invoice_update');assert.equal(updates.length,1);
 assert.deepEqual(updates[0][1].discounts,[{discount:'di_existing'},{coupon:'senvia-referral-month-11111111-1111-4111-8111-111111111111'}]);
});
test('a referral coupon applied to the subscription before renewal is linked without applying it twice',async()=>{
 const f=fixture();
 f.current.total=0;
 f.current.discounts=[{id:'di_ref',coupon:{id:'senvia-referral-month-v2'}}];
 f.current.total_discount_amounts=[{discount:'di_ref',amount:5900}];
 await handleReferralEvent(f.db,f.stripe,f.event());
 assert.equal(f.calls.filter(c=>c[0]==='reserve_referral_month').length,1);
 const updates=f.calls.filter(c=>c[0]==='invoice_update');
 assert.equal(updates.length,1);
 assert.deepEqual(updates[0][1],{metadata:{senvia_referral_reward:'11111111-1111-4111-8111-111111111111'}});
});
test('a paid zero-value renewal still consumes its pre-applied referral month when events arrive late',async()=>{
 const f=fixture();
 f.current.status='paid';f.current.total=0;
 f.current.discounts=[{id:'di_ref',coupon:{id:'senvia-referral-month-v2'}}];
 f.current.total_discount_amounts=[{discount:'di_ref',amount:5900}];
 f.state.reward={id:'11111111-1111-4111-8111-111111111111',redeemed_at:null};
 await handleReferralEvent(f.db,f.stripe,f.event('invoice.paid'));
 assert.equal(f.calls.filter(c=>c[0]==='reserve_referral_month').length,1);
 assert.ok(f.calls.some(c=>c[0]==='organization_referrals'&&c[1].redeemed_at));
});
test('a reward-specific coupon reserves only its matching referral month',async()=>{
 const f=fixture();f.current.total=0;
 f.current.discounts=[{id:'di_ref',coupon:{id:'senvia-referral-month-11111111-1111-4111-8111-111111111111'}}];
 f.current.total_discount_amounts=[{discount:'di_ref',amount:5900}];
 await handleReferralEvent(f.db,f.stripe,f.event());
 assert.deepEqual(f.calls.find(c=>c[0]==='reserve_referral_month_for_reward')?.[1],{
  _organization_id:'org1',_invoice_id:'inv1',_reward_id:'11111111-1111-4111-8111-111111111111',
 });
 assert.equal(f.calls.filter(c=>c[0]==='reserve_referral_month').length,0);
});
test('ten confirmed months create ten distinct coupons and attach one at a time',async()=>{
 const calls:any[]=[];
 const rows=Array.from({length:10},(_,i)=>({
  id:`${String(i+1).padStart(8,'0')}-1111-4111-8111-111111111111`,
  qualified_at:new Date(Date.UTC(2026,8,i+1)).toISOString(),
  redemption_invoice_id:null,redeemed_at:null,revoked_at:null,stripe_coupon_id:null,
 }));
 const sub:any={id:'sub1',customer:'cus1',status:'active',current_period_end:Math.floor(Date.now()/1000)+86400*30,
  discounts:[],items:{data:[{price:{product:'prod_U0wAc7Tuy8w6gA',recurring:{interval:'month',interval_count:1}}}]}};
 const db:any={from:(table:string)=>{
  let filterId:string|null=null;const query:any={select:()=>query,eq:(k:string,v:any)=>{if(k==='id')filterId=v;return query;},is:()=>query,
   update:(value:any)=>{calls.push(['db_update',filterId,value]);const row=rows.find(r=>r.id===filterId);if(row)Object.assign(row,value);return query;},
   maybeSingle:async()=>({data:{stripe_customer_id:'cus1',stripe_subscription_id:'sub1'}}),
   single:async()=>({data:{id:'org1',billing_exempt:false}}),
   then:(resolve:any)=>Promise.resolve({data:table==='organization_referrals'?rows:null,error:null}).then(resolve)};
  return query;
 }};
 const stripe:any={prices:{retrieve:async()=>({product:'prod_seats'})},coupons:{
  retrieve:async()=>{throw Object.assign(new Error('missing'),{code:'resource_missing'});},
  create:async(value:any)=>{calls.push(['coupon_create',value.id]);return {...value,valid:true};}},
  subscriptions:{retrieve:async()=>sub,update:async(_:string,value:any)=>{
   calls.push(['subscription_update',value]);sub.discounts=[{id:`di_${calls.length}`,coupon:{id:value.discounts.at(-1).coupon}}];return sub;
  }}};
 await prepareReferralMonths(db,stripe,'org1');
 assert.equal(calls.filter(c=>c[0]==='coupon_create').length,10);
 assert.equal(new Set(calls.filter(c=>c[0]==='coupon_create').map(c=>c[1])).size,10);
 assert.equal(calls.filter(c=>c[0]==='subscription_update').length,1);
 await prepareReferralMonths(db,stripe,'org1');
 assert.equal(calls.filter(c=>c[0]==='subscription_update').length,1);
 rows[0].redeemed_at=new Date().toISOString();
 await prepareReferralMonths(db,stripe,'org1');
 const updates=calls.filter(c=>c[0]==='subscription_update');
 assert.equal(updates.length,2);
 assert.equal(updates[1][1].discounts.at(-1).coupon,`senvia-referral-month-${rows[1].id}`);
});
test('ledger errors propagate for webhook retry',async()=>{
 const f=fixture();f.db.rpc=async()=>({error:{message:'database unavailable'}});
 await assert.rejects(handleReferralEvent(f.db,f.stripe,f.event()),/database unavailable/);
 assert.equal(f.calls.filter(c=>c[0]==='invoice_update').length,0);
});
test('free month coupon excludes unrelated invoice products',async()=>{
 const f=fixture();let coupon:any;f.stripe.coupons.retrieve=async()=>{throw Object.assign(new Error('missing'),{code:'resource_missing'});};
 f.stripe.prices={retrieve:async()=>({product:'prod_seats'})};f.stripe.coupons.create=async(value:any)=>{coupon=value;return value;};
 await handleReferralEvent(f.db,f.stripe,f.event());assert.equal(coupon.percent_off,100);
 assert.deepEqual(coupon.applies_to.products,['prod_U0wAc7Tuy8w6gA','prod_U0wGoA4odOBHOZ','prod_U0wG6doz0zgZFV','prod_seats']);
});
test('unrelated charges and already-discounted plan lines do not consume a month',async()=>{
 for(const line of [{amount:5000,price:{product:'other'}},{amount:5000,price:{product:'prod_U0wAc7Tuy8w6gA'},discount_amounts:[{amount:5000}]}]){
  const f=fixture();f.current.lines.data=[line];await handleReferralEvent(f.db,f.stripe,f.event());
  assert.equal(f.calls.filter(c=>c[0]==='reserve_referral_month').length,0);
 }
});
test('paginated Basil invoice lines find eligible seats beyond the first page',async()=>{
 const f=fixture();f.current.lines={data:[{id:'il_other',amount:1000,price:{product:'other'}}],has_more:true};
 f.stripe.invoices.listLineItems=async(_:string,options:any)=>{assert.equal(options.starting_after,'il_other');return {data:[{id:'il_seat',amount:500,pricing:{price_details:{price:'price_1TncdBLWnA81DzXTh3crx8iN'}}}],has_more:false};};
 await handleReferralEvent(f.db,f.stripe,f.event());assert.equal(f.calls.filter(c=>c[0]==='reserve_referral_month').length,1);
});
test('payment metadata with zero actual discount releases the reservation instead of using it',async()=>{
 const f=fixture();Object.assign(f.current,{status:'paid',amount_paid:5900,metadata:{senvia_referral_reward:'11111111-1111-4111-8111-111111111111'},discounts:[{id:'di_ref',coupon:{id:'senvia-referral-month-v2'}}],total_discount_amounts:[{discount:'di_ref',amount:0}]});
 f.state.reward={id:'11111111-1111-4111-8111-111111111111',redeemed_at:null};await handleReferralEvent(f.db,f.stripe,f.event('invoice.paid'));
 assert.ok(f.calls.some(c=>c[0]==='organization_referrals'&&c[1].redemption_invoice_id===null));
 assert.equal(f.calls.some(c=>c[0]==='organization_referrals'&&c[1].redeemed_at),false);
});
test('finalization after a failed discount request returns the unused month',async()=>{
 const f=fixture();f.current.status='open';f.state.reward={id:'11111111-1111-4111-8111-111111111111',redeemed_at:null};
 await handleReferralEvent(f.db,f.stripe,f.event('invoice.finalized'));
 assert.ok(f.calls.some(c=>c[0]==='organization_referrals'&&c[1].redemption_invoice_id===null));
});
test('stale webhook payload is reconciled against the current invoice',async()=>{
 const f=fixture();f.current.status='open';await handleReferralEvent(f.db,f.stripe,{type:'invoice.paid',data:{object:{id:'inv1',status:'paid',amount_paid:5900}}});
 assert.equal(f.calls.filter(c=>c[0]==='qualify_referral').length,0);
 f.current.status='paid';f.current.amount_paid=5900;await handleReferralEvent(f.db,f.stripe,f.event('invoice.created'));
 assert.equal(f.calls.filter(c=>c[0]==='qualify_referral').length,1);
});
test('superseded subscriptions and paused collection cannot reserve new bonuses',async()=>{
 for(const patch of ['superseded','paused']){const f=fixture();if(patch==='superseded')f.state.current=false;else f.sub.pause_collection={behavior:'void'};
  await handleReferralEvent(f.db,f.stripe,f.event());assert.equal(f.calls.filter(c=>c[0]==='reserve_referral_month').length,0);
 }
});
test('customer and organization mismatches fail before reward operations',async()=>{
 for(const patch of ['customer','organization']){const f=fixture();if(patch==='customer')f.current.customer='cus_other';else f.sub.metadata={organization_id:'org_other'};
  await assert.rejects(handleReferralEvent(f.db,f.stripe,f.event()),/mismatch/);assert.equal(f.calls.filter(c=>c[0]==='reserve_referral_month').length,0);
 }
});
test('deleted invoice releases only unredeemed reservations and never clears redemption history',async()=>{
 const f=fixture();await handleReferralEvent(f.db,f.stripe,f.event('invoice.deleted'));
 assert.ok(f.calls.some(c=>c[0]==='is'&&c[1]==='organization_referrals'&&c[2]==='redeemed_at'&&c[3]===null));
 assert.equal(f.calls.some(c=>c[0]==='organization_referrals'&&'redeemed_at' in c[1]),false);
});

test('a misconfigured existing coupon cannot discount unrelated products',async()=>{
 const f=fixture();f.stripe.coupons.retrieve=async()=>({percent_off:100,duration:'once',valid:true});
 await assert.rejects(handleReferralEvent(f.db,f.stripe,f.event()),/coupon configuration mismatch/);
 assert.equal(f.calls.filter(c=>c[0]==='invoice_update').length,0);
});
test('a missing binding for a known SENVIA subscription requests a retry instead of dropping the payment',async()=>{
 const f=fixture();f.state.binding=null;f.sub.metadata={organization_id:'org1'};f.current.status='paid';f.current.amount_paid=5900;
 await assert.rejects(handleReferralEvent(f.db,f.stripe,f.event('invoice.paid')),/Billing binding missing/);
 assert.equal(f.calls.filter(c=>c[0]==='qualify_referral').length,0);
});
