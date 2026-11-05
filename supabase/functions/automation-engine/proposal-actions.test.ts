import assert from 'node:assert/strict';
import test from 'node:test';
import { proposalExpiryDecision } from './proposal-actions.ts';
import { InvalidCrmAction } from './crm-actions.ts';

test('only draft or sent proposals beyond their factual validity can expire', () => {
  assert.equal(proposalExpiryDecision('draft', '2026-11-03', '2026-11-04'), 'expire');
  assert.equal(proposalExpiryDecision('sent', '2026-11-03', '2026-11-04'), 'expire');
});
test('a validity date includes the whole local day', () => {
  assert.throws(() => proposalExpiryDecision('sent', '2026-11-04', '2026-11-04'), InvalidCrmAction);
  assert.throws(() => proposalExpiryDecision('sent', '2026-11-05', '2026-11-04'), InvalidCrmAction);
});
test('accepted rejected and negotiating proposals are not expired automatically', () => {
  for (const status of ['accepted', 'rejected', 'negotiating']) {
    assert.throws(() => proposalExpiryDecision(status, '2026-11-01', '2026-11-04'), InvalidCrmAction);
  }
});
test('missing validity never becomes an invented deadline', () => {
  assert.throws(() => proposalExpiryDecision('sent', null, '2026-11-04'), InvalidCrmAction);
});
test('an already expired proposal is a stable no-op', () => {
  assert.equal(proposalExpiryDecision('expired', null, '2026-11-04'), 'already_expired');
});
