import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, database, fixture } from './automation-engine-runtime-harness.mjs';

function subjectDatabase(run, flow, subject) {
  const db = database(run, flow, subject);
  const from = db.from;
  db.from = table => {
    const query = from(table);
    if (table === 'leads') {
      const update = query.update;
      query.update = patch => {
        Object.assign(subject, patch);
        return update(patch);
      };
    }
    return query;
  };
  return db;
}

test('move_stage reaches current-record goal and prevents downstream email', async () => {
  const { Engine } = runtime();
  const { run, flow } = fixture([
    { id: 'win', type: 'move_stage', config: { stage: 'won' } },
    { id: 'email', type: 'send_email', config: { subject: 'Não enviar', html: 'Mensagem' } },
  ], [{ source: 'win', target: 'email' }]);
  flow.trigger_config.goal = { field: 'status', operator: 'equals', value: 'won' };
  run.context = { status: 'open', __retry_other: { attempts: 1 }, resposta: 'sim' };
  const subject = { status: 'open' };
  const db = subjectDatabase(run, flow, subject);
  let emails = 0;
  db.functions = { invoke: async () => { emails++; return { data: { results: [{ status: 'sent' }] } }; } };
  await new Engine(db).advance(run, flow, 'win');
  assert.equal(subject.status, 'won');
  assert.equal(emails, 0);
  assert.equal(run.status, 'completed');
  assert.ok(run.context.__goal_reached_at);
  assert.equal(run.context.resposta, 'sim');
  assert.equal(run.context.__retry_other.attempts, 1);
});

test('terminal move_stage records conversion even without another step', async () => {
  const { Engine } = runtime();
  const { run, flow } = fixture([{ id: 'win', type: 'move_stage', config: { stage: 'won' } }]);
  flow.trigger_config.goal = { field: 'status', operator: 'equals', value: 'won' };
  const subject = { status: 'open' };
  const db = subjectDatabase(run, flow, subject);
  await new Engine(db).advance(run, flow, 'win');
  assert.equal(subject.status, 'won');
  assert.equal(run.status, 'completed');
  assert.ok(run.context.__goal_reached_at);
  assert.equal(run.context.status, 'won');
});
