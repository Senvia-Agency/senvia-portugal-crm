import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import {readMailboxMessage} from './read-mail.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(req.method!=='POST')return json({error:'Método não permitido'},405);
 try {
  const authorization=req.headers.get('Authorization');
  if(!authorization?.startsWith('Bearer '))return json({error:'Sessão necessária'},401);
  const url=Deno.env.get('SUPABASE_URL')!;
  const userClient=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await userClient.auth.getUser();
  if(authError||!user)return json({error:'Sessão inválida'},401);
  const input=await req.json();
  if(typeof input.message_id!=='string'||!/^[0-9a-f-]{36}$/i.test(input.message_id))return json({error:'Mensagem inválida'},400);
  // RLS enforces mailbox membership and MFA before server-side credentials are read.
  const {data:message,error:messageError}=await userClient.from('email_messages')
   .select('id,channel_id,organization_id,folder_id,uid,body_fetched').eq('id',input.message_id).maybeSingle();
  if(messageError||!message)return json({error:'Mensagem indisponível nesta caixa'},404);
  if(message.body_fetched)return json({ok:true,cached:true});
  const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:channel}=await admin.from('messaging_channels').select('metadata').eq('id',message.channel_id).eq('organization_id',message.organization_id).eq('channel_type','email').maybeSingle();
  const {data:secret}=await admin.from('messaging_channel_secrets').select('imap_password').eq('channel_id',message.channel_id).eq('organization_id',message.organization_id).maybeSingle();
  const {data:folder}=await admin.from('email_folders').select('path').eq('id',message.folder_id).eq('channel_id',message.channel_id).eq('organization_id',message.organization_id).maybeSingle();
  if(!channel||!folder||!secret?.imap_password)return json({error:'Configuração IMAP indisponível'},503);
  const m=channel.metadata;
  const body=await readMailboxMessage({host:m.imap_server,port:Number(m.imap_port||993),secure:m.imap_ssl!==false,user:m.imap_login||m.email_address,password:secret.imap_password},folder.path,message.uid);
  const {error:cacheError}=await admin.rpc('cache_email_message_content',{
   _message_id:message.id,_channel_id:message.channel_id,_organization_id:message.organization_id,_uid:message.uid,
   _html:body.html,_text:body.text,_attachments:body.attachments});
  if(cacheError) return json({error:'Não foi possível guardar o conteúdo do email. Tenta novamente.'},503);
  return json({ok:true,cached:false});
 }catch(error){
  const message=error instanceof Error?error.message:'';
  const safe=/^(Esta leitura requer|Este email |Mensagem não encontrada|Mensagem sem conteúdo|Servidor IMAP)/.test(message);
  return json({error:safe?message:'Não foi possível ler o servidor de correio. Tenta novamente dentro de instantes.'},502);
 }
});
