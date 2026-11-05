import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAutomationConfiguration } from './automation-validation.ts';

test('a condition without a field blocks activation while disconnected branches are warnings', () => {
  const issues = validateAutomationConfiguration({ nodes: [{ id: 'condition', type: 'condition', config: { value: 'x' } }], edges: [] });
  assert.ok(issues.some(issue => issue.severity === 'error'));
  assert.equal(issues.filter(issue => issue.severity === 'warning').length, 2);
});

test('complete grouped condition can activate despite deliberately ending branches', () => {
  const issues = validateAutomationConfiguration({ nodes: [{ id: 'condition', type: 'condition', config: { match: 'any', conditions: [{ field: 'email', operator: 'exists' }] } }], edges: [] });
  assert.equal(issues.filter(issue => issue.severity === 'error').length, 0);
});

test('invalid duration is rejected and existing reply timeout default stays accepted', () => {
  const issues = validateAutomationConfiguration({ nodes: [{ id: 'wait', type: 'wait', config: { amount: 0 } }, { id: 'reply', type: 'wait_reply', config: { rules: [{ id: 'yes', label: 'Sim', keywords: ['sim'] }] } }], edges: [] });
  assert.deepEqual(issues.filter(issue => issue.severity === 'error').map(issue => issue.nodeId), ['wait']);
});

test('date and business waits validate their own settings instead of requiring a duration', () => {
  const issues = validateAutomationConfiguration({ nodes: [
    { id: 'date', type: 'wait', config: { wait_mode: 'date', date_field: 'next_renewal_date', offset_days: -2, at_time: '09:00' } },
    { id: 'business', type: 'wait', config: { wait_mode: 'business', business_start: '09:00', business_end: '18:00' } },
  ], edges: [] });
  assert.equal(issues.length, 0);
});

test('impossible hours and reverse business windows block activation', () => {
  const issues = validateAutomationConfiguration({ nodes: [
    { id: 'date', type: 'wait', config: { wait_mode: 'date', date_field: 'due', at_time: '24:30' } },
    { id: 'business', type: 'wait', config: { wait_mode: 'business', business_start: '18:00', business_end: '09:00' } },
  ], edges: [] });
  assert.deepEqual(issues.filter(issue => issue.severity === 'error').map(issue => issue.nodeId), ['date', 'business']);
});

test('condition wait rejects an invalid deadline and reports its open exits', () => {
  const issues = validateAutomationConfiguration({ nodes: [
    { id: 'until', type: 'wait_until', config: { conditions: [{ field: 'paid', operator: 'equals', value: 'true' }], match: 'all', timeout_amount: -1 } },
  ], edges: [] });
  assert.equal(issues.filter(issue => issue.severity === 'error').length, 1);
  assert.equal(issues.filter(issue => issue.severity === 'warning').length, 2);
});

test('retry limits prevent fractional counts and zero intervals', () => {
  const issues = validateAutomationConfiguration({ nodes: [
    { id: 'valid', type: 'send_email', config: { retry: { max_attempts: 3, interval_minutes: 5 } } },
    { id: 'count', type: 'send_email', config: { retry: { max_attempts: 2.5, interval_minutes: 5 } } },
    { id: 'interval', type: 'send_email', config: { retry: { max_attempts: 3, interval_minutes: 0 } } },
  ], edges: [] });
  assert.deepEqual(issues.map(issue => issue.nodeId), ['count', 'interval']);
});

test('default business hours and a valid daily schedule can activate', () => {
  const issues = validateAutomationConfiguration({ nodes: [
    { id: 'business', type: 'wait', config: { wait_mode: 'business' } },
    { id: 'schedule', type: 'scheduled', config: { entity: 'lead', schedule: { frequency: 'daily', time: '09:00' } } },
    { id: 'record-date', type: 'record_date', config: { entity: 'sale', date_field: 'next_renewal_date', offset_days: -3, time: '18:30' } },
  ], edges: [] });
  assert.equal(issues.length, 0);
});

