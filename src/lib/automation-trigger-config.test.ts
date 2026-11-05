import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAutomationTriggerConfig } from './automation-trigger-config.ts';

test('switching a lead-stage trigger to a schedule removes hidden filters and keeps flow settings', () => {
  const goal = { match: 'all', conditions: [{ field: 'status', value: 'won', operator: 'equals' }] };
  const result = buildAutomationTriggerConfig({ filters: { match: 'all', conditions: [{ field: 'status', operator: 'equals', value: 'proposal' }] }, to_stage: 'proposal', form_id: 'form', channel_id: 'channel', goal, failure_alert_enabled: true, failure_policy: { enabled: true }, reentry_cooldown_days: 30 }, { entity: 'lead', schedule: { frequency: 'daily', time: '09:00' } }, true);
  assert.equal(result.filters, undefined);
  assert.equal(result.to_stage, undefined);
  assert.equal(result.form_id, undefined);
  assert.equal(result.channel_id, undefined);
  assert.deepEqual(result.goal, goal);
  assert.equal(result.failure_alert_enabled, true);
  assert.equal(result.reentry_cooldown_days, 30);
  assert.deepEqual(result.schedule, { frequency: 'daily', time: '09:00' });
});

test('saving or restoring the same trigger retains hidden legacy values and current global settings', () => {
  const saved = { form_id: 'legacy-form', goal: null, failure_policy: { enabled: false }, reentry_cooldown_days: 7 };
  const result = buildAutomationTriggerConfig(saved, { name: 'New name', goal: { stale: true } }, false);
  assert.equal(result.form_id, 'legacy-form');
  assert.equal(result.goal, null);
  assert.deepEqual(result.failure_policy, { enabled: false });
  assert.equal(result.reentry_cooldown_days, 7);
});

test('an explicitly cleared trigger filter is removed instead of revived from saved configuration', () => {
  const result = buildAutomationTriggerConfig({ filters: { match: 'all', conditions: [{ field: 'email', operator: 'exists' }] } }, { filters: undefined }, false);
  assert.equal(result.filters, undefined);
});

test('switching triggers preserves requirements for surviving actions and drops only obsolete nodes and changed entry requirements', () => {
  const actionRequirement = { node_id: 'assign', field: 'user_ids', label: 'Escolha os comerciais' };
  const saved = { recipe_required_fields: [
    { node_id: 'trigger', field: 'to_stage', label: 'Escolha a etapa' },
    actionRequirement,
    { node_id: 'removed', field: 'list_id', label: 'Escolha a lista' },
  ], filters: { match: 'all' as const, conditions: [{ field: 'status', value: 'proposal' }] } };
  const graph = { nodes: [
    { id: 'trigger', type: 'scheduled' as const, config: { entity: 'lead' as const } },
    { id: 'assign', type: 'assign_user' as const, config: { assignment_mode: 'round_robin' as const, user_ids: [] } },
  ], edges: [] };
  const result = buildAutomationTriggerConfig(saved, graph.nodes[0].config, true, { graph, entryNodeId: 'trigger' });
  assert.equal(result.filters, undefined);
  assert.deepEqual(result.recipe_required_fields, [actionRequirement]);
});
