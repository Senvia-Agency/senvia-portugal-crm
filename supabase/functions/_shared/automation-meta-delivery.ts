export type MetaDeliveryClaim = Readonly<{
  decision:'send'|'sent'|'blocked'; id:string; claim_token:string;
  provider_message_id:string|null; sent_at:string|null; status:string;
}>;
export type MetaDeliveryResult = Readonly<{
  status:'sent'|'retryable'|'review'|'history_pending'; message_id?:string; error?:string;
}>;
export interface MetaDeliveryDependencies {
  readonly claim:()=>Promise<MetaDeliveryClaim>;
  readonly send:()=>Promise<{status:number;messageId?:string}>;
  readonly settle:(claim:MetaDeliveryClaim,status:'sent'|'retryable'|'uncertain',messageId:string|null)=>Promise<{sent_at:string|null}>;
  readonly repairHistory:(messageId:string,sentAt:string)=>Promise<void>;
}
export class InvalidMetaDeliveryClaim extends Error {}
function record(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value);}
export function parseMetaDeliveryClaim(value:unknown):MetaDeliveryClaim {
  if(!record(value)||typeof value.id!=='string'||typeof value.claim_token!=='string'||typeof value.status!=='string'
    ||(value.provider_message_id!==null&&typeof value.provider_message_id!=='string')
    ||(value.sent_at!==null&&typeof value.sent_at!=='string'))throw new InvalidMetaDeliveryClaim('Reserva Meta inválida.');
  const decision=value.decision;
  if(decision!=='send'&&decision!=='sent'&&decision!=='blocked')throw new InvalidMetaDeliveryClaim('Decisão de envio Meta inválida.');
  return {decision,id:value.id,claim_token:value.claim_token,provider_message_id:value.provider_message_id,sent_at:value.sent_at,status:value.status};
}
export async function metaPayloadHash(payload:unknown):Promise<string>{
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function deliverMetaTemplate(deps:MetaDeliveryDependencies):Promise<MetaDeliveryResult>{
  const claim=await deps.claim();
  if(claim.decision==='blocked')return {status:'review',error:'Envio Meta já iniciado ou por confirmar. Requer revisão manual antes de repetir.'};
  let messageId=claim.provider_message_id;
  let sentAt=claim.sent_at;
  if(claim.decision==='send'){
    try{
      const response=await deps.send();
      if(response.status===408||response.status===429||(response.status>=500&&response.status<=599)){
        await deps.settle(claim,'retryable',null);
        return {status:'retryable',error:`Meta HTTP ${response.status}: o pedido foi rejeitado.`};
      }
      if(response.status<200||response.status>=300||!response.messageId){
        await deps.settle(claim,'uncertain',null);
        return {status:'review',error:'A Meta não confirmou o envio. Requer revisão manual antes de repetir.'};
      }
      messageId=response.messageId;
      const saved=await deps.settle(claim,'sent',messageId);
      sentAt=saved.sent_at;
    }catch{
      try{await deps.settle(claim,'uncertain',null);}catch{return {status:'review',error:'Envio Meta por confirmar; reserva mantida. Requer revisão manual.'};}
      return {status:'review',error:'Resultado do envio Meta desconhecido. Requer revisão manual antes de repetir.'};
    }
  }
  if(!messageId||!sentAt)return {status:'review',error:'Identificador Meta não confirmado. Requer revisão manual.'};
  try{await deps.repairHistory(messageId,sentAt);}
  catch{return {status:'history_pending',message_id:messageId,error:'Envio Meta confirmado; histórico por recuperar. Repetir recupera o histórico sem reenviar.'};}
  return {status:'sent',message_id:messageId};
}
