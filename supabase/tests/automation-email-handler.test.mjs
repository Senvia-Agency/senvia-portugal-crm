import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';
import * as delivery from '../functions/_shared/automation-email-delivery.ts';
import * as correlation from '../functions/_shared/automation-email-correlation.ts';
import * as rendering from '../functions/_shared/automation-email-template.ts';
import * as shell from '../functions/_shared/senvia-email-template.ts';
const runId='01234567-89ab-cdef-0123-456789abcdef';
const compiled=ts.transpileModule(readFileSync(new URL('../functions/send-template-email/index.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;

function fixture({timeout=false,ledgerFail=false,responseStatus=201,browser=false,localAssignedTo="vendor-a"}={}) {
  let handler;
  let state='new';
  let savedId=null;
  const calls=[];
  const ledgers=[];
  const tokens=[];
  function query(table) {
    let inserted;
    let single = false;
    const filters=[];
    const builder={
      select(){return builder;},eq(key,value){filters.push([key,value,false]);return builder;},in(key,value){filters.push([key,value,true]);return builder;},
      insert(value){inserted=value;return builder;},update(){return builder;},
      single(){single=true;return Promise.resolve(result());},maybeSingle(){single=true;return Promise.resolve(result());},
      then(resolve,reject){return Promise.resolve(result()).then(resolve,reject);},
    };
    function selectRows(rows) {
      const matching=rows.filter(row=>filters.every(([key,value,isList])=>isList?value.includes(row[key]):row[key]===value));
      return {data:single?matching[0]??null:matching,error:null};
    }
    function result() {
      if(table==='automation_runs')return {data:{organization_id:'org-a',status:'running'},error:null};
      if(table==='organizations')return {data:{name:'Example',brevo_api_key:'fixture-only',brevo_sender_email:'sender@example.test'},error:null};
      if(table==='crm_clients')return selectRows([
        {id:'client-a',organization_id:'org-a',assigned_to:localAssignedTo},
        {id:'client-b',organization_id:'org-b',assigned_to:'vendor-b'},
      ]);
      if(table==='organization_members')return selectRows([
        {organization_id:'org-a',user_id:'user-a',is_active:true},
        {organization_id:'org-a',user_id:'vendor-a',is_active:true},
        {organization_id:'org-a',user_id:'vendor-inactive',is_active:false},
        {organization_id:'org-b',user_id:'vendor-b',is_active:true},
      ]);
      if(table==='profiles')return selectRows([
        {id:'user-a',full_name:'Sender'},
        {id:'vendor-a',full_name:'Local Vendor',email:'local-vendor@example.test',phone:'111111111'},
        {id:'vendor-b',full_name:'Foreign Secret',email:'foreign-secret@example.test',phone:'999999999'},
        {id:'vendor-inactive',full_name:'Inactive Secret',email:'inactive-secret@example.test',phone:'888888888'},
      ]);
      if(table==='marketing_contacts')return {data:{id:'contact-1'},error:null};
      if(table==='email_unsubscribe_tokens'){if(inserted)tokens.push(inserted);return {data:null,error:null};}
      if(table==='email_sends'){
        if(ledgerFail)return {data:null,error:{message:'ledger unavailable'}};
        ledgers.push(inserted);return {data:{id:'email-send-1'},error:null};
      }
      throw new Error(`Unexpected table ${table}`);
    }
    return builder;
  }
  const client={
    from:query,auth:{getUser:async()=>({data:{user:browser?{id:'user-a'}:null},error:null})},
    rpc:async(name,args)=>{
      if(name==='claim_automation_email_delivery'){
        const decision=state==='new'||state==='failed_retryable'?'send':state==='sent'?'sent':'blocked';
        if(decision==='send')state='processing';
        return {data:{decision,delivery_id:'delivery-1',claim_token:'claim-1',idempotency_key:'uuid-key-1',email_send_id:savedId,status:state},error:null};
      }
      if(name==='finalize_automation_email_delivery'){
        state=args.p_status;savedId=args.p_email_send_id;return {data:null,error:null};
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  vm.runInNewContext(compiled,{
    exports:{},Request,Response,AbortController,crypto,Date,setTimeout,clearTimeout,URL,console:{log(){},error(){}},
    Deno:{env:{get:name=>name==='SUPABASE_SERVICE_ROLE_KEY'?'service-fixture':'https://database.invalid'}},
    fetch:async(url,init)=>{
      calls.push({url,body:JSON.parse(init.body)});
      if(timeout)throw new DOMException('Timed out','TimeoutError');
      return new Response(JSON.stringify(responseStatus===201?{messageId:'provider-message-1'}:{code:responseStatus===400?'duplicate_parameter':'rejected'}),{status:responseStatus});
    },
    require:name=>{
      if(name.includes('supabase-js'))return {createClient:()=>client};
      if(name.includes('/http/server'))return {serve:callback=>{handler=callback;}};
      if(name.endsWith('automation-email-delivery.ts'))return delivery;
      if(name.endsWith('automation-email-correlation.ts'))return correlation;
      if(name.endsWith('automation-email-template.ts'))return rendering;
      if(name.endsWith('senvia-email-template.ts'))return shell;
      if(name.endsWith('user-authorization.ts'))return {requestMfaResponse:async()=>null};
      throw new Error(`Unexpected import ${name}`);
    },
  });
  async function invoke({manual=false,unsubscribe=false,clientId,customHtml}={}) {
    const response=await handler(new Request('https://sender.invalid',{
      method:'POST',headers:{Authorization:browser?'Bearer user-fixture':'Bearer service-fixture','Content-Type':'application/json'},
      body:JSON.stringify({organizationId:'org-a',recipients:[{email:'recipient@example.test',name:'<img src=x onerror=1>',...(clientId?{clientId}:{})}],
        subject:'Welcome {{nome}}',htmlContent:(customHtml??'<p>{{nome}}</p>')+(unsubscribe?'<a href="{{unsubscribe}}">Stop</a>':''),
        ...(!manual?{automationRunId:runId,automationNodeId:'email-1'}:{}),
      }),
    }));
    return {status:response.status,body:await response.json()};
  }
  return {invoke,calls,ledgers,tokens};
}

test('real sender handler replays a correlated success without another provider call',async()=>{
  const f=fixture();
  const first=await f.invoke();const again=await f.invoke();
  assert.equal(first.body.results[0].status,'sent');
  assert.equal(again.body.results[0].email_send_id,'email-send-1');
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].body.headers.idempotencyKey,'uuid-key-1');
  assert.equal(f.ledgers[0].automation_run_id,runId);
});
test('real sender handler cannot resend after a timeout or accepted delivery with ledger failure',async()=>{
  for(const options of [{timeout:true},{ledgerFail:true}]){
    const f=fixture(options);
    assert.equal((await f.invoke()).body.results[0].status,'uncertain');
    await f.invoke();assert.equal(f.calls.length,1);
  }
});
test('real handler preserves HTML escaping and resolves signed unsubscribe URL before provider',async()=>{
  const f=fixture();await f.invoke({unsubscribe:true});
  assert.ok(f.calls[0].body.htmlContent.includes('&lt;img src=x onerror=1&gt;'));
  assert.ok(!f.calls[0].body.htmlContent.includes('<img src=x onerror=1>'));
  assert.ok(f.calls[0].body.htmlContent.includes('https://app.senvia.pt/unsubscribe?token='));
  assert.ok(!f.calls[0].body.htmlContent.includes('{{unsubscribe}}'));
  assert.equal(f.tokens.length,1);
});
test('manual email path remains independent of automation claims',async()=>{
  const f=fixture();await f.invoke({manual:true});await f.invoke({manual:true});
  assert.equal(f.calls.length,2);
  assert.equal(f.calls[0].body.headers,undefined);
});
test('explicit 408, 429 and 5xx responses are retryable through the real handler',async()=>{
  for(const responseStatus of [408,429,500,502,503,504]) {
    const f=fixture({responseStatus});
    assert.equal((await f.invoke()).body.results[0].retryable,true);
    await f.invoke();assert.equal(f.calls.length,2);
  }
});
test('concurrent real handler requests reserve one provider effect',async()=>{
  const f=fixture();
  const results=await Promise.all([f.invoke(),f.invoke()]);
  assert.equal(f.calls.length,1);
  assert.deepEqual(results.map(r=>r.body.results[0].status).sort(),['processing','sent']);
});
test('duplicate-parameter HTTP 400 without a confirmed local ledger requires review',async()=>{
  const f=fixture({responseStatus:400});
  const first=await f.invoke();
  assert.equal(first.body.results[0].status,'uncertain');
  assert.equal(first.body.results[0].retryable,false);
  await f.invoke();
  assert.equal(f.calls.length,1);
  assert.equal(f.ledgers.length,0);
});
test('browser member of organization A cannot resolve a client from organization B',async()=>{
  const f=fixture({browser:true});
  const result=await f.invoke({manual:true,clientId:'client-b',customHtml:'<p>{{vendedor}} {{vendedor_email}} {{vendedor_telefone}}</p>'});
  assert.equal(result.status,403);
  assert.equal(f.calls.length,0);
  assert.equal(f.ledgers.length,0);
});
test('stale foreign or inactive client assignee cannot enter a browser email payload',async()=>{
  for(const localAssignedTo of ['vendor-b','vendor-inactive']){
    const f=fixture({browser:true,localAssignedTo});
    const result=await f.invoke({manual:true,clientId:'client-a',customHtml:'<p>{{vendedor}} {{vendedor_email}} {{vendedor_telefone}}</p>'});
    assert.equal(result.status,200);
    assert.equal(f.calls.length,1);
    const body=JSON.stringify(f.calls[0].body);
    assert.ok(!body.includes('foreign-secret'));
    assert.ok(!body.includes('inactive-secret'));
    assert.ok(!body.includes('999999999'));
    assert.ok(!body.includes('888888888'));
  }
});
test('active vendor in the same organization remains available to the browser email',async()=>{
  const f=fixture({browser:true});
  await f.invoke({manual:true,clientId:'client-a',customHtml:'<p>{{vendedor_email}}</p>'});
  assert.ok(f.calls[0].body.htmlContent.includes('local-vendor@example.test'));
});
