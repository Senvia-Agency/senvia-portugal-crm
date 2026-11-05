import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduledOccurrence, recordDateOccurrence, ScheduleConfigError } from './calendar.ts';
test('daily catches up after the configured time in Lisbon', () => {
  const cfg = {schedule:{frequency:'daily',time:'09:00'}};
  assert.equal(scheduledOccurrence(cfg,new Date('2026-07-01T07:59:00Z')),null);
  assert.equal(scheduledOccurrence(cfg,new Date('2026-07-01T08:00:00Z')),'2026-07-01@09:00');
});
test('weekdays excludes weekends and weekly selects only its day', () => {
  const now = new Date('2026-11-07T10:00:00Z');
  assert.equal(scheduledOccurrence({schedule:{frequency:'weekdays',time:'09:00'}},now),null);
  assert.equal(scheduledOccurrence({schedule:{frequency:'weekly',weekday:6,time:'09:00'}},now),'2026-11-07@09:00');
});
test('monthly skips months without the selected day', () => {
  assert.equal(scheduledOccurrence({schedule:{frequency:'monthly',day:31,time:'09:00'}},new Date('2026-11-30T12:00:00Z')),null);
});
test('record offsets use calendar dates and retain original date in occurrence key', () => {
  assert.equal(recordDateOccurrence({date_field:'due_date',offset_days:-3,time:'09:00'},{due_date:'2026-11-07'},new Date('2026-11-04T10:00:00Z')),'2026-11-07:-3@09:00');
});
test('malformed schedules fail explicitly while empty record dates do not enroll', () => {
  assert.throws(()=>scheduledOccurrence({schedule:{frequency:'daily',time:'99:00'}},new Date()),ScheduleConfigError);
  assert.equal(recordDateOccurrence({date_field:'due_date'},{due_date:null},new Date()),null);
});
test('timestamp record dates are interpreted in Lisbon rather than UTC', () => {
  assert.equal(recordDateOccurrence({date_field:'due_date',time:'09:00'},{due_date:'2026-07-01T23:30:00Z'},new Date('2026-07-02T09:00:00Z')),'2026-07-02:0@09:00');
});
test('invalid calendar dates and future dates do not enroll', () => {
  assert.equal(recordDateOccurrence({date_field:'due_date'},{due_date:'2026-02-30'},new Date('2026-03-02T10:00:00Z')),null);
  assert.equal(recordDateOccurrence({date_field:'due_date'},{due_date:'2026-11-05'},new Date('2026-11-04T10:00:00Z')),null);
});
test('winter Lisbon uses UTC and occurrence remains stable across repeated ticks', () => {
  const cfg = {schedule:{frequency:'daily',time:'09:00'}};
  assert.equal(scheduledOccurrence(cfg,new Date('2026-11-04T08:59:00Z')),null);
  assert.equal(scheduledOccurrence(cfg,new Date('2026-11-04T09:00:00Z')),scheduledOccurrence(cfg,new Date('2026-11-04T12:00:00Z')));
});
