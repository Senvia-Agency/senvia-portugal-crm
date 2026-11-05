import { createClient } from 'npm:@supabase/supabase-js@2.57.2';
import { requestMfaResponse } from '../_shared/user-authorization.ts';
import { handleTemplateInvite, inviteCorsHeaders } from './handler.ts';

Deno.serve(async (request: Request) => {
  const db=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{auth:{persistSession:false}});
  return handleTemplateInvite(request,{
    actor:async req=>{
      const bearer=(req.headers.get('authorization')??'').replace(/^Bearer\s+/i,'');
      const {data,error}=await db.auth.getUser(bearer);
      if(error || !data.user)return new Response(JSON.stringify({error:'Não autorizado.'}),{status:401,headers:inviteCorsHeaders});
      const denial=await requestMfaResponse(req,data.user.id,inviteCorsHeaders);
      return denial??data.user.id;
    },
    token:()=>[...crypto.getRandomValues(new Uint8Array(32))].map(byte=>byte.toString(16).padStart(2,'0')).join(''),
    create:async(flowId,actorId,tokenHash)=>{
      const {data,error}=await db.rpc('create_automation_template_invite',{p_flow_id:flowId,p_actor_id:actorId,p_token_hash:tokenHash});
      if(error || typeof data!=='string')throw new Error('Invite rejected');
      return data;
    },
    accept:async(tokenHash,organizationId,actorId)=>{
      const {data,error}=await db.rpc('accept_automation_template_invite',{p_token_hash:tokenHash,p_target_org_id:organizationId,p_actor_id:actorId});
      if(error || typeof data!=='string')throw new Error('Invite rejected');
      return data;
    },
  });
});
