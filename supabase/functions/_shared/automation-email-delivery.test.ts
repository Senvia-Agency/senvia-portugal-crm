import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverAutomationEmail, parseEmailDeliveryClaim, InvalidEmailDeliveryClaim } from './automation-email-delivery.ts';
import type { EmailDeliveryClaim, EmailDeliveryDependencies } from './automation-email-delivery.ts';

type DeliveryState = 'new' | 'processing' | 'sent' | 'failed_retryable' | 'uncertain';
function fixture(options: { response?: number; timeout?: boolean; ledgerFail?: boolean; finalizeFail?: boolean } = {}) {
  let state: DeliveryState = 'new';
  let providerCalls = 0;
  let emailSendId: string | null = null;
  const keys: string[] = [];
  const deps: EmailDeliveryDependencies = {
    claim: async () => {
      const decision = state === 'new' || state === 'failed_retryable' ? 'send' : state === 'sent' ? 'sent' : 'blocked';
      if (decision === 'send') state = 'processing';
      return { decision, delivery_id:'delivery-1', claim_token:'token-1',idempotency_key:'provider-key-1',email_send_id:emailSendId,status:state };
    },
    send: async key => {
      keys.push(key); providerCalls += 1;
      if (options.timeout) throw new DOMException('Timed out','TimeoutError');
      return { status:options.response ?? 201,messageId:options.response ? undefined : 'brevo-message-1' };
    },
    saveLedger: async () => options.ledgerFail ? null : 'send-1',
    finalize: async (_claim, outcome, id) => {
      if (options.finalizeFail) throw new Error('database unavailable');
      state=outcome; emailSendId=id;
    },
  };
  return { deps, getState:()=>state, calls:()=>providerCalls, keys };
}

test('two concurrent attempts cause one provider request and one blocked attempt',async()=>{
  const f=fixture();
  const results=await Promise.all([deliverAutomationEmail(f.deps),deliverAutomationEmail(f.deps)]);
  assert.equal(f.calls(),1);
  assert.deepEqual(results.map(r=>r.status).sort(),['processing','sent']);
});
test('replay of a sent claim returns saved ledger without calling provider',async()=>{
  const f=fixture();
  await deliverAutomationEmail(f.deps);
  const replay=await deliverAutomationEmail(f.deps);
  assert.deepEqual(replay,{status:'sent',email_send_id:'send-1'});
  assert.equal(f.calls(),1);
});
test('timeout is uncertain and replay never resends even after provider TTL',async()=>{
  const f=fixture({timeout:true});
  assert.equal((await deliverAutomationEmail(f.deps)).status,'uncertain');
  assert.equal((await deliverAutomationEmail(f.deps)).retryable,false);
  assert.equal(f.calls(),1);
  assert.equal(f.getState(),'uncertain');
});
test('accepted send with failed ledger is blocked rather than sent twice',async()=>{
  const f=fixture({ledgerFail:true});
  assert.equal((await deliverAutomationEmail(f.deps)).status,'uncertain');
  await deliverAutomationEmail(f.deps);
  assert.equal(f.calls(),1);
});
test('explicit 408, 429 and 5xx responses allow retry with the same provider key',async()=>{
  for(const response of [408,429,500,502,503,504,599]) {
    const f=fixture({response});
    assert.equal((await deliverAutomationEmail(f.deps)).retryable,true);
    await deliverAutomationEmail(f.deps);
    assert.equal(f.calls(),2);
    assert.deepEqual(f.keys,['provider-key-1','provider-key-1']);
  }
});
test('database failure finalizing acceptance leaves original processing claim blocking replay',async()=>{
  const f=fixture({finalizeFail:true});
  assert.equal((await deliverAutomationEmail(f.deps)).status,'uncertain');
  await deliverAutomationEmail(f.deps);
  assert.equal(f.calls(),1);
  assert.equal(f.getState(),'processing');
});
test('duplicate parameter or other 400 response cannot be assumed sent or automatically resent',async()=>{
  const f=fixture({response:400});
  assert.equal((await deliverAutomationEmail(f.deps)).retryable,false);
  await deliverAutomationEmail(f.deps);
  assert.equal(f.calls(),1);
});
test('claim adapter rejects malformed decisions before provider invocation',()=>{
  assert.throws(()=>parseEmailDeliveryClaim({decision:'send'}),InvalidEmailDeliveryClaim);
});
