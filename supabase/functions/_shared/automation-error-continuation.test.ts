import assert from 'node:assert/strict';
import test from 'node:test';
import { planAutomationErrorContinuation } from './automation-error-continuation.ts';

test('failed conditions and routers cannot implicitly follow the first business branch', () => {
  for (const type of ['condition', 'router', 'wait_until']) {
    const result = planAutomationErrorContinuation({ id: 'node', type, config: { on_error: 'continue' } }, [{ source: 'node', target: 'wrong-business-action', branch: 'yes' }]);
    assert.equal(result.kind, 'fail');
  }
});

test('error branch stays explicit and never chooses the business output', () => {
  const result = planAutomationErrorContinuation({ id: 'node', type: 'condition', config: { on_error: 'error_branch' } }, [{ source: 'node', target: 'business', branch: 'yes' }, { source: 'node', target: 'recovery', branch: 'error' }]);
  assert.deepEqual(result, { kind: 'next', branch: 'error' });
});

test('linear continuation uses only default routing even with no successors', () => {
  const node = { id: 'node', type: 'send_email', config: { on_error: 'continue' } };
  assert.deepEqual(planAutomationErrorContinuation(node, [{ source: 'node', target: 'next', branch: null }]), { kind: 'next', branch: 'default' });
  assert.deepEqual(planAutomationErrorContinuation(node, []), { kind: 'next', branch: 'default' });
});

test('a decision can continue only when an explicit default continuation exists', () => {
  assert.deepEqual(planAutomationErrorContinuation({ id: 'node', type: 'router', config: { on_error: 'continue' } }, [{ source: 'node', target: 'next', branch: 'default' }]), { kind: 'next', branch: 'default' });
});
