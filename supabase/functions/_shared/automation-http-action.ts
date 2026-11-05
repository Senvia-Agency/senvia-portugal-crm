import { renderAutomationTemplate } from './automation-template.ts';

type Outcome = { kind: 'next'; detail: { url: string; status: number } } | { kind: 'fail'; error: string };
interface Dependencies {
  readonly fetch?: typeof fetch;
  readonly resolve?: (host: string) => Promise<readonly string[]>;
  readonly signal?: () => AbortSignal;
}
class InvalidHttpAction extends Error {}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function publicAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (ip.includes(':')) {
    let canonical: string;
    try { canonical=new URL(`http://[${ip}]`).hostname.replace(/^\[|\]$/g,''); } catch { return false; }
    const [prefix,subnet,site]=canonical.split(':').map(part=>parseInt(part || '0',16));
    if(prefix<0x2000 || prefix>0x3fff || prefix===0x2002 || prefix===0x3ffe)return false;
    if(prefix===0x3fff && subnet<0x1000)return false;
    if(prefix===0x2001 && (subnet===0 || subnet===0xdb8 || (subnet===2 && site===0) || (subnet>=0x10 && subnet<=0x2f)))return false;
    return true;
  }
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const [a,b,c,d] = ip.split('.').map(Number);
  return [a,b,c,d].every(part=>part>=0 && part<=255) && a!==0 && a!==10 && a!==127 && a<224
    && !(a===100 && b>=64 && b<=127) && !(a===169 && b===254) && !(a===172 && b>=16 && b<=31)
    && !(a===192 && (b===168 || b===0 || (b===88 && c===99))) && !(a===198 && (b===18 || b===19 || (b===51 && c===100)))
    && !(a===203 && b===0 && c===113);
}
async function resolvePublic(host: string): Promise<readonly string[]> {
  const results = await Promise.allSettled([Deno.resolveDns(host, 'A'), Deno.resolveDns(host, 'AAAA')]);
  return results.flatMap(result=>result.status==='fulfilled' ? result.value : []);
}
async function bounded<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return await new Promise<T>((resolve,reject)=>{
    const abort=()=>reject(signal.reason);
    signal.addEventListener('abort',abort,{once:true});
    operation.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
function render(value: string, variables: Readonly<Record<string, unknown>>): string {
  const result=renderAutomationTemplate(value,variables);
  if(result.invalid.length || result.missing.length) throw new InvalidHttpAction('Webhook contém variáveis inválidas ou sem valor.');
  return result.text;
}
function jsonObject(value: unknown, label: string): Record<string, unknown> {
  let parsed: unknown=value;
  if(typeof value==='string') { try { parsed=JSON.parse(value); } catch { throw new InvalidHttpAction(`Webhook ${label}: indique um objeto JSON válido.`); } }
  if(!object(parsed))throw new InvalidHttpAction(`Webhook ${label}: indique um objeto JSON válido.`);
  return parsed;
}
function renderJson(value: unknown, variables: Readonly<Record<string, unknown>>): unknown {
  if(typeof value==='string')return render(value,variables);
  if(Array.isArray(value))return value.map(item=>renderJson(item,variables));
  if(object(value))return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,renderJson(item,variables)]));
  return value;
}
export async function executeAutomationHttpAction(
  config: Readonly<Record<string, unknown>>,
  variables: Readonly<Record<string, unknown>>,
  legacyPayload: Readonly<Record<string, unknown>>,
  dependencies: Dependencies = {},
): Promise<Outcome> {
  try {
    const method=String(config.method ?? 'POST').toUpperCase();
    if(!['GET','POST','PUT','PATCH'].includes(method))throw new InvalidHttpAction('Webhook: método HTTP inválido.');
    let url: URL;
    try { url=new URL(render(String(config.url ?? ''),variables)); } catch(error) {
      if(error instanceof InvalidHttpAction)throw error;
      throw new InvalidHttpAction('Webhook: indique um URL público http ou https válido.');
    }
    const host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
    if(!['http:','https:'].includes(url.protocol) || url.username || url.password || !host || host==='localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal'))throw new InvalidHttpAction('Webhook: destino privado ou URL não permitido.');
    const literal=host.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(host);
    if(literal && !publicAddress(host))throw new InvalidHttpAction('Webhook: destino privado ou reservado não permitido.');
    const headers=new Headers({'Content-Type':'application/json'});
    if(config.headers!==undefined && config.headers!=='')for(const [key,value] of Object.entries(jsonObject(config.headers,'cabeçalhos'))) {
      if(typeof value!=='string' || /^(host|content-length|connection|transfer-encoding)$/i.test(key))throw new InvalidHttpAction('Webhook: cabeçalhos inválidos ou reservados.');
      headers.set(key,render(value,variables));
    }
    const body=method==='GET' ? undefined : JSON.stringify(config.body===undefined || config.body==='' ? legacyPayload : renderJson(jsonObject(config.body,'corpo'),variables));
    const signal=dependencies.signal?.() ?? AbortSignal.timeout(30_000);
    signal.throwIfAborted();
    const addresses=literal ? [host] : await bounded((dependencies.resolve ?? resolvePublic)(host),signal);
    if(!addresses.length || addresses.some(address=>!publicAddress(address)))throw new InvalidHttpAction('Webhook: DNS sem destino público permitido.');
    const response=await bounded((dependencies.fetch ?? fetch)(url.toString(),{method,headers,body,signal,redirect:'manual'}),signal);
    if(response.body)await bounded(response.body.cancel(),signal);
    if(!response.ok)return {kind:'fail',error:`Webhook HTTP ${response.status}`};
    return {kind:'next',detail:{url:url.origin+url.pathname,status:response.status}};
  } catch(error) {
    if(error instanceof DOMException && (error.name==='TimeoutError' || error.name==='AbortError'))return {kind:'fail',error:'Webhook timeout após 30 segundos.'};
    if(error instanceof InvalidHttpAction)return {kind:'fail',error:error.message};
    return {kind:'fail',error:'Webhook falhou: não foi possível concluir o pedido HTTP.'};
  }
}
