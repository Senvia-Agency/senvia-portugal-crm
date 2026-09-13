import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
async function run({allowed=true,stripeFails=false,quantity=2}={}) {
 let handler;const writes=[],requests=[];
 const db={auth:{getUser:async()=>({data:{user:{id:'u'}}})},rpc:async()=>({data:allowed}),from(table){const q={select(){return this},eq(){return this},async single(){return {data:{plan:'starter',extra_seats:1}}},async maybeSingle(){return {data:{stripe_customer_id:'cus_B',stripe_subscription_id:'sub_B'}}},update(value){writes.push(value);return this},then(resolve){return Promise.resolve({error:null}).then(resolve)}};return q}};
 const source=fs.readFileSync(new URL('../functions/buy-extra-seats/index.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports:{},console:{log(){},error(){}},Request,Response,URLSearchParams,Deno:{env:{get:()=> 'fixture'}},fetch:async(url,options)=>{requests.push({url,method:options.method});if(options.method==='GET')return new Response(JSON.stringify({id:'sub_B',customer:'cus_B',status:'active',items:{data:[{id:'si_B',price:{id:'price_1TncdBLWnA81DzXTh3crx8iN'}}]}}));return new Response(JSON.stringify(stripeFails?{error:{message:'declined'}}:{}),{status:stripeFails?402:200})},require(id){if(id.includes('server.ts'))return {serve:fn=>handler=fn};if(id.includes('supabase-js'))return {createClient:()=>db};if(id.includes('user-authorization'))return {requestMfaResponse:async()=>null};throw Error(id)}});
 const response=await handler(new Request('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({organization_id:'org_B',quantity})}));return {response,writes,requests};
}
test('seat billing uses bound subscription and stores quantity after Stripe success',async()=>{const r=await run();assert.equal(r.response.status,200);assert.ok(r.requests[0].url.endsWith('/subscriptions/sub_B'));assert.equal(r.writes[0].extra_seats,2)});
test('seat billing failure does not grant the requested seats',async()=>{const r=await run({stripeFails:true});assert.equal(r.response.status,500);assert.equal(r.writes.length,0)});
test('seat billing rejects non-admin access and fractional quantities before Stripe',async()=>{for(const options of [{allowed:false},{quantity:1.5}]){const r=await run(options);assert.ok([400,403].includes(r.response.status));assert.equal(r.requests.length,0);assert.equal(r.writes.length,0)}});
