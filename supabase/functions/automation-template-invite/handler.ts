export interface TemplateInviteDependencies {
  readonly actor: (request: Request) => Promise<string | Response>;
  readonly create: (flowId: string, actorId: string, tokenHash: string) => Promise<string>;
  readonly accept: (tokenHash: string, organizationId: string, actorId: string) => Promise<string>;
  readonly token: () => string;
}
export const inviteCorsHeaders = {
  'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
  'Content-Type':'application/json',
};
function record(value: unknown): value is Record<string, unknown> { return typeof value==='object' && value!==null && !Array.isArray(value); }
async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
function response(body: unknown,status=200) {return new Response(JSON.stringify(body),{status,headers:inviteCorsHeaders});}
export async function handleTemplateInvite(request: Request,dependencies: TemplateInviteDependencies): Promise<Response> {
  if(request.method==='OPTIONS')return new Response(null,{headers:inviteCorsHeaders});
  if(request.method!=='POST')return response({error:'Método não permitido.'},405);
  const actor=await dependencies.actor(request);
  if(actor instanceof Response)return actor;
  let body: unknown;
  try{body=await request.json();}catch{return response({error:'Pedido inválido.'},400);}
  if(!record(body))return response({error:'Pedido inválido.'},400);
  try{
    if(body.action==='create' && typeof body.flow_id==='string'){
      const token=dependencies.token();
      await dependencies.create(body.flow_id,actor,await hash(token));
      return response({token,expires_in_days:14});
    }
    if(body.action==='accept' && typeof body.token==='string' && /^[0-9a-f]{64}$/.test(body.token) && typeof body.organization_id==='string'){
      const flowId=await dependencies.accept(await hash(body.token),body.organization_id,actor);
      return response({flow_id:flowId,status:'draft'});
    }
    return response({error:'Escolha um modelo ou indique um convite válido.'},400);
  }catch{
    return response({error:'Sem permissão, ou convite inválido, usado ou expirado.'},403);
  }
}
