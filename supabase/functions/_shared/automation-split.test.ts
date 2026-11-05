import assert from 'node:assert/strict';
import test from 'node:test';
import { deterministicAssignment, AutomationSplitError } from './automation-split.ts';

const variants = [{ id: 'a', label: 'A', weight: 50 }, { id: 'b', label: 'B', weight: 50 }];

test('same flow and subject retain assignment across executions', () => {
  const first = deterministicAssignment('flow', 'subject', variants);
  for (let repeat = 0; repeat < 10; repeat += 1) assert.equal(deterministicAssignment('flow', 'subject', variants), first);
  assert.ok(['a', 'b'].includes(first));
});

test('weighted assignment covers both branches without random state', () => {
  const counts: Record<string, number> = { a: 0, b: 0 };
  for (let subject = 0; subject < 1000; subject += 1) counts[deterministicAssignment('flow', `subject-${subject}`, variants)] += 1;
  assert.ok(counts.a > 350 && counts.a < 650);
  assert.equal(counts.a + counts.b, 1000);
});

test('one 100 percent variant always wins', () => {
  assert.equal(deterministicAssignment('flow', 'subject', [{ id: 'only', weight: 100 }]), 'only');
});

test('invalid ids weights and totals fail explicitly', () => {
  for (const invalid of [[], [{ id: 'a', weight: 50 }], [{ id: 'a', weight: 0 }, { id: 'b', weight: 100 }], [{ id: 'a', weight: 50 }, { id: 'a', weight: 50 }], [{ id: '', weight: 100 }]]) {
    assert.throws(() => deterministicAssignment('flow', 'subject', invalid), AutomationSplitError);
  }
});

test('fixed assignment vectors preserve compatibility across releases', () => {
  assert.equal(deterministicAssignment('flow', 'subject', variants), 'b');
  assert.equal(deterministicAssignment('flow-two', 'subject', variants), 'a');
  assert.equal(deterministicAssignment('flow', 'contact-42', variants), 'a');
});
