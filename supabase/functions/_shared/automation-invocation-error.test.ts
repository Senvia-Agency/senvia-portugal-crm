import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAutomationInvocationError } from './automation-invocation-error.ts';
import { decideAutomationRetry } from './automation-retry.ts';
for (const [status, expected] of [[503, 'retry'], [429, 'retry'], [400, 'fail']] as const) {
  test(`HTTP ${status} from real Response context is classified as ${expected}`, () => {
    const error = { message: 'Edge Function returned a non-2xx status code', context: new Response(null, { status }) };
    const message = formatAutomationInvocationError(error, 'Email falhou');
    assert.equal(decideAutomationRetry({ max_attempts: 3, interval_minutes: 1 }, undefined,
      { message }, new Date('2026-11-04T10:00:00Z')).kind, expected);
    assert.equal(error.context.bodyUsed, false);
  });
}
test('invalid provider context statuses cannot manufacture transient HTTP failures', () => {
  for (const status of [200, 600, '503', 503.5, NaN]) {
    const message = formatAutomationInvocationError({ message: 'invalid response', context: { status } }, 'Otto falhou');
    assert.equal(message, 'Otto falhou: invalid response');
  }
});
test('non-HTTP errors and empty error values produce useful bounded labels', () => {
  assert.equal(formatAutomationInvocationError(new Error('timeout'), 'Otto falhou'), 'Otto falhou: timeout');
  assert.equal(formatAutomationInvocationError(null, 'Otto falhou'), 'Otto falhou');
  assert.equal(formatAutomationInvocationError({ context: { status: 503 } }, 'Email falhou'), 'Email falhou HTTP 503');
});
