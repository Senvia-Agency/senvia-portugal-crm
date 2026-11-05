import type { AutomationGraph } from '@/types/automations';
import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTOMATION_RECIPES } from './automation-recipes';
import { RECIPE_OBJECTIVES, recipeObjective } from './automation-recipe-library';
import { NODE_DEFINITIONS, getNodeBranches } from './automation-nodes';

test('recipes cover every business objective and preserve the existing catalogue', () => {
  assert.ok(AUTOMATION_RECIPES.length >= 20);
  assert.equal(new Set(AUTOMATION_RECIPES.map(recipe => recipe.id)).size, AUTOMATION_RECIPES.length);
  assert.ok(AUTOMATION_RECIPES.some(recipe => recipe.id === 'boas-vindas-lead'));
  for (const objective of RECIPE_OBJECTIVES) assert.ok(AUTOMATION_RECIPES.some(recipe => recipeObjective(recipe) === objective.key));
});

test('all recipe edges connect supported nodes and valid branch handles', () => {
  for (const recipe of AUTOMATION_RECIPES) {
    const nodes = new Map(recipe.graph.nodes.map(node => [node.id, node]));
    assert.equal(nodes.size, recipe.graph.nodes.length, recipe.id);
    assert.equal(nodes.get(recipe.entry_node_id)?.type, recipe.trigger_type, recipe.id);
    for (const node of recipe.graph.nodes) assert.ok(NODE_DEFINITIONS[node.type], `${recipe.id}:${node.type}`);
    for (const edge of recipe.graph.edges) {
      const source = nodes.get(edge.source);
      assert.ok(source && nodes.has(edge.target), `${recipe.id}:${edge.id}`);
      if (edge.branch) assert.ok(getNodeBranches(source).some(branch => branch.key === edge.branch), `${recipe.id}:${edge.branch}`);
    }
  }
});

test('all recipe nodes are reachable and scheduled lead recovery requires a segment', () => {
  for (const recipe of AUTOMATION_RECIPES) {
    const visited = new Set([recipe.entry_node_id]);
    for (let index = 0; index < recipe.graph.nodes.length; index += 1) {
      for (const edge of recipe.graph.edges) if (visited.has(edge.source)) visited.add(edge.target);
    }
    assert.equal(visited.size, recipe.graph.nodes.length, recipe.id);
  }
  const scheduled = AUTOMATION_RECIPES.find(recipe => recipe.id === 'reactivacao-por-segmento');
  assert.deepEqual(scheduled?.trigger_config?.recipe_required_fields, [{node_id:'trigger',field:'filters',label:'Defina o segmento de leads a inscrever.'}]);
});

test('scheduled recipe cannot activate until a real segment is configured', async () => {
  const { validateAutomationConfiguration } = await import('./automation-validation');
  const recipe = AUTOMATION_RECIPES.find(item => item.id === 'reactivacao-por-segmento');
  assert.ok(recipe);
  const before = validateAutomationConfiguration(recipe.graph, { triggerConfig: recipe.trigger_config });
  assert.ok(before.some(issue => issue.nodeId === 'trigger' && issue.severity === 'error'));
  const graph: AutomationGraph = {
    ...recipe.graph,
    nodes: recipe.graph.nodes.map(node => node.id === 'trigger'
      ? { ...node, config: { ...node.config, filters: { match: 'all', conditions: [{ field: 'status', operator: 'equals', value: 'contacted' }] } } }
      : node),
  };
  const after = validateAutomationConfiguration(graph, { triggerConfig: recipe.trigger_config });
  assert.equal(after.filter(issue => issue.nodeId === 'trigger' && issue.severity === 'error').length, 0);
});