test('unsupported schedule frequency and missing entity cannot activate', () => {
  const issues = validateAutomationConfiguration({ nodes: [
    { id: 'schedule', type: 'scheduled', config: { schedule: JSON.parse('{"frequency":"sometimes","time":"09:00"}') } },
  ], edges: [] });
  assert.equal(issues.filter(issue => issue.severity === 'error').length, 2);
});

test('split variants need unique identifiers and percentages that sum to 100', () => {
  const issues = validateAutomationConfiguration({ nodes: [{ id: 'ab', type: 'split_ab', config: { variants: [
    { id: 'same', label: 'A', weight: 40 }, { id: 'same', label: 'B', weight: 40 },
  ] } }], edges: [] });
  assert.equal(issues.filter(issue => issue.severity === 'error').length, 2);
});

test('subflow cannot invoke itself', () => {
  const issues = validateAutomationConfiguration({ nodes: [{ id: 'invoke', type: 'execute_flow', config: { flow_id: 'current' } }], edges: [] }, { flowId: 'current' });
  assert.equal(issues.filter(issue => issue.severity === 'error').length, 1);
});

test('recipe required choices stop blocking once filled in', () => {
  const graph = { nodes: [{ id: 'notify', type: 'notify_user', config: { title: 'Aviso', user_id: 'user' } }], edges: [] } satisfies Parameters<typeof validateAutomationConfiguration>[0];
  const triggerConfig = { recipe_required_fields: [{ node_id: 'notify', field: 'user_id', label: 'Escolha o destinatário' }] };
  assert.equal(validateAutomationConfiguration(graph, { triggerConfig }).length, 0);
  assert.equal(validateAutomationConfiguration({ ...graph, nodes: [{ ...graph.nodes[0], config: { title: 'Aviso' } }] }, { triggerConfig }).filter(issue => issue.severity === 'error').length, 2);
});

test('an unconnected error branch is a warning and never blocks activation', () => {
  const issues = validateAutomationConfiguration({ nodes: [{ id: 'send', type: 'send_email', config: { on_error: 'error_branch' } }], edges: [] });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, 'warning');
});

test('Otto extraction needs valid unique field names and source text', () => {
  const issues = validateAutomationConfiguration({ nodes: [{ id: 'extract', type: 'ai_extract', config: { text: 'Cliente quer orçamento', fields: [{ name: 'Email!', description: 'Email' }] } }], edges: [] });
  assert.equal(issues.filter(issue => issue.severity === 'error').length, 1);
  assert.equal(issues.filter(issue => issue.severity === 'warning').length, 2);
});

test('event templates are accepted while a static inverted date range is rejected', () => {
  const issues = validateAutomationConfiguration({ nodes: [
    { id: 'template', type: 'create_event', config: { title: 'Reunião', user_id: 'u', start_time: '{{data_reuniao}}' } },
    { id: 'invalid', type: 'create_event', config: { title: 'Reunião', user_id: 'u', start_time: '2026-11-04T12:00:00Z', end_time: '2026-11-04T11:00:00Z' } },
  ], edges: [] });
  assert.deepEqual(issues.filter(issue => issue.severity === 'error').map(issue => issue.nodeId), ['invalid']);
});

test('invalid numeric operands in nested groups block activation while dynamic operands remain valid', () => {
  const invalid = validateAutomationConfiguration({ nodes: [{ id: 'condition', type: 'condition', config: { match: 'all', conditions: [{ field: 'value', operator: 'greater_or_equal', value: 'not a number' }] } }], edges: [] });
  assert.equal(invalid.filter(issue => issue.severity === 'error').length, 1);
  const dynamic = validateAutomationConfiguration({ nodes: [{ id: 'condition', type: 'condition', config: { field: 'value', operator: 'greater_than', value: '{{limite}}' } }], edges: [] });
  assert.equal(dynamic.filter(issue => issue.severity === 'error').length, 0);
});
