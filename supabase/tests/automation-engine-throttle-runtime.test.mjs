import assert from 'node:assert/strict';
import test from 'node:test';
import {runtime,database,fixture} from './automation-engine-runtime-harness.mjs';
function setup(type='send_whatsapp', config={message:'Olá'}) {
  const node={id:'send',type,config};const {run,flow}=fixture([node]);
  run.contact_phone='+351912345678';run.contact_phone_key='912345678';
  const db=database(run,flow);const calls=[];const {Engine}=runtime(()=>{throw new Error('No provider access');});
  const engine=new Engine(db);engine.whatsappChannel=async()=>({id:'channel',instance:'test'});
  engine.sendWhatsapp=async()=>{calls.push('send');return {messageId:'message'};};
  return {node,run,flow,db,engine,calls};
}
test('actual send reserves own organization run and visit before provider',async()=>{
  const {node,run,flow,db,engine,calls}=setup();
  run.context.__node_visits={send:2};
  let request;
  db.rpc=async(name,params)=>{request={name,params};calls.push('reserve');return {data:{ready:true,claim_token:"token"},error:null};};
  const result=await engine.execute(run,flow,node);
  assert.equal(result.kind,'next');assert.deepEqual(calls,['reserve','send']);
  assert.equal(request.name,'reserve_automation_whatsapp_send');
  assert.equal(request.params.p_org_id,run.organization_id);assert.equal(request.params.p_run_id,run.id);
  assert.equal(request.params.p_channel_id,'channel');assert.equal(request.params.p_visit_key,'__visit:send:2');
});
test('future reservation parks and resume submits same visit key before sending',async()=>{
  const {node,run,flow,db,engine,calls}=setup();const keys=[];
  db.rpc=async(_name,params)=>{keys.push(params.p_visit_key);return {data:keys.length===1?{ready:false,wait_until:'2026-11-04T10:00:06Z'}:{ready:true,claim_token:"token"},error:null};};
  const first=await engine.execute(run,flow,node);
  assert.equal(first.kind,'park');assert.equal(first.resumeSelf,true);assert.equal(first.wakeAt.toISOString(),'2026-11-04T10:00:06.000Z');assert.deepEqual(calls,[]);
  assert.equal((await engine.execute(run,flow,node)).kind,'next');assert.equal(keys[0],keys[1]);assert.deepEqual(calls,['send']);
});
for(const response of [{data:null,error:{message:'database unavailable'}},{data:{ready:false,wait_until:'invalid'},error:null}]) {
  test(`reservation ${response.error?'database error':'invalid timestamp'} fails before provider`,async()=>{
    const {node,run,flow,db,engine,calls}=setup();db.rpc=async()=>response;
    const result=await engine.execute(run,flow,node);assert.equal(result.kind,'fail');assert.deepEqual(calls,[]);
  });
}
test('wait reply without question sends nothing and takes no reservation',async()=>{
  const {node,run,flow,db,engine,calls}=setup('wait_reply',{question:'',timeout_amount:1,timeout_unit:'hours'});
  db.rpc=async()=>{throw new Error('Must not reserve');};
  const result=await engine.execute(run,flow,node);assert.equal(result.kind,'park');assert.equal(result.status,'awaiting_reply');assert.deepEqual(calls,[]);
});
function delivery(provider,{finalizeFails=false,configured=true}={}) {
  const node={id:'send',type:'send_whatsapp',config:{message:'Olá'}};const {run,flow}=fixture([node]);
  run.contact_phone='+351912345678';run.contact_phone_key='912345678';
  const db=database(run,flow);let state='reserved',messageId=null,providerCalls=0,retryAt=0,clock;const outcomes=[];
  db.rpc=async(name,params)=>{
    if(name==='reserve_automation_whatsapp_send') {
      if(state==='sent')return {data:{replay_message_id:messageId},error:null};
      if(['processing','uncertain'].includes(state))return {data:{review_required:true},error:null};
      if(state==='retryable' && clock.time<retryAt)return {data:{ready:false,wait_until:new Date(retryAt).toISOString()},error:null};
      state='processing';return {data:{ready:true,claim_token:'token'},error:null};
    }
    assert.equal(name,'finalize_automation_whatsapp_send');outcomes.push(params.p_state);
    if(finalizeFails)return {data:null,error:{message:'unavailable'}};
    state=params.p_state;messageId=params.p_message_id;if(state==='retryable')retryAt=clock.time+6000;return {data:{saved:true},error:null};
  };
  const rt=runtime(async()=>{providerCalls++;return await provider();},{Deno:{env:{get:key=>!configured?'':key==='EVOLUTION_API_URL'?'https://example.test':'test-secret'}},AbortSignal,URL});
  const {Engine}=rt;clock=rt.clock;
  const engine=new Engine(db);engine.whatsappChannel=async()=>({id:'channel',instance:'test'});
  return {execute:()=>engine.execute(run,flow,node),calls:()=>providerCalls,state:()=>state,outcomes,fixConfiguration:()=>{configured=true;},elapse:ms=>{clock.time+=ms;}};
}
test('provider accepted but lost finalization leaves processing and blocks repeat',async()=>{
  const d=delivery(async()=>({ok:true,status:200,json:async()=>({key:{id:'accepted'}})}),{finalizeFails:true});
  assert.equal((await d.execute()).kind,'fail');assert.equal(d.calls(),1);assert.equal(d.state(),'processing');
  assert.equal((await d.execute()).kind,'fail');assert.equal(d.calls(),1);
});
test('network response lost is uncertain and cannot automatically resend',async()=>{
  const d=delivery(async()=>{throw new Error('timeout after acceptance');});
  assert.equal((await d.execute()).kind,'fail');assert.equal(d.state(),'uncertain');
  assert.equal((await d.execute()).kind,'fail');assert.equal(d.calls(),1);
});
test('successful finalized message replays without sending twice',async()=>{
  const d=delivery(async()=>({ok:true,status:200,json:async()=>({key:{id:'accepted'}})}));
  assert.equal((await d.execute()).kind,'next');assert.equal(d.state(),'sent');
  assert.equal((await d.execute()).kind,'next');assert.equal(d.calls(),1);
});
test('success response without provider identifier requires review',async()=>{
  const d=delivery(async()=>({ok:true,status:200,json:async()=>({})}));
  assert.equal((await d.execute()).kind,'fail');assert.equal(d.state(),'uncertain');
  assert.equal((await d.execute()).kind,'fail');assert.equal(d.calls(),1);
});
test('definite HTTP rejection marks reservation retryable',async()=>{
  const d=delivery(async()=>({ok:false,status:429,json:async()=>({error:'rate limit'})}));
  const result=await d.execute();assert.equal(result.kind,'fail');assert.equal(d.state(),'retryable');assert.deepEqual(d.outcomes,['retryable']);
});
test('missing configuration never sends and permits same visit after fixing configuration and gap',async()=>{
  const d=delivery(async()=>({ok:true,status:200,json:async()=>({key:{id:'accepted'}})}),{configured:false});
  const missing=await d.execute();assert.equal(missing.kind,'fail');assert.match(missing.error,/não configurada/);
  assert.equal(d.calls(),0);assert.equal(d.state(),'retryable');
  d.fixConfiguration();assert.equal((await d.execute()).kind,'park');assert.equal(d.calls(),0);
  d.elapse(6000);assert.equal((await d.execute()).kind,'next');assert.equal(d.calls(),1);assert.equal(d.state(),'sent');
});
