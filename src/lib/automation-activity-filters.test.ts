import assert from 'node:assert/strict';
import test from 'node:test';
import { activityFilterError, EMPTY_ACTIVITY_FILTERS, matchesActivityFilters } from './automation-activity-filters.ts';
import type { AutomationRun } from '../types/automations.ts';
const run:AutomationRun={id:'run',organization_id:'org',flow_id:'flow',flow_version:1,subject_type:'lead',subject_id:'lead',contact_name:'João Sousa',contact_email:'joao@example.test',contact_phone:'+351 912 345 678',contact_phone_key:'912345678',status:'waiting',current_node_id:'first',wake_at:null,context:{__cursors:[{node:'second',status:'waiting'}]},steps_taken:2,last_error:null,started_at:'2026-07-01T23:30:00Z',updated_at:null,completed_at:null};
test('contact search matches name accents email and formatted phone',()=>{
  for(const contact of ['joao','SOUSA','example.test','912345678']) assert.equal(matchesActivityFilters(run,{...EMPTY_ACTIVITY_FILTERS,contact}),true);
  assert.equal(matchesActivityFilters(run,{...EMPTY_ACTIVITY_FILTERS,contact:'missing'}),false);
});
test('Lisbon full-day filters include local midnight across UTC boundary',()=>{
  assert.equal(matchesActivityFilters(run,{...EMPTY_ACTIVITY_FILTERS,startDate:'2026-07-02',endDate:'2026-07-02'}),true);
  assert.equal(matchesActivityFilters(run,{...EMPTY_ACTIVITY_FILTERS,endDate:'2026-07-01'}),false);
  const winter={...run,started_at:'2026-11-01T23:30:00Z'};
  assert.equal(matchesActivityFilters(winter,{...EMPTY_ACTIVITY_FILTERS,startDate:'2026-11-01',endDate:'2026-11-01'}),true);
});
test('node filter matches all parked paths and canonical repeated visits',()=>{
  assert.equal(matchesActivityFilters(run,{...EMPTY_ACTIVITY_FILTERS,nodeId:'second'}),true);
  assert.equal(matchesActivityFilters(run,{...EMPTY_ACTIVITY_FILTERS,nodeId:'third'}),false);
  const repeated={...run,current_node_id:'__visit:wait%3Aquote:2',context:null};
  assert.equal(matchesActivityFilters(repeated,{...EMPTY_ACTIVITY_FILTERS,nodeId:'wait:quote'}),true);
});
test('invalid date ranges are explained and do not show unfiltered results',()=>{
  const invalid={...EMPTY_ACTIVITY_FILTERS,startDate:'2026-07-03',endDate:'2026-07-01'};
  assert.ok(activityFilterError(invalid));
  assert.equal(matchesActivityFilters(run,invalid),false);
  assert.ok(activityFilterError({...EMPTY_ACTIVITY_FILTERS,startDate:'2026-02-30'}));
  assert.equal(matchesActivityFilters({...run,started_at:null},{...EMPTY_ACTIVITY_FILTERS,startDate:'2026-01-01'}),false);
  assert.equal(matchesActivityFilters({...run,started_at:null},EMPTY_ACTIVITY_FILTERS),true);
});
