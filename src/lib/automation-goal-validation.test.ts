import assert from 'node:assert/strict';
import test from 'node:test';
import type { AutomationGraph } from '../types/automations';
import { validateAutomationConfiguration } from './automation-validation.ts';

const graph: AutomationGraph = { nodes: [{ id: 'trigger', type: 'lead_created', config: {} }], edges: [] };

test('objetivo com número inválido bloqueia ativação pela validação compartilhada', () => {
  const issues = validateAutomationConfiguration(graph, { triggerConfig: { goal: { match: 'all', conditions: [{ field: 'value', operator: 'greater_or_equal', value: 'abc' }] } } });
  assert.ok(issues.some(issue => issue.severity === 'error'));
});

test('objetivo com data impossível bloqueia ativação', () => {
  const issues = validateAutomationConfiguration(graph, { triggerConfig: { goal: { match: 'any', conditions: [{ field: 'valid_until', operator: 'before', value: '2026-02-31' }] } } });
  assert.ok(issues.some(issue => issue.severity === 'error'));
});

test('objetivo com novos operadores e valores válidos pode ativar', () => {
  const issues = validateAutomationConfiguration(graph, { triggerConfig: { goal: { match: 'all', conditions: [
    { field: 'value', operator: 'greater_or_equal', value: '100' },
    { field: 'valid_until', operator: 'before', value: '2026-11-05' },
    { field: 'tags', operator: 'contains_any', value: 'prioridade,empresa' },
  ] } } });
  assert.equal(issues.filter(issue => issue.severity === 'error').length, 0);
});
