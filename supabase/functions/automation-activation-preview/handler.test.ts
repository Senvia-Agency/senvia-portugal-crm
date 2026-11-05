import assert from 'node:assert/strict';
import test from 'node:test';
import { handleActivationPreview, type PreviewDependencies, type PreviewFlow } from './handler.ts';

const flowId = '11111111-1111-4111-8111-111111111111';
const request = () => new Request('https://example.test/preview', { method: 'POST', body: JSON.stringify({ flow_id: flowId }) });
const flow: PreviewFlow = { organization_id: 'org', trigger_type: 'scheduled', trigger_config: { entity: 'lead', schedule: { frequency: 'daily', time: '09:00' } } };
const deps = (patch: Partial<PreviewDependencies> = {}): PreviewDependencies => ({
  authorize: async () => flow, records: async () => [{ id: '1' }, { id: '2' }],
  now: () => new Date('2026-11-04T10:00:00Z'), ...patch,
});

test('unauthorized requests never read records', async () => {
  const response = await handleActivationPreview(request(), deps({ authorize: async () => new Response(null, { status: 403 }), records: async () => { throw new Error('must not read'); } }));
  assert.equal(response.status, 403);
});

test('daily preview counts calendar candidates without claiming enrollment', async () => {
  const response = await handleActivationPreview(request(), deps());
  const result = await response.json();
  assert.deepEqual(result, { count: 2, scanned: 2, truncated: false, scope: 'calendar_candidates', as_of: '2026-11-04T10:00:00.000Z' });
});

test('before scheduled time preview does not read the entity table', async () => {
  const response = await handleActivationPreview(request(), deps({ now: () => new Date('2026-11-04T08:00:00Z'), records: async () => { throw new Error('must not read'); } }));
  assert.equal((await response.json()).count, 0);
});

test('date preview uses scheduler date offsets and ignores other dates', async () => {
  const response = await handleActivationPreview(request(), deps({
    authorize: async () => ({ ...flow, trigger_type: 'record_date', trigger_config: { entity: 'sale', date_field: 'due', offset_days: -3, time: '09:00' } }),
    records: async () => [{ due: '2026-11-07' }, { due: '2026-11-08' }, { due: null }],
  }));
  assert.equal((await response.json()).count, 1);
});

test('large preview is explicitly truncated at 5000 scanned records', async () => {
  const response = await handleActivationPreview(request(), deps({ records: async (_flow, _offset, limit) => Array.from({ length: limit }, () => ({ id: 'candidate' })) }));
  const result = await response.json();
  assert.equal(result.count, 5000);
  assert.equal(result.scanned, 5000);
  assert.equal(result.truncated, true);
});
