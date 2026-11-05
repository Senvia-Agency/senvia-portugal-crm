import type { IoField, VariableOrigin } from './automation-io';
const ORIGINS: readonly { readonly key: VariableOrigin; readonly label: string }[] = [
  {key:'contact',label:'Contacto'}, {key:'record',label:'Registo'}, {key:'owner',label:'Responsável'},
  {key:'organization',label:'Organização'}, {key:'previous',label:'Passos anteriores'}, {key:'otto',label:'Otto'},
];
function origin(field: IoField): VariableOrigin {
  if(field.origin)return field.origin;
  if(field.key.startsWith('otto_')||field.key.startsWith('otto.'))return 'otto';
  if(['nome','primeiro_nome','email','telefone'].includes(field.key))return 'contact';
  if(field.key.startsWith('vendedor_')||field.key.startsWith('responsavel_'))return 'owner';
  if(field.key==='ultima_resposta'||field.key.startsWith('cliente_')||field.key.startsWith('lead_'))return 'previous';
  return 'record';
}
export function groupAutomationVariables(fields: readonly IoField[]): readonly { readonly key: VariableOrigin; readonly label: string; readonly fields: readonly IoField[] }[] {
  return ORIGINS.map(group=>({...group,fields:fields.filter(field=>origin(field)===group.key)})).filter(group=>group.fields.length>0);
}
