import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
async function check({organization_id='org_B', member=true, memberships=['org_A','org_B']}={}) {
  const writes=[], calls=[]; let handler;
  const db={auth:{getUser:async()=>({data:{user:{id:'shared_user',email:'shared@example.invalid'}}})},rpc:async(name)=>({data:name==='is_org_member'?member:false}),from(table){
    let write;
    const query={select(){return this},eq(k,v){if(write)write.filters.push([k,v]);return this},limit(){return this},is(){return this},update(value){write={value,filters:[]};writes.push(write);return this},
      async maybeSingle(){return {data:table==='organization_billing_accounts'?{stripe_customer_id:'cus_B',stripe_subscription_id:'sub_B'}:{plan:'starter',billing_exempt:false,first_paid_at:null}}},
      then(resolve){return Promise.resolve(table==='organization_members'?{data:memberships.map(organization_id=>({organization_id})),count:2}:{data:null}).then(resolve)}};return query;
  }};
  const sub={id:'sub_B',customer:'cus_B',status:'active',items:{data:[{current_period_end:1800000000,price:{id:'base',product:'prod_U0wAc7Tuy8w6gA'}}]}};
  const source=fs.readFileSync(new URL('../functions/check-subscription/index.ts',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports:{},console:{log(){},error(){}},Request,Response,URL,Date,Deno:{env:{get:()=> 'fixture'}},
    fetch:async(url)=>{calls.push(String(url));return new Response(JSON.stringify(sub))},
    require(id){if(id.includes('server.ts'))return {serve:fn=>handler=fn};if(id.includes('supabase-js'))return {createClient:()=>db};if(id.includes('user-authorization'))return {requestMfaResponse:async()=>null};throw Error(id)}});
  const response=await handler(new Request('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({organization_id})}));
  return {response,body:await response.json(),writes,calls};
}
test('subscription check uses selected tenant B and never searches shared email',async()=>{const r=await check();assert.equal(r.response.status,200);assert.equal(r.calls.length,1);assert.ok(r.calls[0].endsWith('/subscriptions/sub_B'));assert.equal(r.body.first_paid_at,null);assert.ok(r.writes.every(w=>!('first_paid_at' in w.value)&&w.filters.some(([k,v])=>k==='id'&&v==='org_B')))});
test('subscription check refuses another organization before contacting Stripe',async()=>{const r=await check({member:false});assert.equal(r.response.status,403);assert.equal(r.calls.length,0);assert.equal(r.writes.length,0)});
test('legacy request from a multi-organization user must select an organization',async()=>{const r=await check({organization_id:null});assert.equal(r.response.status,400);assert.equal(r.calls.length,0)});
