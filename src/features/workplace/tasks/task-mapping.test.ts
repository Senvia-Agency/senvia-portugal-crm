import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSharedTasks, taskEditableFields } from './task-mapping';

const row = {
  id: '11111111-1111-4111-8111-111111111111', title: 'Contactar cliente', description: null,
  assigned_to: null, due_at: null, done_at: null, created_at: '2026-10-23T10:00:00Z',
  source_channel_id: null, contact_phone: null, contact_name: null,
  workplace_status: 'todo', priority: 'normal', workplace_version: 3,
};

test('legacy done_at takes precedence over a stale Workplace status', () => {
  const [task] = parseSharedTasks([{ ...row, done_at: '2026-10-23T11:00:00Z', workplace_status: 'doing' }]);
  assert.ok(task);
  assert.equal(task.status, 'done');
  assert.equal(task.version, 3);
});

test('Inbox provenance follows a source channel or contact phone; standalone tasks stay Workplace', () => {
  const tasks = parseSharedTasks([
    { ...row, source_channel_id: 'channel', contact_name: 'Cliente' },
    { ...row, id: '22222222-2222-4222-8222-222222222222', contact_phone: '+351900000000' },
    { ...row, id: '33333333-3333-4333-8333-333333333333', contact_name: 'Nome sem conversa' },
  ]);
  assert.deepEqual(tasks.map(task => task.source), ['inbox', 'inbox', 'workplace']);
  assert.equal(tasks[0]?.contactName, 'Cliente');
  assert.equal(tasks[1]?.phone, '+351900000000');
});

test('editable payload changes task fields without sending provenance or concurrency version', () => {
  const [task] = parseSharedTasks([{ ...row, source_channel_id: 'channel', contact_phone: '+351900000000', contact_name: 'Cliente' }]);
  assert.ok(task);
  const payload = taskEditableFields({ ...task, title: '  Texto atualizado  ', description: '', status: 'doing', priority: 'high' });
  assert.deepEqual(payload, {
    title: 'Texto atualizado', description: null, assigned_to: null, participant_ids: [], due_at: null,
    workplace_status: 'doing', priority: 'high',
  });
  for (const field of ['id', 'source', 'source_channel_id', 'contact_name', 'contact_phone', 'version', 'workplace_version', 'created_at', 'done_at']) {
    assert.equal(Object.prototype.hasOwnProperty.call(payload, field), false, `${field} is not editable`);
  }
});
