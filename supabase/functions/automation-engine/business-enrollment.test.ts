import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { executeBusinessAction } from './business-actions.ts';

const input = { type: 'execute_flow', config: { flow_id: 'target' }, vars: {}, run: {
  id: 'run', flow_id: 'source', organization_id: 'org', subject_type: 'lead', subject_id: 'lead',
  contact_name: 'Ana', contact_email: null, contact_phone: '912345678', context: {},
} };
function database(response: unknown, status = 200) {
  return createClient('https://automation.test', 'service-test-key', { auth: { persistSession: false }, global: {
    fetch: async (request) => {
      const url = new URL(typeof request === 'string' ? request : request instanceof URL ? request.href : request.url);
      const payload = url.pathname.startsWith('/rest/') ? { id: 'target', trigger_type: 'lead_created' } : response;
      return new Response(JSON.stringify(payload), { status: url.pathname.startsWith('/rest/') ? 200 : status,
        headers: { 'content-type': 'application/json' } });
    },
  } });
}
test('nested engine errors fail the action even when HTTP invocation succeeds', async () => {
  const result = await executeBusinessAction(database({ enrolled: 0, results: [{ flow: 'target', error: '503 database unavailable' }] }), input);
  assert.equal(result?.kind, 'fail');
  if (result?.kind === 'fail') assert.match(result.error, /503 database unavailable/);
});
test('legitimate reentry skips preserve their reason in the step history', async () => {
  const result = await executeBusinessAction(database({ enrolled: 0, results: [{ flow: 'target', skipped: 'já tem um percurso ativo' }] }), input);
  assert.deepEqual(result, { kind: 'next', detail: { fluxo: 'target', inscritos: 0, ignorado: 'já tem um percurso ativo' } });
});
test('a successful enrollment retains the number of created runs', async () => {
  const result = await executeBusinessAction(database({ enrolled: 1, results: [{ flow: 'target', run: 'child' }] }), input);
  assert.deepEqual(result, { kind: 'next', detail: { fluxo: 'target', inscritos: 1 } });
});
test('an empty unexplained engine result is not reported as success', async () => {
  const result = await executeBusinessAction(database({ enrolled: 0, results: [] }), input);
  assert.equal(result?.kind, 'fail');
});
test('real FunctionsHttpError context preserves retryable HTTP status', async () => {
  const result = await executeBusinessAction(database({ error: 'unavailable' }, 503), input);
  assert.equal(result?.kind, 'fail');
  if (result?.kind === 'fail') assert.match(result.error, /HTTP 503/);
});
