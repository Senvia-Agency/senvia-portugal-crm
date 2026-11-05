import assert from 'node:assert/strict';
import test from 'node:test';
import { copyAutomationFragment, pasteAutomationFragment } from './automation-copy.ts';
import type { AutomationGraph } from '../types/automations.ts';
const graph: AutomationGraph = { nodes: [
  { id: 't', type: 'lead_created', config: {} },
  { id: 'a', type: 'condition', config: { field: 'status', value: 'new' } },
  { id: 'b', type: 'send_email', config: { subject: 'Welcome' } },
], edges: [{ id: 'ta', source: 't', target: 'a', branch: null }, { id: 'ab', source: 'a', target: 'b', branch: 'yes' }] };

test('copiar ramo conserva apenas ligações internas e não copia gatilhos', () => {
  const fragment = copyAutomationFragment(graph, 'a', true);
  assert.deepEqual(fragment.nodes.map(node => node.id), ['a', 'b']);
  assert.deepEqual(fragment.edges.map(edge => edge.id), ['ab']);
  assert.equal(copyAutomationFragment(graph, 't', true).nodes.length, 0);
});

test('colar gera identidades novas e conserva ramos sem ligação ao original', () => {
  const result = pasteAutomationFragment(graph, copyAutomationFragment(graph, 'a', true));
  const newNodes = result.nodes.slice(graph.nodes.length);
  assert.equal(new Set(result.nodes.map(node => node.id)).size, 5);
  assert.equal(result.edges.at(-1)?.branch, 'yes');
  assert.equal(result.edges.at(-1)?.source, newNodes[0].id);
  assert.equal(result.edges.at(-1)?.target, newNodes[1].id);
  newNodes[0].config.value = 'changed';
  assert.equal(graph.nodes[1].config.value, 'new');
});
