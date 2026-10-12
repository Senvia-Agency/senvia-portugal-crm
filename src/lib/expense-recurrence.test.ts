import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defaultSchedule,
  describeSchedule,
  maxDueDay,
  monthlyEquivalent,
  pausedScheduleOf,
  scheduleOf,
  shortMonthNote,
  withFrequency,
} from './expense-recurrence.ts';

// Wednesday 14 October 2026.
const wednesday = new Date(2026, 9, 14);

test('a new schedule falls due on the expense\'s own date', () => {
  assert.deepEqual(defaultSchedule(wednesday), { frequency: 'monthly', day: 14, month: null });
  assert.deepEqual(defaultSchedule(wednesday, 'weekly'), { frequency: 'weekly', day: 3, month: null });
  assert.deepEqual(defaultSchedule(wednesday, 'yearly'), { frequency: 'yearly', day: 14, month: 10 });
  assert.equal(defaultSchedule(new Date(2026, 9, 18), 'weekly').day, 7, 'Sunday is ISO day 7');
});

test('switching frequency keeps a day that still fits', () => {
  const monthly25 = { frequency: 'monthly' as const, day: 25, month: null };
  assert.deepEqual(withFrequency(monthly25, 'quarterly', wednesday), { frequency: 'quarterly', day: 25, month: null });
  assert.deepEqual(withFrequency(monthly25, 'yearly', wednesday), { frequency: 'yearly', day: 25, month: 10 });
  // A day of the month means nothing as a weekday, and back.
  assert.deepEqual(withFrequency(monthly25, 'weekly', wednesday), { frequency: 'weekly', day: 3, month: null });
  assert.deepEqual(withFrequency({ frequency: 'weekly', day: 5, month: null }, 'monthly', wednesday),
    { frequency: 'monthly', day: 14, month: null });
});

test('describes each schedule in Portuguese', () => {
  assert.equal(describeSchedule({ frequency: 'monthly', day: 5, month: null }), 'Mensal · dia 5');
  assert.equal(describeSchedule({ frequency: 'quarterly', day: 31, month: null }), 'Trimestral · dia 31');
  assert.equal(describeSchedule({ frequency: 'yearly', day: 15, month: 3 }), 'Anual · 15 de março');
  assert.equal(describeSchedule({ frequency: 'weekly', day: 1, month: null }), 'Semanal · à segunda-feira');
  assert.equal(describeSchedule({ frequency: 'weekly', day: 6, month: null }), 'Semanal · ao sábado');
});

test('warns only about due days a period can lack', () => {
  assert.equal(shortMonthNote({ frequency: 'monthly', day: 28, month: null }), null);
  assert.equal(shortMonthNote({ frequency: 'monthly', day: 31, month: null }), 'Nos meses sem dia 31, vence no último dia do mês.');
  assert.equal(shortMonthNote({ frequency: 'yearly', day: 31, month: 1 }), null);
  assert.match(shortMonthNote({ frequency: 'yearly', day: 29, month: 2 }) ?? '', /28 de fevereiro/);
  assert.equal(maxDueDay('yearly', 4), 30);
  assert.equal(maxDueDay('yearly', 2), 29);
  assert.equal(maxDueDay('weekly', null), 7);
});

test('monthly equivalent of each frequency', () => {
  assert.equal(monthlyEquivalent(10, 'weekly'), 43.33);
  assert.equal(monthlyEquivalent(10, 'monthly'), 10);
  assert.equal(monthlyEquivalent(30, 'quarterly'), 10);
  assert.equal(monthlyEquivalent(120, 'yearly'), 10);
});

test('reads the schedule stored on an expense', () => {
  assert.deepEqual(
    scheduleOf({ is_recurring: true, recurrence_frequency: 'yearly', recurrence_day: 15, recurrence_month: 3 }),
    { frequency: 'yearly', day: 15, month: 3 });
  assert.equal(scheduleOf({ is_recurring: false, recurrence_frequency: 'monthly', recurrence_day: 5 }), null);
  assert.equal(scheduleOf({ is_recurring: true, recurrence_frequency: null, recurrence_day: null }), null);
});

test('a paused expense keeps its schedule', () => {
  const paused = { is_recurring: false, recurrence_frequency: 'monthly', recurrence_day: 5, recurrence_month: null };
  assert.deepEqual(pausedScheduleOf(paused), { frequency: 'monthly', day: 5, month: null });
  assert.equal(pausedScheduleOf({ ...paused, is_recurring: true }), null, 'running, not paused');
  assert.equal(pausedScheduleOf({ is_recurring: false, recurrence_frequency: null, recurrence_day: null }), null, 'plain expense');
});
