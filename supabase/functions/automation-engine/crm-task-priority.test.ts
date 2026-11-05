import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { executeCrmAction } from './crm-actions.ts';

const run = { id: 'run', flow_id: 'flow', organization_id: 'org', subject_type: 'lead', subject_id: 'lead',
  contact_name: 'Ana', contact_email: null, contact_phone: null, context: {} };

function fixture() {
  const writes: Record<string, unknown>[] = [];
  const db = createClient('https://db.example.test', 'test-service-key', {
    auth: { persistSession: false },
    global: { fetch: async (_request, init) => {
      writes.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 201 });
    } },
  });
  return { db, writes };
}

test('task creation writes each supported priority into the organization task payload', async () => {
  for (const priority of ['low', 'normal', 'high']) {
    const { db, writes } = fixture();
    const result = await executeCrmAction(db, { type: 'create_task', config: { title: 'Ligar', priority }, run, vars: {} });
    assert.equal(result?.kind, 'next');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].priority, priority);
    assert.equal(writes[0].organization_id, 'org');
  }
});

test('existing task configurations default to normal priority', async () => {
  const { db, writes } = fixture();
  const result = await executeCrmAction(db, { type: 'create_task', config: { title: 'Ligar' }, run, vars: {} });
  assert.equal(result?.kind, 'next');
  assert.equal(writes[0].priority, 'normal');
});

test('unknown priorities fail before writing a task', async () => {
  for (const priority of ['urgent', '', null, 1]) {
    const { db, writes } = fixture();
    const result = await executeCrmAction(db, { type: 'create_task', config: { title: 'Ligar', priority }, run, vars: {} });
    assert.equal(result?.kind, 'fail');
    assert.equal(writes.length, 0);
  }
});
