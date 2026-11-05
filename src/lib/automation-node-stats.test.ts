import assert from 'node:assert/strict';
import test from 'node:test';
import { countUniqueNodeRuns } from './automation-node-stats.ts';

test('visitas repetidas do mesmo percurso contam uma passagem por nó canónico', () => {
  const steps = [
    { run_id: 'r1', node_id: 'ab', status: 'ok', detail: {} },
    { run_id: 'r1', node_id: '__visit:ab:2', status: 'ok', detail: { canonical_node_id: 'ab', visit: 2 } },
    { run_id: 'r2', node_id: '__visit:ab:3', status: 'ok', detail: { canonical_node_id: 'ab', visit: 3 } },
  ];
  assert.deepEqual(countUniqueNodeRuns(steps), { ab: { passed: 2, failed: 0 } });
});

test('tentativas de falha são deduplicadas separadamente da passagem bem sucedida', () => {
  const steps = [
    { run_id: 'r1', node_id: 'mail', status: 'failed', detail: {} },
    { run_id: 'r1', node_id: '__visit:mail:2', status: 'failed', detail: { canonical_node_id: 'mail' } },
    { run_id: 'r1', node_id: '__visit:mail:3', status: 'ok', detail: { canonical_node_id: 'mail' } },
  ];
  assert.deepEqual(countUniqueNodeRuns(steps), { mail: { passed: 1, failed: 1 } });
});
