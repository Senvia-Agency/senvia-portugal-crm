import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, Share2 } from 'lucide-react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { useAutomationFlows } from '@/hooks/useAutomationFlows';
import { supabase } from '@/integrations/supabase/client';

function record(value: unknown): value is Record<string,unknown>{return typeof value==='object' && value!==null && !Array.isArray(value);}
async function message(cause:unknown):Promise<string>{
  if(cause instanceof FunctionsHttpError && cause.context instanceof Response){
    try{const body:unknown=await cause.context.json();if(record(body)&&body.error==='MFA_REQUIRED')return 'Confirme a autenticação em dois passos para continuar.';}catch{return 'Não foi possível ler a resposta do serviço.';}
  }
  return 'Não foi possível concluir. Confirme a permissão administrativa e a validade do convite.';
}
export function AutomationTemplateSharing({onImported}:{onImported:(flowId:string)=>void}){
  const {organization,roles}=useAuth();
  const flows=useAutomationFlows();
  const queryClient=useQueryClient();
  const [open,setOpen]=useState(false);
  const [flowId,setFlowId]=useState('');
  const [token,setToken]=useState('');
  const [createdToken,setCreatedToken]=useState<string|null>(null);
  const [busy,setBusy]=useState<'create'|'accept'|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [copied,setCopied]=useState(false);
  if(!roles.includes('admin')&&!roles.includes('super_admin'))return null;
  async function perform(action:'create'|'accept'){
    if(!organization?.id)return;
    setBusy(action);setError(null);setCopied(false);
    if(action==='create')setCreatedToken(null);
    try{
      const {data,error:failure}=await supabase.functions.invoke<unknown>('automation-template-invite',{body:action==='create'
        ?{action,flow_id:flowId}:{action,token:token.trim(),organization_id:organization.id}});
      if(failure)throw failure;
      if(!record(data))throw new Error('Invalid response');
      if(action==='create'){
        if(typeof data.token!=='string')throw new Error('Invalid token');
        setCreatedToken(data.token);
      }else{
        if(typeof data.flow_id!=='string'||data.status!=='draft')throw new Error('Invalid draft');
        setToken('');await queryClient.invalidateQueries({queryKey:['automation-flows']});onImported(data.flow_id);
      }
    }catch(cause){setError(await message(cause));}finally{setBusy(null);}
  }
  async function copy(){
    if(!createdToken)return;
    try{await navigator.clipboard.writeText(createdToken);setCopied(true);}catch{setError('Não foi possível copiar. Selecione o convite e copie manualmente.');}
  }
  if(!open)return <Button variant="outline" onClick={()=>setOpen(true)}><Share2 className="mr-2 h-4 w-4"/>Partilhar ou importar modelo</Button>;
  return <section aria-label="Partilha de modelos por convite" className="space-y-4 rounded-xl border bg-card p-4">
    <div><h2 className="text-base font-semibold">Partilhar modelo por convite</h2><p className="text-sm text-muted-foreground">O convite copia apenas o desenho para um novo rascunho. Registos, credenciais e ligações à sua organização não são partilhados. O administrador destinatário aceita na organização dele e configura novamente os recursos.</p></div>
    <div className="grid gap-5 md:grid-cols-2">
      <div className="space-y-2"><Label htmlFor="share-template-flow">Modelo desta organização</Label>
        <Select value={flowId} onValueChange={setFlowId}><SelectTrigger id="share-template-flow"><SelectValue placeholder="Escolher automação"/></SelectTrigger><SelectContent>{(flows.data??[]).map(flow=><SelectItem key={flow.id} value={flow.id}>{flow.name}</SelectItem>)}</SelectContent></Select>
        <Button disabled={!flowId||busy!==null} onClick={()=>perform('create')}>{busy==='create'&&<Loader2 className="mr-2 h-4 w-4 animate-spin"/>}Gerar convite de uma utilização</Button>
        {createdToken&&<div className="space-y-2"><Label htmlFor="created-template-invite">Convite — válido por 14 dias</Label><Input id="created-template-invite" value={createdToken} readOnly/><div className="flex gap-2"><Button variant="outline" onClick={copy}><Copy className="mr-2 h-4 w-4"/>{copied?'Copiado':'Copiar convite'}</Button><Button variant="ghost" onClick={()=>setCreatedToken(null)}>Ocultar</Button></div><p className="text-sm text-muted-foreground">Este convite só é mostrado agora. Entregue-o ao administrador que deve importar o modelo.</p></div>}
      </div>
      <div className="space-y-2"><Label htmlFor="accept-template-token">Convite recebido</Label><Input id="accept-template-token" value={token} onChange={event=>setToken(event.target.value)} placeholder="Cole o convite recebido" autoComplete="off"/>
        <p className="text-sm text-muted-foreground">Será importado como rascunho em {organization?.name}. Reveja mensagens, etapas e campos antes de ativar.</p>
        <Button disabled={!/^[0-9a-f]{64}$/.test(token.trim())||busy!==null} onClick={()=>perform('accept')}>{busy==='accept'&&<Loader2 className="mr-2 h-4 w-4 animate-spin"/>}Aceitar e configurar rascunho</Button>
      </div>
    </div>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button variant="ghost" onClick={()=>{setOpen(false);setCreatedToken(null);setToken('');}}>Fechar partilha</Button>
  </section>;
}
