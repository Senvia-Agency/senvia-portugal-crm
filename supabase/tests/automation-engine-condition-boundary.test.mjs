import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, database, fixture } from './automation-engine-runtime-harness.mjs';

async function executeCondition(config) {
  const { Engine } = runtime();
  const { run, flow } = fixture([
    { id: 'condition', type: 'condition', config }, { id: 'downstream', type: 'end', config: {} },
  ], [{ source: 'condition', target: 'downstream', branch: 'yes' }]);
  const db = database(run, flow);
  await new Engine(db).advance(run, flow, 'condition');
  return { run, db };
}

test('blank condition cannot approve a downstream action', async () => {
  const { run, db } = await executeCondition({ conditions: [{}], match: 'all' });
  assert.equal(run.status, 'failed');
  assert.deepEqual(db.steps.map(step => step.node_id), ['condition']);
});

test('deeply nested condition groups fail explicitly', async () => {
  let config = { field: 'source', operator: 'equals', value: 'web' };
  for (let depth = 0; depth < 32; depth += 1) config = { match: 'all', conditions: [config] };
  const { run, db } = await executeCondition(config);
  assert.equal(run.status, 'failed');
  assert.deepEqual(db.steps.map(step => step.node_id), ['condition']);
});

test('unknown node fails without silently advancing to the next effect', async () => {
  const { Engine } = runtime();
  const { run, flow } = fixture([
    { id: 'unknown', type: 'newer_unknown_action', config: {} }, { id: 'downstream', type: 'end', config: {} },
  ], [{ source: 'unknown', target: 'downstream' }]);
  const db = database(run, flow);
  await new Engine(db).advance(run, flow, 'unknown');
  assert.equal(run.status, 'failed');
  assert.deepEqual(db.steps.map(step => step.node_id), ['unknown']);
});
