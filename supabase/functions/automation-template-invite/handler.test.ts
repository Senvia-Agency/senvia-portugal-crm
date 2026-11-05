import assert from 'node:assert/strict';
import test from 'node:test';
import {handleTemplateInvite,type TemplateInviteDependencies} from './handler.ts';
const token='ab'.repeat(32);
function request(body:unknown){return new Request('http://localhost/invite',{method:'POST',body:JSON.stringify(body)});}
const defaults:TemplateInviteDependencies={actor:async()=> 'verified-user',token:()=>token,create:async()=> 'invite-id',accept:async()=> 'new-flow'};

test('create stores only a hash and uses verified actor rather than payload actor',async()=>{
  let stored:readonly string[]=[];
  const result=await handleTemplateInvite(request({action:'create',flow_id:'source',actor_id:'spoofed'}),{...defaults,create:async(...args)=>{stored=args;return 'invite-id';}});
  assert.equal(result.status,200);
  assert.equal(stored[1],'verified-user');
  assert.match(stored[2],/^[0-9a-f]{64}$/);
  assert.notEqual(stored[2],token);
  assert.equal((await result.json()).token,token);
});
test('accept sends a hash to atomic importer and always reports a draft',async()=>{
  let accepted:readonly string[]=[];
  const result=await handleTemplateInvite(request({action:'accept',token,organization_id:'destination',status:'active'}),{...defaults,accept:async(...args)=>{accepted=args;return 'new-flow';}});
  assert.equal(result.status,200);
  assert.deepEqual(accepted.slice(1),['destination','verified-user']);
  assert.notEqual(accepted[0],token);
  assert.deepEqual(await result.json(),{flow_id:'new-flow',status:'draft'});
});
test('authentication denial prevents creating or accepting invitations',async()=>{
  let called=false;
  const result=await handleTemplateInvite(request({action:'create',flow_id:'source'}),{...defaults,actor:async()=>new Response(null,{status:403}),create:async()=>{called=true;return 'x';}});
  assert.equal(result.status,403);assert.equal(called,false);
});
test('used expired and unauthorized imports do not reveal database errors',async()=>{
  const result=await handleTemplateInvite(request({action:'accept',token,organization_id:'destination'}),{...defaults,accept:async()=>{throw new Error('database secret payload');}});
  assert.equal(result.status,403);
  assert.doesNotMatch(await result.text(),/database secret/);
});
