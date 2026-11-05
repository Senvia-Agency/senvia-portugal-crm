import assert from 'node:assert/strict';
import test from 'node:test';
import { currentVisitExecutedNodes, planBoundedJump, visitStepKey, InvalidAutomationJump } from './automation-jump.ts';
const graph = {
  nodes: ['trigger','send','wait','jump','other'].map(id => ({id,type:id === 'trigger' ? 'lead_created' : id === 'jump' ? 'goto' : 'wait'})),
  edges: [{source:'trigger',target:'send'},{source:'send',target:'wait'},{source:'wait',target:'jump'},{source:'trigger',target:'other'}],
};
const request = {nodeId:'jump',target:'send',maxVisits:3,entryNodeId:'trigger'};
test('repeats only segment ancestors and permits exactly configured total visits', () => {
  let context: Record<string,unknown> = {};
  for(let repetition=1;repetition<=2;repetition++) {
    const decision=planBoundedJump(graph,context,request);
    assert.equal(decision.kind,'jump');
    if(decision.kind !== 'jump') throw new Error('expected jump');
    assert.deepEqual(new Set(decision.region),new Set(['send','wait','jump']));
    context=decision.context;
    assert.equal(visitStepKey(context,'send'),`__visit:send:${repetition}`);
    assert.equal(visitStepKey(context,'other'),'other');
  }
  assert.equal(planBoundedJump(graph,context,request).kind,'continue');
});
test('old step rows do not suppress current iteration; matching visit does',()=>{
  const result=planBoundedJump(graph,{},request);
  assert.deepEqual([...currentVisitExecutedNodes(result.context,graph.nodes,[{node_id:'send'},{node_id:'other'}])],['other']);
  assert.deepEqual([...currentVisitExecutedNodes(result.context,graph.nodes,[{node_id:'__visit:send:1'},{node_id:'other'}])],['send','other']);
});
test('resets only repeated nodes retry and wait state without changing snapshot',()=>{
  const snapshot={version:1};
  const context={__flow_snapshot:snapshot,__retry_send:{attempts:2},__wait_deadline_wait:'past',__email_wait_send:{deadline:'past'},__retry_other:{attempts:1}};
  const result=planBoundedJump(graph,context,request);
  assert.equal(result.context.__flow_snapshot,snapshot);
  assert.equal(result.context.__retry_send,undefined);
  assert.equal(result.context.__wait_deadline_wait,undefined);
  assert.equal(result.context.__email_wait_send,undefined);
  assert.deepEqual(result.context.__retry_other,{attempts:1});
  assert.deepEqual(context.__retry_send,{attempts:2});
});
test('rejects invalid targets, unbounded counts and concurrent segment work',()=>{
  for(const patch of [{target:'trigger'},{target:'other'},{target:'jump'},{maxVisits:21},{maxVisits:0},{pendingNodeIds:['wait']}]) {
    assert.throws(()=>planBoundedJump(graph,{}, {...request,...patch}),InvalidAutomationJump);
  }
  assert.equal(planBoundedJump(graph,{}, {...request,pendingNodeIds:['other']}).kind,'jump');
});
test('join belongs to loop while detached branch and exit remain unchanged',()=>{
  const branched={nodes:[...graph.nodes,{id:'left',type:'wait'},{id:'right',type:'wait'},{id:'exit',type:'end'}],edges:[...graph.edges,{source:'send',target:'left'},{source:'send',target:'right'},{source:'left',target:'jump'},{source:'right',target:'jump'},{source:'jump',target:'exit'}]};
  const decision=planBoundedJump(branched,{},request);
  assert.equal(decision.kind,'jump');
  if(decision.kind==='jump')assert.deepEqual(new Set(decision.region),new Set(['send','wait','jump','left','right']));
  assert.equal(visitStepKey(decision.context,'exit'),'exit');
});
test('visit step key encodes node ids without collisions',()=>{
  const context={__node_visits:{'a:b':1,'a%3Ab':1}};
  assert.notEqual(visitStepKey(context,'a:b'),visitStepKey(context,'a%3Ab'));
  assert.equal(visitStepKey({},'legacy'),'legacy');
});
test('outer repetition resets nested budgets but preserves its own jump budget',()=>{
  const result=planBoundedJump(graph,{__jump_counts:{wait:2,jump:1,other:3}},request);
  assert.deepEqual(result.context.__jump_counts,{jump:2,other:3});
});
