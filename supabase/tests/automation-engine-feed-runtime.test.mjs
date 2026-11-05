import assert from 'node:assert/strict';
import test from 'node:test';
import {runtime,database,fixture} from './automation-engine-runtime-harness.mjs';
function setup(config){
  const node={id:'feed',type:'publish_feed',config};const {run,flow}=fixture([node]);
  const db=database(run,flow);const {Engine}=runtime();return {node,run,flow,db,execute:()=>new Engine(db).execute(run,flow,node)};
}
test('Feed renders plain text and publishes same run and visit through service RPC',async()=>{
  const s=setup({title:'Olá {{nome}}',message:'Contacto: {{email}} <texto literal>'});s.run.context.__node_visits={feed:2};
  let request;s.db.rpc=async(name,params)=>{request={name,params};return {data:{post_id:'post'},error:null};};
  const result=await s.execute();assert.equal(result.kind,'next');assert.equal(result.detail.post_id,'post');
  assert.equal(request.name,'publish_automation_feed_post');assert.equal(request.params.p_org_id,'org');assert.equal(request.params.p_run_id,'run');
  assert.equal(request.params.p_node_id,'__visit:feed:2');assert.equal(request.params.p_title,'Olá Ana');assert.equal(request.params.p_body,'Contacto: a@example.test <texto literal>');
});
for(const config of [{message:' '},{title:'x'.repeat(121),message:'corpo'},{message:'x'.repeat(4001)}]){
  test(`Feed rejects empty or oversized content before publishing (${JSON.stringify(config).length})`,async()=>{
    const s=setup(config);s.db.rpc=async()=>{throw new Error('Must not publish');};assert.equal((await s.execute()).kind,'fail');
  });
}
test('Feed supports message only and fails explicitly when database rejects publication',async()=>{
  const s=setup({message:'Atualização'});s.db.rpc=async(_name,params)=>{assert.equal(params.p_title,null);return {data:null,error:{message:'denied'}};};
  const result=await s.execute();assert.equal(result.kind,'fail');assert.match(result.error,/Feed da organização/);
});
