import test from 'node:test';
import assert from 'node:assert/strict';
import { readFailurePolicy, shouldPauseForFailures, InvalidFailurePolicy, retryFailedRuns } from './failure-policy.ts';

test('failure protection defaults off and requires a real sample', () => {
  assert.equal(readFailurePolicy(undefined), undefined);
  const policy = readFailurePolicy({ enabled: true, threshold_percent: 20, min_runs: 10, window_minutes: 60 });
  assert.ok(policy);
  assert.equal(shouldPauseForFailures(policy, 1, 1), false);
  assert.equal(shouldPauseForFailures(policy, 10, 2), false);
  assert.equal(shouldPauseForFailures(policy, 10, 3), true);
});
test('disabled policy never pauses despite failures', () => {
  const policy = readFailurePolicy({ enabled: false });
  assert.ok(policy);
  assert.equal(shouldPauseForFailures(policy, 100, 100), false);
});
test('invalid thresholds and sample sizes are explicit errors', () => {
  for (const patch of [{ threshold_percent: 0 }, { min_runs: 1 }, { window_minutes: 0 }]) {
    assert.throws(() => readFailurePolicy({ enabled: true, ...patch }), InvalidFailurePolicy);
  }
});

test('bulk retry reads only failed runs of the selected organization and flow', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const requested: URL[] = [];
  const db = createClient('https://example.test', 'service-test', { global: { fetch: async input => {
    requested.push(new URL(input instanceof Request ? input.url : String(input)));
    return new Response(JSON.stringify([{ id: 'run-1' }, { id: 'run-2' }]), { headers: { 'Content-Type': 'application/json' } });
  } } });
  const order: string[] = [];
  const result = await retryFailedRuns(db, { flowId: 'flow-a', organizationId: 'org-a', runIds: ['run-1', 'run-2'], limit: 2 }, async id => {
    order.push(id); return { run_id: id, status: 'completed' };
  });
  assert.equal(requested[0].searchParams.get('flow_id'), 'eq.flow-a');
  assert.equal(requested[0].searchParams.get('organization_id'), 'eq.org-a');
  assert.equal(requested[0].searchParams.get('status'), 'eq.failed');
  assert.match(requested[0].searchParams.get('or') ?? '', /__test/);
  assert.deepEqual(order, ['run-1', 'run-2']);
  assert.equal(result.results.length, 2);
});
test('bulk retry rejects an invalid batch before reading the database', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  let queried = false;
  const db = createClient('https://example.test', 'service-test', { global: { fetch: async () => {
    queried = true; return new Response('[]');
  } } });
  await assert.rejects(retryFailedRuns(db, { flowId: 'flow', organizationId: 'org', limit: 101 }, async () => undefined), InvalidFailurePolicy);
  assert.equal(queried, false);
});
