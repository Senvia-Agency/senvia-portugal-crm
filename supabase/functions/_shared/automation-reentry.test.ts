import assert from 'node:assert/strict';
import test from 'node:test';
import { readReentryCooldownDays, reentryCooldownDecision, InvalidAutomationReentry } from './automation-reentry.ts';

test('cooldown defaults to zero and accepts bounded whole days', () => {
  assert.equal(readReentryCooldownDays(undefined), 0);
  assert.equal(readReentryCooldownDays(30), 30);
  assert.equal(readReentryCooldownDays(3660), 3660);
});

test('invalid cooldown never becomes an unbounded or silent zero interval', () => {
  for (const value of [-1, 3661, 0.5, '30', null, NaN, Infinity]) {
    assert.throws(() => readReentryCooldownDays(value), InvalidAutomationReentry);
  }
});

test('cooldown uses completion time and allows entry at exact interval boundary', () => {
  const finished = '2026-10-05T10:00:00Z';
  assert.equal(reentryCooldownDecision(30, finished, new Date('2026-11-04T09:59:59Z')).allowed, false);
  assert.equal(reentryCooldownDecision(30, finished, new Date('2026-11-04T10:00:00Z')).allowed, true);
});

test('first entry and zero interval are immediately eligible', () => {
  assert.equal(reentryCooldownDecision(30, undefined, new Date()).allowed, true);
  assert.equal(reentryCooldownDecision(0, '2026-11-04T10:00:00Z', new Date('2026-11-04T10:00:00Z')).allowed, true);
});

test('invalid prior terminal timestamp fails explicitly', () => {
  assert.throws(() => reentryCooldownDecision(30, 'not-a-date', new Date()), InvalidAutomationReentry);
});
