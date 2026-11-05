import assert from 'node:assert/strict';
import test from 'node:test';
import { executeAutomationHttpAction } from './automation-http-action.ts';
const variables = { nome: 'Ana "Silva"', destino: 'api.example.test', token: 'abc' };
const legacy = { run_id: 'run', flow_id: 'flow', contact: variables };
const resolve = async () => ['93.184.216.34'];
test('configured method headers and JSON body render safely before outbound request', async () => {
  const result = await executeAutomationHttpAction({ url:'https://{{destino}}/event', method:'PATCH', headers:'{"X-Key":"{{token}}"}', body:'{"name":"{{nome}}","count":2}' }, variables, legacy, { resolve, fetch: async (url, options) => {
    assert.equal(String(url), 'https://api.example.test/event'); assert.equal(options?.method, 'PATCH');
    assert.equal(new Headers(options?.headers).get('X-Key'), 'abc'); assert.equal(options?.redirect, 'manual');
    assert.ok(options?.signal instanceof AbortSignal); assert.deepEqual(JSON.parse(String(options?.body)), {name:'Ana "Silva"', count:2});
    return new Response(null, {status:204});
  }});
  assert.equal(result.kind, 'next');
});
test('legacy POST keeps its payload while GET omits a body', async () => {
  for (const method of ['POST','GET']) await executeAutomationHttpAction({url:'https://example.test',method}, variables, legacy, {resolve, fetch:async (_url, options)=>{
    assert.equal(options?.body, method === 'GET' ? undefined : JSON.stringify(legacy)); return new Response(null,{status:200});
  }});
});
test('unsafe literal targets and resolved private addresses never fetch', async () => {
  for (const url of ['http://localhost','http://127.1','http://10.1.1.1','http://169.254.169.254','http://[::1]','http://[::ffff:127.0.0.1]','http://[fc00::1]','http://user:pass@example.test','file:///a']) {
    let calls=0;
    const result=await executeAutomationHttpAction({url}, {}, legacy, {resolve,fetch:async()=>{calls++;return new Response();}});
    assert.equal(result.kind,'fail',url);
    assert.equal(calls,0,url);
  }
  let fetched=false;
  const result=await executeAutomationHttpAction({url:'https://example.test'}, {}, legacy, {resolve:async()=>['93.184.216.34','192.168.1.2'],fetch:async()=>{fetched=true;return new Response();}});
  assert.equal(result.kind,'fail'); assert.equal(fetched,false);
});
test('redirects non-success HTTP and timeout are bounded failures', async () => {
  for (const status of [302,429,503]) {
    const result=await executeAutomationHttpAction({url:'https://example.test'}, {}, legacy, {resolve,fetch:async()=>new Response(null,{status})});
    assert.equal(result.kind,'fail'); if(result.kind==='fail')assert.match(result.error,new RegExp(`HTTP ${status}`));
  }
  const result=await executeAutomationHttpAction({url:'https://example.test'}, {}, legacy, {resolve,signal:()=>AbortSignal.abort(new DOMException('timeout','TimeoutError')),fetch:async()=>{throw new Error('must not fetch');}});
  assert.equal(result.kind,'fail'); if(result.kind==='fail')assert.match(result.error,/timeout/i);
});
test('invalid config rejects methods headers JSON and missing variables before fetch', async () => {
  for(const config of [{method:'DELETE'},{headers:'[]'},{headers:'{"X":"a\r\nb"}'},{body:'{"x":}'},{url:'https://{{missing}}/'}]){
    let calls=0;
    const result=await executeAutomationHttpAction({url:'https://example.test',...config}, {}, legacy,{resolve,fetch:async()=>{calls++;return new Response();}});
    assert.equal(result.kind,'fail');
    assert.equal(calls,0);
  }
});
test('unresponsive DNS and fetch terminate at the shared deadline without real requests', async () => {
  for(const stalled of ['dns','fetch']) {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(new DOMException('deadline','TimeoutError')),5);
    const result=await executeAutomationHttpAction({url:'https://example.test'}, {}, legacy, {
      signal:()=>controller.signal,
      resolve:stalled==='dns' ? ()=>new Promise(()=>{}) : resolve,
      fetch:()=>new Promise(()=>{}),
    });
    clearTimeout(timer); assert.equal(result.kind,'fail'); if(result.kind==='fail')assert.match(result.error,/timeout/i);
  }
});
test('public IPv6 and mixed public A AAAA records are accepted', async () => {
  for(const addresses of [['2001:4860:4860::8888'],['93.184.216.34','2001:4860:4860::8888']]) {
    let calls=0;
    const result=await executeAutomationHttpAction({url:'https://example.test'}, {}, legacy, {resolve:async()=>addresses,fetch:async()=>{calls++;return new Response(null,{status:204});}});
    assert.equal(result.kind,'next'); assert.equal(calls,1);
  }
});
test('private and special-purpose IPv6 DNS answers fail before fetch', async () => {
  for(const address of ['::1','fc00::1','fe80::1','2001:db8::1','2001:0db8::1','2001:0000:4136:e378::1','2001:2::1','2001:20::1','2002:a00:1::1','::ffff:10.0.0.1']) {
    let calls=0;
    const result=await executeAutomationHttpAction({url:'https://example.test'}, {}, legacy, {resolve:async()=>['93.184.216.34',address],fetch:async()=>{calls++;return new Response();}});
    assert.equal(result.kind,'fail',address); assert.equal(calls,0,address);
  }
});
