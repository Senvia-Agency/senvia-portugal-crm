import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAutomationEmailCorrelation, AutomationEmailCorrelationError } from './automation-email-correlation.ts';
const runId='01234567-89ab-cdef-0123-456789abcdef';
const request={organizationId:'org-a',automationRunId:runId,automationNodeId:'email-1',recipientCount:1};
test('legacy sends do not load an automation run',async()=>{
  assert.equal(await resolveAutomationEmailCorrelation({organizationId:'org-a',recipientCount:2},false,async()=>{throw new Error('must not load');}),null);
});
test('browser callers cannot attach even an existing run',async()=>{
  await assert.rejects(resolveAutomationEmailCorrelation(request,false,async()=>({organization_id:'org-a',status:'running'})),error=>error instanceof AutomationEmailCorrelationError&&error.status===403);
});
test('internal correlation rejects a different organization',async()=>{
  await assert.rejects(resolveAutomationEmailCorrelation(request,true,async()=>({organization_id:'org-b',status:'running'})),error=>error instanceof AutomationEmailCorrelationError&&error.status===404);
});
test('cancelled runs cannot send tracked emails',async()=>{
  await assert.rejects(resolveAutomationEmailCorrelation(request,true,async()=>({organization_id:'org-a',status:'cancelled'})),error=>error instanceof AutomationEmailCorrelationError&&error.status===403);
});
test('one internal running recipient is attached without changing legacy automation_id',async()=>{
  const actual=await resolveAutomationEmailCorrelation(request,true,async id=>id===runId?{organization_id:'org-a',status:'running'}:null);
  assert.deepEqual(actual,{automation_run_id:runId,automation_node_id:'email-1'});
});
test('partial correlation and multi-recipient sends are rejected',async()=>{
  for(const input of [{...request,automationNodeId:undefined},{...request,recipientCount:2}]) {
    await assert.rejects(resolveAutomationEmailCorrelation(input,true,async()=>null),error=>error instanceof AutomationEmailCorrelationError&&error.status===400);
  }
});
