import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTION_TYPES, getNodeDefinition, getNodeBranches } from './automation-nodes';
import { createNode } from './automation-graph';
import { nodeOutput } from './automation-io';

test('publicação no Feed é ação CRM linear sem tentativas padrão', () => {
  const definition = getNodeDefinition('publish_feed');
  assert.equal(definition?.category, 'crm');
  assert.equal(definition?.isTrigger, false);
  assert.ok(ACTION_TYPES.some(type => type === 'publish_feed'));
  const node = createNode('publish_feed');
  assert.deepEqual(node.config, { title: '', message: '' });
  assert.deepEqual(getNodeBranches(node), []);
});

test('metadados de publicação identificam o post na organização', () => {
  const output = nodeOutput(createNode('publish_feed'), 'lead_created');
  assert.ok(output?.fields.some(field => field.key === 'post_id'));
});
