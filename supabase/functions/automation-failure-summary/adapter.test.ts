import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { settleFailureSummary } from './adapter.ts';
import type { FailureSummary } from './handler.ts';

const summary: FailureSummary = { flow_id: 'flow', flow_ids: ['flow'], organization_id: 'org', owner_id: 'owner', failed: 2, summary_date: '2026-11-04', claim_token: 'token' };
function schemaAwareClient(stale = false) {
  const updates: { table: string; payload: Record<string, unknown>; url: URL }[] = [];
  const schemas: Readonly<Record<string, readonly string[]>> = {
    automation_failure_summary_recipients: ['status', 'finished_at', 'lease_until'],
    automation_failure_summary_claims: ['status', 'finished_at'],
  };
  const db = createClient('https://example.test', 'service-test', { global: { fetch: async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const table = url.pathname.split('/').at(-1) ?? '';
    const payload = JSON.parse(String(init?.body ?? '{}'));
    if (Object.keys(payload).some(column => !schemas[table]?.includes(column))) {
      return new Response(JSON.stringify({ message: 'Column does not exist', code: 'PGRST204' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    updates.push({ table, payload, url });
    if (table === 'automation_failure_summary_recipients') return stale
      ? new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      : new Response(JSON.stringify([{ organization_id: 'org' }]), { headers: { 'Content-Type': 'application/json' } });
    return new Response(null, { status: 204 });
  } } });
  return { db, updates };
}

test('real index settlement adapter updates only columns present in each SQL table', async () => {
  const f = schemaAwareClient();
  await settleFailureSummary(f.db, summary, false, new Date('2026-11-04T09:00:00Z'));
  assert.equal(f.updates.length, 2);
  assert.equal(f.updates[0].payload.lease_until, '2026-11-04T09:15:00.000Z');
  assert.equal(f.updates[1].payload.status, 'failed');
  assert.equal('lease_until' in f.updates[1].payload, false);
  assert.equal(f.updates[0].url.searchParams.get('claim_token'), 'eq.token');
});
test('stale claim token never changes individual flow delivery status', async () => {
  const f = schemaAwareClient(true);
  await settleFailureSummary(f.db, summary, true, new Date('2026-11-04T09:00:00Z'));
  assert.equal(f.updates.length, 1);
});
