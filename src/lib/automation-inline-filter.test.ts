import assert from 'node:assert/strict';
import test from 'node:test';
import { insertNodeOnEdge } from './automation-graph.ts';
import type { AutomationGraph } from '../types/automations.ts';

const graph: AutomationGraph = {
  nodes: [
    {id:'decision',type:'condition',config:{field:'status',operator:'equals',value:'new'},position:{x:0,y:0}},
    {id:'message',type:'send_email',config:{subject:'Subject',html:'Body'},position:{x:300,y:0}},
    {id:'other',type:'end',config:{},position:{x:300,y:200}},
  ],
  edges:[
    {id:'yes-edge',source:'decision',target:'message',branch:'yes'},
    {id:'no-edge',source:'decision',target:'other',branch:'no'},
  ],
};
test('inline filter preserves source branch and continues to original target',()=>{
  const original=structuredClone(graph);
  const {graph:updated,node}=insertNodeOnEdge(graph,'yes-edge','filter');
  assert.equal(node.type,'filter');
  assert.deepEqual(updated.edges.find(edge=>edge.target===node.id)?.branch,'yes');
  assert.deepEqual(updated.edges.find(edge=>edge.source===node.id),{id:updated.edges.find(edge=>edge.source===node.id)?.id,source:node.id,target:'message',branch:null});
  assert.deepEqual(updated.edges.find(edge=>edge.id==='no-edge'),graph.edges[1]);
  assert.equal(updated.edges.some(edge=>edge.id==='yes-edge'),false);
  assert.deepEqual(graph,original);
  assert.equal(node.config.conditions?.[0]?.field,'');
});
test('inline filter on ordinary connection does not add a decision branch',()=>{
  const plain:AutomationGraph={...graph,edges:[{id:'plain',source:'message',target:'other',branch:null}]};
  const {graph:updated,node}=insertNodeOnEdge(plain,'plain','filter');
  assert.equal(updated.edges.find(edge=>edge.target===node.id)?.branch,null);
  assert.equal(updated.edges.find(edge=>edge.source===node.id)?.branch,null);
});
