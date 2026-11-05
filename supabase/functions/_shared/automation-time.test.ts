import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAutomationWakeAt, AutomationTimeError } from './automation-time.ts';

const wake = (config: Record<string, unknown>, now: string, vars = {}) => calculateAutomationWakeAt(config, vars, new Date(now)).toISOString();

test('legacy duration preserves units and amount fallback', () => {
  assert.equal(wake({ duration: 2, unit: 'hours' }, '2026-11-04T08:00:00Z'), '2026-11-04T10:00:00.000Z');
});

test('date field supports a local calendar offset and selected time', () => {
  assert.equal(wake({ wait_mode: 'date', date_field: 'due', offset_days: -2, at_time: '09:00' }, '2026-10-01T00:00:00Z', { due: '2026-10-26' }), '2026-10-24T08:00:00.000Z');
});

test('business wait advances a Friday evening over weekend and winter DST change', () => {
  assert.equal(wake({ wait_mode: 'business' }, '2026-10-23T18:00:00Z'), '2026-10-26T09:00:00.000Z');
});

test('business wait advances over summer DST change', () => {
  assert.equal(wake({ wait_mode: 'business' }, '2026-03-27T19:00:00Z'), '2026-03-30T08:00:00.000Z');
});

test('within business window execution may proceed now', () => {
  assert.equal(wake({ wait_mode: 'business' }, '2026-07-01T11:30:15Z'), '2026-07-01T11:30:15.000Z');
});

test('business opening is inclusive and closing is exclusive', () => {
  assert.equal(wake({ wait_mode: 'business' }, '2026-11-04T09:00:00Z'), '2026-11-04T09:00:00.000Z');
  assert.equal(wake({ wait_mode: 'business' }, '2026-11-04T18:00:00Z'), '2026-11-05T09:00:00.000Z');
});

test('invalid or absent dates and invalid windows produce explicit errors', () => {
  for (const due of [undefined, '2026-02-30', 'banana']) {
    assert.throws(() => calculateAutomationWakeAt({ wait_mode: 'date', date_field: 'due' }, { due }, new Date()), AutomationTimeError);
  }
  assert.throws(() => calculateAutomationWakeAt({ wait_mode: 'business', business_start: '18:00', business_end: '09:00' }, {}, new Date()), AutomationTimeError);
});

test('past date returns now and never schedules a negative wait', () => {
  assert.equal(wake({ wait_mode: 'date', date_field: 'due', at_time: '09:00' }, '2026-11-04T10:00:00Z', { due: '2026-11-01' }), '2026-11-04T10:00:00.000Z');
});

test('date-only preserves midnight Lisbon in summer', () => {
  assert.equal(wake({ wait_mode: 'date', date_field: 'due' }, '2026-05-01T00:00:00Z', { due: '2026-07-01' }), '2026-06-30T23:00:00.000Z');
});

test('date timestamp preserves Lisbon local clock over a calendar DST offset', () => {
  assert.equal(wake({ wait_mode: 'date', date_field: 'due', offset_days: 3 }, '2026-03-01T00:00:00Z', { due: '2026-03-27T09:00:00Z' }), '2026-03-30T08:00:00.000Z');
});

test('custom business hours before opening schedule same day', () => {
  assert.equal(wake({ wait_mode: 'business', business_start: '10:30', business_end: '16:00' }, '2026-07-01T07:00:00Z'), '2026-07-01T09:30:00.000Z');
});

test('nonexistent local time during spring change fails explicitly', () => {
  assert.throws(() => calculateAutomationWakeAt({ wait_mode: 'date', date_field: 'due', at_time: '01:30' }, { due: '2026-03-29' }, new Date('2026-03-01T00:00:00Z')), AutomationTimeError);
});

test('unknown modes and malformed clocks fail explicitly', () => {
  assert.throws(() => calculateAutomationWakeAt({ wait_mode: 'other' }, {}, new Date()), AutomationTimeError);
  assert.throws(() => calculateAutomationWakeAt({ wait_mode: 'business', business_start: '24:00' }, {}, new Date()), AutomationTimeError);
});
