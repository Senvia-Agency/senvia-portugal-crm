import assert from 'node:assert/strict';
import test from 'node:test';
import { handleHook, hashSecret, type HookDependencies, type HookFlow } from './handler.ts';
const flowId = '12345678-1234-1234-1234-123456789012';
const secret = 'a'.repeat(64);
const flow: HookFlow = { id: flowId, organization_id: 'trusted-org', status: 'active', trigger_type: 'inbound_webhook', trigger_config: { webhook_fields: { name: 'nome', phone: 'telefone' } } };
function fixture(overrides: Partial<HookDependencies> = {}) {
  const enrollments: Record<string, unknown>[] = [];
  const writes: string[] = [];
  const deps: HookDependencies = {
    flow: async () => flow, adminDenial: async () => new Response(null, { status: 403 }),
    readHash: async () => hashSecret(secret), writeHash: async (_id, _org, hash) => { writes.push(hash); },
    enroll: async body => { enrollments.push(body); return { enrolled: 1 }; }, ...overrides,
  };
  const request = (action = 'receive', body: unknown = { nome: 'Ana', telefone: '912345678' }, sentSecret = secret) => new Request(`https://example.test/automation-hook?flow_id=${flowId}&action=${action}`, {
    method: 'POST', headers: { 'x-senvia-hook-secret': sentSecret, 'x-event-id': 'event-1' }, body: JSON.stringify(body),
  });
  return { deps, enrollments, writes, request };
}
test('valid secret enrolls only mapped contact with trusted organization and flow', async () => {
  const f = fixture();
  const response = await handleHook(f.request('receive', { nome: 'Ana', telefone: '912345678', organization_id: 'attacker', id: 'victim', subject_type: 'lead' }), f.deps);
  assert.equal(response.status, 202);
  assert.deepEqual(f.enrollments[0], { action: 'enroll', flow_id: flowId, organization_id: 'trusted-org', trigger_type: 'inbound_webhook', subject_type: 'contact', record: { name: 'Ana', phone: '912345678' }, occurrence_key: `hook:${flowId}:event-1` });
});
test('wrong secret never calls engine', async () => {
  const f = fixture();
  assert.equal((await handleHook(f.request('receive', undefined, 'b'.repeat(64)), f.deps)).status, 401);
  assert.equal(f.enrollments.length, 0);
});
test('paused flow rejects a valid production secret', async () => {
  const f = fixture({ flow: async () => ({ ...flow, status: 'paused' }) });
  assert.equal((await handleHook(f.request(), f.deps)).status, 404);
  assert.equal(f.enrollments.length, 0);
});
test('test endpoint requires admin authorization and causes no effects', async () => {
  const denied = fixture();
  assert.equal((await handleHook(denied.request('test'), denied.deps)).status, 403);
  const allowed = fixture({ adminDenial: async () => null });
  const response = await handleHook(allowed.request('test'), allowed.deps);
  assert.deepEqual(await response.json(), { preview: { name: 'Ana', phone: '912345678' }, executed: false });
  assert.equal(allowed.enrollments.length, 0);
});
test('rotation stores only hash and returns one-time secret to authorized admin', async () => {
  const f = fixture({ adminDenial: async () => null });
  const response = await handleHook(f.request('rotate'), f.deps);
  const result = await response.json();
  assert.match(result.secret, /^[a-f0-9]{64}$/);
  assert.equal(f.writes[0], await hashSecret(result.secret));
  assert.notEqual(f.writes[0], result.secret);
});
test('invalid contact data does not enroll', async () => {
  const f = fixture();
  assert.equal((await handleHook(f.request('receive', { nome: 'Ana' }), f.deps)).status, 400);
  assert.equal(f.enrollments.length, 0);
});
