import test from 'node:test';
import assert from 'node:assert/strict';
import { eligiblePersistedReply, replyRuleBranch } from './reply-reconcile.ts';
const fact = { ultima_resposta: 'Sim', ultima_resposta_received_at: '2026-11-04T10:01:00Z', __reply_after_wait: '2026-11-04T10:00:00Z' };
test('persisted reply can recover while engine was offline and uses same rule matcher', () => {
  assert.deepEqual(eligiblePersistedReply(fact, 'wait', null, '2026-11-04T11:00:00Z'), { text: 'Sim', receivedAt: fact.ultima_resposta_received_at });
  assert.deepEqual(replyRuleBranch('Sim', [{ id: 'yes', label: 'Sim' }]), { branch: 'yes', label: 'Sim' });
});
test('old response cannot release new loop visit or be consumed twice', () => {
  assert.equal(eligiblePersistedReply({ ...fact, __reply_after_wait: '2026-11-04T10:02:00Z' }, 'wait', null, null), null);
  assert.equal(eligiblePersistedReply({ ...fact, __reply_consumed_at: fact.ultima_resposta_received_at }, 'wait', null, null), null);
});
test('legacy wait uses explicit fallback and rejects responses after original timeout', () => {
  const legacy = { ultima_resposta: '1', ultima_resposta_received_at: fact.ultima_resposta_received_at };
  assert.ok(eligiblePersistedReply(legacy, 'wait', '2026-11-04T10:00:00Z', '2026-11-04T10:01:00Z'));
  assert.equal(eligiblePersistedReply(legacy, 'wait', null, null), null);
  assert.equal(eligiblePersistedReply(legacy, 'wait', '2026-11-04T10:00:00Z', '2026-11-04T10:00:59Z'), null);
});

test('same-second provider time does not drop a reply ingested after the millisecond boundary', () => {
  const providerSentAt = '2026-11-04T10:00:00Z';
  const after = '2026-11-04T10:00:00.450Z';
  const createdAt = '2026-11-04T10:00:00.900Z';
  assert.ok(Date.parse(providerSentAt) < Date.parse(after));
  const result = eligiblePersistedReply({ ultima_resposta: 'Sim', ultima_resposta_received_at: createdAt, __reply_after_wait: after }, 'wait', null, '2026-11-04T10:10:00Z');
  assert.equal(result?.receivedAt, createdAt);
});
