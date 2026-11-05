import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFailureSummary, type FailureSummary } from './handler.ts';
const item: FailureSummary = { flow_id: 'flow', flow_ids: ['flow'], organization_id: 'org', owner_id: 'owner', failed: 3, summary_date: '2026-11-04', claim_token: 'token-1' };
function fixture(authorized = true, instant = '2026-11-04T09:00:00Z') {
  let claimed = false;
  const sent: FailureSummary[] = [];
  const settled: boolean[] = [];
  const dependencies = {
    authorize: async () => authorized, now: () => new Date(instant),
    claim: async () => { if (claimed) return []; claimed = true; return [item]; },
    notify: async (summary: FailureSummary) => { sent.push(summary); return true; },
    settle: async (_summary: FailureSummary, success: boolean) => { settled.push(success); },
  };
  return { dependencies, sent, settled };
}
test('only authorized internal calls may claim summaries', async () => {
  const f = fixture(false);
  const response = await handleFailureSummary(new Request('https://example.test'), f.dependencies);
  assert.equal(response.status, 401); assert.equal(f.sent.length, 0);
});
test('summary runs at nine Lisbon time and repeated calls cannot resend claimed item', async () => {
  const f = fixture();
  await handleFailureSummary(new Request('https://example.test'), f.dependencies);
  await handleFailureSummary(new Request('https://example.test'), f.dependencies);
  assert.equal(f.sent.length, 1); assert.deepEqual(f.settled, [true]);
});
test('hour gate follows Lisbon summer offset', async () => {
  const f = fixture(true, '2026-07-04T09:00:00Z');
  const response = await handleFailureSummary(new Request('https://example.test'), f.dependencies);
  assert.equal(f.sent.length, 0); assert.equal((await response.json()).skipped, 'fora do horário do resumo');
});
test('notification rejection is recorded and not silently marked sent', async () => {
  const f = fixture();
  await handleFailureSummary(new Request('https://example.test'), { ...f.dependencies, notify: async () => false });
  assert.deepEqual(f.settled, [false]);
});
test('summary sends at nine Lisbon time during summer too', async () => {
  const f = fixture(true, '2026-07-04T08:00:00Z');
  await handleFailureSummary(new Request('https://example.test'), f.dependencies);
  assert.equal(f.sent.length, 1);
});
test('a failed delivery can be claimed later and successful delivery is not sent again', async () => {
  let attempt = 0;
  let sent = false;
  const settled: boolean[] = [];
  const dependencies = {
    authorize: async () => true, now: () => new Date('2026-11-04T09:15:00Z'),
    claim: async () => sent ? [] : [{ ...item, claim_token: `lease-${attempt + 1}` }],
    notify: async () => { attempt += 1; return attempt > 1; },
    settle: async (_summary: FailureSummary, success: boolean) => { settled.push(success); sent = success; },
  };
  await handleFailureSummary(new Request('https://example.test'), dependencies);
  await handleFailureSummary(new Request('https://example.test'), dependencies);
  await handleFailureSummary(new Request('https://example.test'), dependencies);
  assert.deepEqual(settled, [false, true]);
  assert.equal(attempt, 2);
});
