import assert from 'node:assert/strict';
import test from 'node:test';
import { createNode, normalizeGraph } from './automation-graph';
import type { AutomationGraph } from '../types/automations';
import { AUTOMATION_RECIPES, instantiateRecipeGraph } from './automation-recipes';
import { buildStarterRecipe } from './automation-starter';

const expected = { max_attempts: 3, interval_minutes: 5 };

test('novos nós de provedores incluem tentativas explícitas', () => {
  for (const type of ['send_whatsapp', 'send_email', 'webhook'] as const) {
    assert.deepEqual(createNode(type).config.retry, expected);
  }
});

test('receitas novas incluem tentativas nos passos de provedores', () => {
  for (const recipe of AUTOMATION_RECIPES) {
    for (const node of recipe.graph.nodes) {
      if (['send_whatsapp', 'send_email', 'webhook'].includes(node.type)) assert.deepEqual(node.config.retry, expected, `${recipe.id}:${node.id}`);
    }
  }
});

test('hidratar grafo legado não adiciona tentativas retroativamente', () => {
  const legacy = { nodes: [{ id: 'email', type: 'send_email', config: { subject: 'Legacy' } }], edges: [] };
  assert.equal(normalizeGraph(legacy).nodes[0].config.retry, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(legacy.nodes[0].config, 'retry'), false);
});

test('assistente de criação herda a política do primeiro passo', () => {
  const recipe = buildStarterRecipe({ trigger: 'lead_created', audience: 'all', field: '', value: '', action: 'send_email' });
  assert.deepEqual(recipe.graph.nodes.find(node => node.type === 'send_email')?.config.retry, expected);
});


test('instanciar receita preserva tentativas desativadas explicitamente e política personalizada', () => {
  const graph: AutomationGraph = { nodes: [
    { id: 'off', type: 'send_email', config: { retry: undefined } },
    { id: 'custom', type: 'webhook', config: { retry: { max_attempts: 2, interval_minutes: 15 } } },
  ], edges: [] };
  const fresh = instantiateRecipeGraph(graph);
  assert.equal(fresh.nodes[0].config.retry, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(fresh.nodes[0].config, 'retry'), true);
  assert.deepEqual(fresh.nodes[1].config.retry, { max_attempts: 2, interval_minutes: 15 });
});

test('instanciar receita não modifica o grafo de origem', () => {
  const graph: AutomationGraph = { nodes: [{ id: 'email', type: 'send_email', config: {} }], edges: [] };
  const fresh = instantiateRecipeGraph(graph);
  assert.deepEqual(fresh.nodes[0].config.retry, expected);
  assert.equal(Object.prototype.hasOwnProperty.call(graph.nodes[0].config, 'retry'), false);
});

test('desativar tentativas num nó criado permanece desativado ao hidratar', () => {
  const node = createNode('send_email');
  node.config.retry = undefined;
  const graph = normalizeGraph({ nodes: [node], edges: [] });
  assert.equal(graph.nodes[0].config.retry, undefined);
});
