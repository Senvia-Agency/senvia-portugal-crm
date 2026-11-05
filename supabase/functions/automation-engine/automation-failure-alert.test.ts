import assert from 'node:assert/strict';
import test from 'node:test';
import { failureAlertPlan } from './automation-failure-alert.ts';
const run = { id: 'run-1', flow_id: 'flow-1', organization_id: 'org-1', subject_type: 'lead', subject_id: null,
  contact_name: null, contact_phone: null, contact_email: null, context: {} };
const flow = { id: 'flow-1', organization_id: 'org-1', created_by: 'owner', trigger_config: { failure_alert_enabled: true } };

test('failure alerts only run after explicit enablement', () => {
  assert.deepEqual(failureAlertPlan(run, { ...flow, trigger_config: {} }), { enabled: false, reason: 'disabled' });
});
test('a cross-organization or mismatched flow cannot notify an owner', () => {
  assert.deepEqual(failureAlertPlan(run, { ...flow, organization_id: 'other' }), { enabled: false, reason: 'scope_mismatch' });
  assert.deepEqual(failureAlertPlan(run, { ...flow, id: 'other' }), { enabled: false, reason: 'scope_mismatch' });
});
test('missing owner does not broadcast the alert to the organization', () => {
  assert.deepEqual(failureAlertPlan(run, { ...flow, created_by: null }), { enabled: false, reason: 'owner_missing' });
});
test('the alert links to the real editor route and identifies the execution', () => {
  assert.deepEqual(failureAlertPlan(run, flow), { enabled: true, userId: 'owner', link: '/automacoes/flow-1?run=run-1' });
});

test('test executions cannot create operational alerts even when enabled', () => {
  assert.deepEqual(failureAlertPlan({ ...run, context: { __test: true } }, flow), { enabled: false, reason: 'test_run' });
});
