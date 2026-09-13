import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReferralPreview,REFERRAL_PREVIEW_SCENARIOS} from './referral-preview.ts';
import {nextReferralBonus,referralTotals} from './referral-dashboard.ts';
const now=Date.parse('2026-09-13T10:00:00Z');
test('preview scenarios use the real dashboard rules and future renewal dates',()=>{
 for(const [scenario] of REFERRAL_PREVIEW_SCENARIOS){
  const d=buildReferralPreview(scenario,now);
  assert.ok(Date.parse(d.billing.next_renewal_at)>now);
  assert.ok(nextReferralBonus(d,now).title);
  assert.equal(d.billing.exempt,scenario==='exempt');
 }
 assert.match(nextReferralBonus(buildReferralPreview('earned',now),now).title,/próxima renovação/);
 assert.deepEqual(referralTotals(buildReferralPreview('accumulated',now).referrals),{pending:1,earned:3,used:0,reserved:0,available:3});
 assert.equal(referralTotals(buildReferralPreview('reserved',now).referrals).reserved,1);
 assert.equal(referralTotals(buildReferralPreview('used',now).referrals).used,1);
 assert.equal(referralTotals(buildReferralPreview('pending',now).referrals).pending,1);
});
test('preview rows are disposable and never use a valid referral UUID',()=>{
 const first=buildReferralPreview('earned',now);first.referrals[0].name='Changed';first.billing.exempt=true;
 const second=buildReferralPreview('earned',now);
 assert.notEqual(second.referrals[0].name,'Changed');assert.equal(second.billing.exempt,false);
 assert.doesNotMatch(second.code,/^[a-f0-9]{8}-[a-f0-9]{4}-/i);
});
