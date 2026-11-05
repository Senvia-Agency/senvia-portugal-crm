import assert from 'node:assert/strict';
import test from 'node:test';
import { groupAutomationVariables } from './automation-variable-groups';
import { inputFieldsFor } from './automation-io';
import { renderAutomationPreview } from './automation-editor-tools';
import type { AutomationGraph } from '@/types/automations';

test('variable groups preserve explicit origin and classify old field definitions',()=>{
  const groups=groupAutomationVariables([{key:'nome',label:'Nome'},{key:'empresa',label:'Empresa',origin:'organization'},{key:'otto_resumo',label:'Resumo'},{key:'ultima_resposta',label:'Resposta'},{key:'vendedor_nome',label:'Vendedor'}]);
  assert.deepEqual(groups.map(group=>group.key),['contact','owner','organization','previous','otto']);
  assert.equal(groups.find(group=>group.key==='organization')?.fields[0].key,'empresa');
});
test('a downstream message receives Otto variables without exposing an unrelated future step',()=>{
  const graph:AutomationGraph={nodes:[{id:'trigger',type:'lead_created',config:{}},{id:'ai',type:'ai_summarize',config:{}},{id:'message',type:'send_whatsapp',config:{}}],edges:[{id:'one',source:'trigger',target:'ai',branch:null},{id:'two',source:'ai',target:'message',branch:null}]};
  const message=graph.nodes[2];
  const after=inputFieldsFor(graph,message,'lead_created');
  assert.ok(after.some(field=>field.key==='otto_resumo'&&field.origin==='otto'));
  const before=inputFieldsFor(graph,graph.nodes[0],'lead_created');
  assert.equal(before.some(field=>field.key==='otto_resumo'),false);
});
test('preview applies the same defaults and formats as outbound templates',()=>{
  assert.equal(renderAutomationPreview('{{nome | "olá"}} · {{quando | data}}',{quando:'2026-11-04'}).text,'olá · 4 de novembro de 2026');
  assert.equal(renderAutomationPreview('{{nome | code}}',{}).invalid?.[0],'nome | code');
});
