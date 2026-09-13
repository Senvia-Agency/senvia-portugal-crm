import test from 'node:test'; import assert from 'node:assert/strict';
import {nextReferralBonus,referralTotals} from './referral-dashboard.ts';
const now=Date.parse('2026-09-13T10:00:00Z');
const row={id:'r',name:'Empresa',created_at:'2026-09-13',qualified_at:'2026-09-13',redeemed_at:null,revoked_at:null,reserved:false};
const data={code:'code',referrals:[row],billing:{exempt:false,status:'active',interval:'month',interval_count:1,next_renewal_at:'2026-10-13T10:00:00Z',cancel_at_period_end:false,synced_at:'2026-09-13'}};
test('next renewal distinguishes available, reserved, redeemed and revoked months',()=>{
 assert.match(nextReferralBonus(data,now).title,/próxima renovação/);
 assert.match(nextReferralBonus({...data,referrals:[{...row,reserved:true}]},now).title,/em aplicação/);
 for(const patch of [{redeemed_at:'2026-09-13'},{revoked_at:'2026-09-13'},{qualified_at:null}])assert.match(nextReferralBonus({...data,referrals:[{...row,...patch}]},now).title,/Sem bónus/);
 const totals=referralTotals([row,{...row,id:'reserved',reserved:true},{...row,id:'used',redeemed_at:'2026-09-13'},{...row,id:'pending',qualified_at:null}]);
 assert.deepEqual(totals,{available:1,reserved:1,used:1,pending:1,earned:3});
});
for(const [label,patch,expected] of [['exempt',{exempt:true},/já está isenta/],['annual',{interval:'year'},/faturação mensal/],['cancellation',{cancel_at_period_end:true},/sem renovação/],['unknown',{status:null},/Tens bónus disponível/],['overdue',{status:'past_due'},/Tens bónus disponível/],['stale period',{next_renewal_at:'2026-09-01'},/Tens bónus disponível/]])test(label+' never promises a free next invoice',()=>assert.match(nextReferralBonus({...data,billing:{...data.billing,...patch}},now).title,expected));

test('paused collection keeps the reward without forecasting a free next charge',()=>{
 assert.match(nextReferralBonus({...data,billing:{...data.billing,collection_paused:true}},now).title,/cobrança está suspensa/);
});
