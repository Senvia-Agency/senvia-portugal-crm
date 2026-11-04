const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const NodeModule = require('node:module');
const { buildSync } = require('esbuild');

const root = path.resolve(__dirname, '../../..');
const bundle = buildSync({
  absWorkingDir: root,
  bundle: true,
  entryPoints: ['src/components/automations/workflow-editor-model.ts'],
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  write: false,
}).outputFiles[0].text;
const loaded = new NodeModule(path.join(root, '.workflow-editor-model.test.cjs'));
loaded.filename = path.join(root, '.workflow-editor-model.test.cjs');
loaded.paths = NodeModule._nodeModulePaths(root);
loaded._compile(bundle, loaded.filename);
const model = loaded.exports;

test('creates a safe manual draft with no executable stages', () => {
  const draft = model.createWorkflowDraft('Europe/Lisbon');
  assert.equal(draft.schemaVersion, 1);
  assert.deepEqual(draft.trigger, { kind: 'authenticated_manual', timeZone: 'Europe/Lisbon' });
  assert.equal(draft.query.entity, 'clients');
  assert.ok(draft.query.select.includes('name'));
  assert.deepEqual(draft.stages, []);
});

test('changing entity resets filters and stage conditions', () => {
  const draft = model.createWorkflowDraft('Europe/Lisbon');
  draft.query.filters = [{ field: 'status', operator: 'equals', value: 'active' }];
  draft.stages = [{
    ...model.createWorkflowStage('action_1'),
    conditions: [{ field: 'status', operator: 'equals', value: 'active' }],
  }];
  const changed = model.changeWorkflowEntity(draft, 'receivables');
  assert.equal(changed.query.entity, 'receivables');
  assert.deepEqual(changed.query.filters, []);
  assert.deepEqual(changed.stages[0].conditions, []);
  assert.ok(changed.query.select.includes('due_date'));
});

test('removing a selected field also removes its filters and conditions', () => {
  const draft = model.createWorkflowDraft('Europe/Lisbon');
  draft.query.filters = [{ field: 'status', operator: 'equals', value: 'active' }];
  draft.stages = [{
    ...model.createWorkflowStage('action_1'),
    conditions: [{ field: 'status', operator: 'equals', value: 'active' }],
  }];
  const changed = model.removeFieldReferences(draft, draft.query.select.filter((field) => field !== 'status'));
  assert.deepEqual(changed.query.filters, []);
  assert.deepEqual(changed.stages[0].conditions, []);
});

test('new stages default to once per record and stage', () => {
  assert.deepEqual(model.createWorkflowStage('send_1'), {
    id: 'stage_send_1',
    nodeId: 'send_1',
    conditions: [],
    cadence: { mode: 'once' },
  });
});

test('date predicates use a relative-to-today operand', () => {
  assert.deepEqual(model.createPredicate('receivables', 'due_date'), {
    field: 'due_date',
    operator: 'before',
    value: { kind: 'today_offset_days', days: 0 },
  });
});

test('relative dates keep the signed contract while showing positive magnitudes', () => {
  assert.deepEqual(model.relativeDateOperand('past', 10), { kind: 'today_offset_days', days: -10 });
  assert.deepEqual(model.relativeDateOperand('today', 10), { kind: 'today_offset_days', days: 0 });
  assert.deepEqual(model.relativeDateOperand('future', 10), { kind: 'today_offset_days', days: 10 });
  assert.equal(model.relativeDateDirection(-10), 'past');
  assert.equal(model.relativeDateDirection(0), 'today');
  assert.equal(model.relativeDateDirection(10), 'future');
});

test('time zones are explicit and validated before creating a draft', () => {
  assert.equal(model.isValidWorkflowTimeZone('Europe/Lisbon'), true);
  assert.equal(model.isValidWorkflowTimeZone(''), false);
  assert.equal(model.isValidWorkflowTimeZone('Not/AZone'), false);
  assert.deepEqual(model.triggerForKind('native_event', 'Europe/Lisbon', 'clients'), {
    kind: 'native_event',
    event: 'client_created',
    timeZone: 'Europe/Lisbon',
  });
});

test('native events only match entities supported by the engine', () => {
  assert.equal(model.isWorkflowNativeEventCompatible('clients', 'client_created'), true);
  assert.equal(model.isWorkflowNativeEventCompatible('clients', 'lead_created'), false);
  assert.equal(model.isWorkflowNativeEventCompatible('receivables', 'sale_payment_overdue_10d'), false);
});

test('a branch and wait graph survives the editor save and reopen shape', () => {
  const workflow = model.createWorkflowDraft('Europe/Lisbon');
  workflow.stages = [model.createWorkflowStage('email')];
  const saved = JSON.stringify({
    trigger_type: 'configured_workflow',
    trigger_config: { workflow },
    graph: {
      nodes: [
        { id: 'entry', type: 'configured_workflow', config: { workflow } },
        { id: 'condition', type: 'condition', config: { field: 'status', operator: 'equals', value: 'active' } },
        { id: 'wait', type: 'wait', config: { amount: 1, unit: 'days' } },
        { id: 'email', type: 'send_email', config: { subject: 'Fixture' } },
        { id: 'end', type: 'end', config: {} },
      ],
      edges: [
        { id: 'a', source: 'entry', target: 'condition' },
        { id: 'b', source: 'condition', target: 'wait', branch: 'yes' },
        { id: 'c', source: 'condition', target: 'end', branch: 'no' },
        { id: 'd', source: 'wait', target: 'email' },
      ],
    },
  });
  const reopened = JSON.parse(saved);
  assert.deepEqual(reopened.graph.edges.map((edge) => edge.branch ?? null), [null, 'yes', 'no', null]);
  assert.deepEqual(reopened.trigger_config.workflow.stages[0], model.createWorkflowStage('email'));
  assert.equal(model.CONFIGURED_WORKFLOW_CANVAS_TYPES.includes('condition'), true);
  assert.equal(model.CONFIGURED_WORKFLOW_CANVAS_TYPES.includes('wait'), true);
  assert.equal(model.CONFIGURED_WORKFLOW_CANVAS_TYPES.includes('wait_reply'), false);
});
