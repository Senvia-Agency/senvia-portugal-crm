import assert from 'node:assert/strict';
import test from 'node:test';
import { decideAutomationRetry } from './automation-retry.ts';

const now = new Date('2026-11-04T10:00:00Z');
const policy = { max_attempts: 3, interval_minutes: 5 };

test('transient error schedules first retry with persisted failure count', () => {
  const result = decideAutomationRetry(policy, undefined, { message: 'provider rejected request', status: 429 }, now);
  assert.deepEqual(result, {
    kind: 'retry', wakeAt: new Date('2026-11-04T10:05:00Z'),
    state: { attempts: 1, next_attempt_at: '2026-11-04T10:05:00.000Z' },
  });
});

test('max_attempts includes original execution and stops third failure', () => {
  assert.equal(decideAutomationRetry(policy, { attempts: 1 }, { message: 'timeout' }, now).kind, 'retry');
  assert.deepEqual(decideAutomationRetry(policy, { attempts: 2 }, { message: 'timeout' }, now), { kind: 'fail', reason: 'attempts_exhausted' });
});

test('one attempt never schedules retry', () => {
  assert.deepEqual(decideAutomationRetry({ max_attempts: 1, interval_minutes: 5 }, undefined, { status: 503 }, now), { kind: 'fail', reason: 'attempts_exhausted' });
});

test('missing policy does not silently enable retries', () => {
  assert.deepEqual(decideAutomationRetry(undefined, undefined, { status: 503 }, now), { kind: 'fail', reason: 'disabled' });
});

test('validation and permission errors fail immediately even if message mentions timeout', () => {
  for (const status of [400, 401, 403, 404, 422]) {
    assert.deepEqual(decideAutomationRetry(policy, undefined, { message: 'timeout permission failure', status }, now), { kind: 'fail', reason: 'not_transient' });
  }
});

test('timeouts and disconnected channel messages are transient without status', () => {
  for (const message of ['Request timed out', 'fetch failed: ECONNRESET', 'WhatsApp desligado', 'canal desconectado']) {
    assert.equal(decideAutomationRetry(policy, undefined, { message }, now).kind, 'retry');
  }
});

test('unknown failure is never retried by assumption', () => {
  assert.deepEqual(decideAutomationRetry(policy, undefined, { message: 'Email rejeitado: template inexistente' }, now), { kind: 'fail', reason: 'not_transient' });
});

test('invalid retry config and state do not restart counters', () => {
  for (const invalid of [{ max_attempts: 99, interval_minutes: 5 }, { max_attempts: 3, interval_minutes: 0 }, { max_attempts: 2.5, interval_minutes: 5 }]) {
    assert.deepEqual(decideAutomationRetry(invalid, undefined, { status: 503 }, now), { kind: 'fail', reason: 'invalid_policy' });
  }
  assert.deepEqual(decideAutomationRetry(policy, { attempts: 'broken' }, { status: 503 }, now), { kind: 'fail', reason: 'invalid_state' });
});
