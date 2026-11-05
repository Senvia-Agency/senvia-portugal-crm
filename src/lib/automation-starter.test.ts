import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStarterRecipe, InvalidStarterSelection } from './automation-starter';
import { NODE_DEFINITIONS } from './automation-nodes';

test('starter connects the selected trigger to the selected first action', () => {
  const recipe = buildStarterRecipe({trigger:'client_created',audience:'all',field:'',value:'',action:'send_email'});
  assert.equal(recipe.trigger_type,'client_created');
  assert.equal(recipe.graph.nodes[1].type,'send_email');
  assert.deepEqual(recipe.graph.edges,[{id:'e1',source:'trigger',target:'first',branch:null}]);
  assert.equal(recipe.trigger_config?.filters,undefined);
});

test('starter preserves an explicit audience filter and rejects empty filtered audiences', () => {
  const selection = {trigger:'lead_created',audience:'filtered',field:' source ',value:' campaign ',action:'create_task'} as const;
  const recipe = buildStarterRecipe(selection);
  assert.deepEqual(recipe.trigger_config?.filters,{match:'all',conditions:[{field:'source',operator:'equals',value:'campaign'}]});
  assert.throws(() => buildStarterRecipe({...selection,field:''}),InvalidStarterSelection);
});

test('editing a starter draft never mutates catalogue defaults', () => {
  const original = structuredClone(NODE_DEFINITIONS.wait.defaultConfig);
  const recipe = buildStarterRecipe({trigger:'lead_created',audience:'all',field:'',value:'',action:'wait'});
  recipe.graph.nodes[1].config.amount = 999;
  assert.deepEqual(NODE_DEFINITIONS.wait.defaultConfig,original);
});
