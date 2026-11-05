import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAutomationConfiguration } from './automation-validation.ts';

function check(type: string, config: Record<string, unknown>) {
  return validateAutomationConfiguration({ nodes: [JSON.parse(JSON.stringify({ id: 'node', type, config }))], edges: [] });
}

test('new lead requires a name and at least one contact method', () => {
  assert.equal(check('create_lead', { name: 'Maria', phone: '{{telefone}}' }).length, 0);
  assert.equal(check('create_lead', { name: 'Maria' }).filter(issue => issue.severity === 'error').length, 1);
});

test('lost lead and financial request require reasons and valid requested states', () => {
  assert.equal(check('mark_lead_lost', {}).length, 1);
  assert.equal(check('request_sale_status', { reason: 'Rever', target_status: 'paid' }).length, 1);
  assert.equal(check('request_sale_status', { reason: 'Instalado', target_status: 'delivered' }).length, 0);
});

test('template rejects duplicate sections and non-text parameters', () => {
  assert.equal(check('send_meta_template', { template_name: 'welcome', language: 'pt_PT', components: [{ type: 'body', parameters: ['{{nome}}'] }] }).length, 0);
  assert.equal(check('send_meta_template', { template_name: 'welcome', language: 'pt_PT', components: [{ type: 'body', parameters: [5] }] }).length, 1);
});

test('lifecycle uses a bounded positive number of days', () => {
  assert.equal(check('lead_inactive', { days: 5 }).length, 0);
  assert.equal(check('lead_inactive', { days: 0 }).length, 1);
  assert.equal(check('proposal_expiring', { days: 3661 }).length, 1);
});

test('email waits only support observed events and require a positive timeout', () => {
  assert.equal(check('send_email', { wait_event: 'opened', timeout_amount: 24 }).filter(issue => issue.severity === 'error').length, 0);
  assert.equal(check('send_email', { wait_event: 'reply', timeout_amount: 0 }).filter(issue => issue.severity === 'error').length, 2);
});

test('failure protection enforces the same ranges as the engine', () => {
  const graph = { nodes: [], edges: [] };
  assert.equal(validateAutomationConfiguration(graph, { triggerConfig: { failure_policy: { enabled: true, threshold_percent: 20, min_runs: 10, window_minutes: 60 } } }).length, 0);
  assert.equal(validateAutomationConfiguration(graph, { triggerConfig: { failure_policy: { enabled: true, threshold_percent: 101, min_runs: 1, window_minutes: 0 } } }).length, 1);
});

test('bounded jump validates target reachability and rejects self or entry targets', () => {
  const nodes = JSON.parse(JSON.stringify([
    { id: 'trigger', type: 'lead_created', config: {} },
    { id: 'message', type: 'send_email', config: {} },
    { id: 'jump', type: 'goto', config: { target_node_id: 'message', max_visits: 3 } },
  ]));
  const graph = { nodes, edges: [{ id: 'e1', source: 'trigger', target: 'message', branch: null }, { id: 'e2', source: 'message', target: 'jump', branch: null }] };
  assert.equal(validateAutomationConfiguration(graph, { entryNodeId: 'trigger' }).length, 0);
  nodes[2].config.target_node_id = 'trigger';
  assert.equal(validateAutomationConfiguration(graph, { entryNodeId: 'trigger' }).length, 1);
  nodes[2].config.target_node_id = 'jump';
  assert.equal(validateAutomationConfiguration(graph, { entryNodeId: 'trigger' }).length, 1);
});

test('email replied is accepted with positive timeout and both exits remain visible', () => {
  const valid = check('send_email', { wait_event: 'replied', timeout_amount: 24 });
  assert.equal(valid.filter(issue => issue.severity === 'error').length, 0);
  assert.equal(valid.filter(issue => issue.severity === 'warning').length, 2);
  const invalid = check('send_email', { wait_event: 'reply', timeout_amount: 24 });
  assert.equal(invalid.filter(issue => issue.severity === 'error').length, 1);
  const noDeadline = check('send_email', { wait_event: 'replied', timeout_amount: 0 });
  assert.equal(noDeadline.filter(issue => issue.severity === 'error').length, 1);
});

test('task priority accepts the supported values and rejects unknown values', () => {
  assert.equal(check('create_task', { title: 'Ligar', priority: 'high' }).filter(issue => issue.severity === 'error').length, 0);
  assert.equal(check('create_task', { title: 'Ligar', priority: 'urgent' }).filter(issue => issue.severity === 'error').length, 1);
});

test('an explicitly selected distribution pool cannot be empty while omitted pools keep the all-active-members policy', () => {
  assert.equal(check('assign_user', { assignment_mode: 'round_robin', user_ids: [] }).filter(issue => issue.severity === 'error').length, 1);
  assert.equal(check('assign_user', { assignment_mode: 'least_loaded', user_ids: ['member'] }).filter(issue => issue.severity === 'error').length, 0);
  assert.equal(check('assign_user', { assignment_mode: 'round_robin' }).filter(issue => issue.severity === 'error').length, 0);
});

test('a failed condition cannot be configured to continue through its first decision branch', () => {
  const graph = { nodes: [{ id: 'decision', type: 'condition' as const, config: { field: 'value', operator: 'greater_than' as const, value: '10', on_error: 'continue' as const } }], edges: [{ id: 'branch', source: 'decision', target: 'commercial-action', branch: 'yes' }] };
  const errors = validateAutomationConfiguration(graph).filter(issue => issue.severity === 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].nodeId, 'decision');
  const recover = { ...graph, nodes: [{ ...graph.nodes[0], config: { ...graph.nodes[0].config, on_error: 'error_branch' as const } }] };
  assert.equal(validateAutomationConfiguration(recover).filter(issue => issue.severity === 'error').length, 0);
});

test('internal emails require their chosen user and do not allow contact interaction waits', () => {
  assert.equal(check('send_email', { recipient_mode: 'user', recipient_user_id: 'member' }).filter(issue => issue.severity === 'error').length, 0);
  assert.equal(check('send_email', { recipient_mode: 'user', wait_event: 'replied' }).filter(issue => issue.severity === 'error').length, 2);
  assert.equal(check('send_email', { recipient_mode: 'owner' }).filter(issue => issue.severity === 'error').length, 0);
});

test('feed publishing requires a nonblank message and needs no contact or conversion goal', () => {
  assert.equal(check('publish_feed', { message: '   ' }).filter(issue => issue.severity === 'error').length, 1);
  assert.equal(check('publish_feed', { message: 'Venda concluída por {{responsavel}}', title: 'Equipa comercial' }).length, 0);
  assert.equal(check('publish_feed', { message: 'Atualização interna.' }).length, 0);
});

test('feed message and optional title respect their static length limits', () => {
  assert.equal(check('publish_feed', { message: 'x'.repeat(4000), title: 'x'.repeat(120) }).length, 0);
  assert.equal(check('publish_feed', { message: 'x'.repeat(4001) }).filter(issue => issue.severity === 'error').length, 1);
  assert.equal(check('publish_feed', { message: 'Atualização', title: 'x'.repeat(121) }).filter(issue => issue.severity === 'error').length, 1);
});
