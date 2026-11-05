import assert from 'node:assert/strict';
import test from 'node:test';
import { triggerInput } from '@/lib/automation-io';
import { TRIGGER_GROUPS, TRIGGER_TYPES, NODE_DEFINITIONS } from '@/lib/automation-nodes';
import { createWorkflowDraft } from './workflow-editor-model';
test('configured query columns remain available alongside date scheduled record fields', () => {
  // Given: the supported configurable workflow draft and a scheduled sale trigger.
  const workflow = createWorkflowDraft('Europe/Lisbon');
  // When: the editor asks for each trigger input catalogue.
  const configured = triggerInput('configured_workflow', { workflow });
  const scheduled = triggerInput('record_date', { entity: 'sale' });
  // Then: each mode exposes its own data contract without replacing the other.
  assert.deepEqual(configured?.fields.map(field => field.key), workflow.query.select);
  assert.equal(configured?.contact, true);
  assert.ok(scheduled?.fields.some(field => field.key === 'total_value'));
  assert.equal(scheduled?.contact, 'linked');
});

test('trigger picker keeps configurable workflows and rebuilt entry events', () => {
  // Given: the two independently developed trigger families.
  const expected = ['configured_workflow', 'scheduled', 'record_date', 'email_received', 'task_overdue'] as const;
  // When: the picker groups and definitions are read.
  const grouped = TRIGGER_GROUPS.flatMap(group => group.types);
  // Then: both families can be selected and resolved to real definitions.
  for (const type of expected) {
    assert.ok(grouped.includes(type), type);
    assert.ok(TRIGGER_TYPES.includes(type), type);
    assert.equal(NODE_DEFINITIONS[type].type, type);
  }
});
