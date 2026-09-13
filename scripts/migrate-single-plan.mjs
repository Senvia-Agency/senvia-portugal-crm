// Default: read-only inventory. NEVER run --apply before explicit release approval.
// STRIPE_SECRET_KEY stays in the environment; reports contain no credentials.
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planSubscriptionMigration, MONTHLY_BASE_PRICE } from './single-plan-policy.mjs';
const apply = process.argv.includes('--apply');
if (apply && process.env.SENVIA_RELEASE_APPROVAL !== 'pulicar') throw new Error('Explicit release approval required');
const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error('STRIPE_SECRET_KEY is required');
function encode(value, prefix='', output=new URLSearchParams()) {
  for(const [key,item] of Object.entries(value)) {
    const name=prefix ? `${prefix}[${key}]` : key;
    if(item !== null && typeof item === 'object') encode(item,name,output);
    else if(item !== undefined && item !== null) output.append(name,String(item));
  }
  return output;
}
async function stripe(path, method='GET', data, idem) {
  const response=await fetch('https://api.stripe.com/v1/'+path, {
    method, signal:AbortSignal.timeout(30000),
    headers:{Authorization:'Bearer '+key,'Stripe-Version':'2025-08-27.basil',
      ...(data ? {'Content-Type':'application/x-www-form-urlencoded'} : {}), ...(idem ? {'Idempotency-Key':idem}: {})},
    ...(data ? {body:encode(data)} : {}),
  });
  const result=await response.json();
  if(!response.ok) throw new Error(result.error?.message || 'Stripe request failed');
  return result;
}
const subscriptions=[];
let after='';
do {
  const page=await stripe('subscriptions?status=all&limit=100'+(after?'&starting_after='+encodeURIComponent(after):''));
  subscriptions.push(...page.data); after=page.has_more?page.data.at(-1).id:'';
} while(after);
const report=subscriptions.map(sub=>({subscription:sub.id, before:sub, plan:planSubscriptionMigration(sub)}));
const reportPath=join(tmpdir(),'single-plan-review-'+new Date().toISOString().replaceAll(':','-')+'.json');
// Snapshot BEFORE writes: permits a reviewed rollback without touching invoices.
await writeFile(reportPath,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
console.log('Saved billing review:',reportPath);
console.log(JSON.stringify(report.reduce((counts,row)=>({...counts,[row.plan.status]:(counts[row.plan.status]||0)+1}),{})));
if(apply) {
  for(const row of report.filter(row=>row.plan.status==='ready')) {
    if(row.plan.kind==='monthly') {
      await stripe('subscriptions/'+row.subscription,'POST',row.plan.parameters,'single-plan-v1-'+row.subscription);
    } else {
      // Annual contracts keep their prepaid period. Transition only at renewal.
      const schedule=await stripe('subscription_schedules','POST',{from_subscription:row.subscription},'single-plan-schedule-v1-'+row.subscription);
      const phase=schedule.phases[0];
      const preserved={};
      for(const field of ['collection_method','default_tax_rates','automatic_tax','invoice_settings','billing_thresholds','proration_behavior']) if(phase[field]!=null) preserved[field]=phase[field];
      if(phase.discounts?.length) throw new Error('Annual schedule contains discounts: review snapshot before proceeding');
      const items=phase.items.map(item=>({price:typeof item.price==='string'?item.price:item.price.id,quantity:item.quantity}));
      await stripe('subscription_schedules/'+schedule.id,'POST',{
        end_behavior:'release',proration_behavior:'none',
        phases:[{...preserved,start_date:phase.start_date,end_date:phase.end_date,items},
          {...preserved,start_date:phase.end_date,iterations:1,items:[{price:MONTHLY_BASE_PRICE,quantity:1}],proration_behavior:'none'}],
      },'single-plan-phases-v1-'+row.subscription);
    }
  }
}
