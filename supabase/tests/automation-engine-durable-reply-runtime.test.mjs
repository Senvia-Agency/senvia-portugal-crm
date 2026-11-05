import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, database, fixture } from './automation-engine-runtime-harness.mjs';
function parked() {
  const { run, flow } = fixture([
    { id: 'question', type: 'wait_reply', config: { rules: [{ id: 'yes', label: 'Sim' }] } },
    { id: 'accepted', type: 'end', config: {} }, { id: 'timeout', type: 'end', config: {} },
  ], [{ source: 'question', target: 'accepted', branch: 'yes' }, { source: 'question', target: 'timeout', branch: 'timeout' }]);
  Object.assign(run, { status: 'awaiting_reply', current_node_id: 'question', contact_phone: '351912345678', contact_phone_key: '912345678',
    started_at: '2026-11-04T09:00:00Z', wake_at: '2026-11-04T10:00:00.000Z',
    context: { __reply_after_question: '2026-11-04T09:30:00Z',
      __cursors: [{ node: 'question', status: 'awaiting_reply', wake_at: '2026-11-04T11:00:00Z' }],
      ultima_resposta: 'Sim', ultima_resposta_received_at: '2026-11-04T09:59:00Z' } });
  const db = database(run, flow, { phone: run.contact_phone, name: run.contact_name });
  db.rpc = async (name, args) => { if (name !== "record_automation_inbound_reply") return { data: [], error: null }; run.context = { ...run.context, ultima_resposta: args.p_text, ultima_resposta_received_at: args.p_received_at }; return { error: null, data: 1 }; };
  return { run, flow, db };
}
test('tick consumes durable reply after offline webhook exactly once before future timeout', async () => {
  const { handleTick } = runtime();
  const { run, db } = parked();
  const result = await handleTick(db);
  assert.equal(result.woken, 1);
  assert.equal(run.status, 'completed');
  assert.deepEqual(db.steps.map(step => step.node_id), ['question', 'accepted']);
  assert.equal(db.steps[0].detail.ramo, 'yes');
  assert.equal(run.context.__reply_consumed_at, '2026-11-04T09:59:00Z');
  await handleTick(db);
  assert.equal(db.steps.length, 2);
});
test('normal reply and offline persisted reply take identical branch', async () => {
  const { handleReply } = runtime();
  const { run, db } = parked();
  const result = await handleReply(db, { organization_id: 'org', phone: '351912345678', text: 'Sim', message_at: '2026-11-04T09:59:00Z' });
  assert.equal(result.resumed, 1);
  assert.equal(run.status, 'completed');
  assert.equal(db.steps[0].detail.ramo, 'yes');
});
test('old reply does not release a later loop visit while original timeout stays parked', async () => {
  const { handleTick } = runtime();
  const { run, db } = parked();
  run.context.__reply_after_question = '2026-11-04T09:59:30Z';
  await handleTick(db);
  assert.equal(run.status, 'awaiting_reply');
  assert.equal(run.context.__cursors[0].wake_at, '2026-11-04T11:00:00Z');
  assert.equal(db.steps.length, 0);
});
test('wait boundary is persisted before actual outbound delivery and overwritten for a new visit', async () => {
  const { Engine, clock } = runtime();
  const { run, flow, db } = parked();
  run.status = 'running'; run.context = { __reply_after_question: '2026-11-04T09:30:00Z' };
  flow.graph.nodes[0].config.question = 'Confirma?';
  const engine = new Engine(db);
  engine.whatsappChannel = async () => ({ id: 'channel' });
  engine.throttle = async () => ({ claimToken: "fake-reservation" });
  engine.sendWhatsapp = async () => { assert.equal(run.context.__reply_after_question, new Date(clock.time).toISOString()); return { messageId: 'fake' }; };
  await engine.advance(run, flow, 'question');
  assert.equal(run.status, 'awaiting_reply', JSON.stringify({ error: run.last_error, steps: db.steps }));
  assert.equal(run.context.__reply_after_question, '2026-11-04T10:00:00.000Z');
});

test('changed lead phone routes new wait to current phone while enrollment identity stays immutable', async () => {
  const { Engine, handleReply, clock } = runtime();
  const { run, flow } = fixture([
    { id: 'question', type: 'wait_reply', config: { rules: [{ id: 'yes', label: 'Sim' }] } },
    { id: 'accepted', type: 'end', config: {} },
  ], [{ source: 'question', target: 'accepted', branch: 'yes' }]);
  Object.assign(run, { contact_phone: '351912345678', contact_phone_key: '912345678', started_at: '2026-11-04T09:00:00Z' });
  const db = database(run, flow, { phone: '351999999999', name: 'Ana' });
  db.rpc = async (name, args) => {
    const key = args.p_phone.replace(/\D/g, '').slice(-9);
    if ((run.context.__action_reply_phone_key ?? run.contact_phone_key) !== key) return { data: 0, error: null };
    run.context = { ...run.context, ultima_resposta: args.p_text, ultima_resposta_received_at: args.p_received_at };
    return { data: 1, error: null };
  };
  await new Engine(db).advance(run, flow, 'question');
  assert.equal(run.status, 'awaiting_reply');
  assert.equal(run.context.__action_reply_phone_key, '999999999');
  assert.equal(run.contact_phone_key, '912345678');
  clock.time += 1000;
  const old = await handleReply(db, { organization_id: 'org', phone: '351912345678', text: 'Sim', message_at: new Date(clock.time).toISOString() });
  assert.equal(old.resumed, 0);
  assert.equal(run.status, 'awaiting_reply');
  const current = await handleReply(db, { organization_id: 'org', phone: '351999999999', text: 'Sim', message_at: new Date(clock.time).toISOString() });
  assert.equal(current.resumed, 1);
  assert.equal(run.status, 'completed');
});

test('accepted outbound replay preserves original reply boundary and never sends again', async () => {
  const { Engine } = runtime();
  const { run, flow, db } = parked();
  run.status = 'running';
  run.context = { __reply_after_question: '2026-11-04T09:30:00Z', __action_reply_phone_key: '912345678' };
  flow.graph.nodes[0].config.question = 'Confirma?';
  const engine = new Engine(db);
  engine.whatsappChannel = async () => ({ id: 'channel' });
  engine.throttle = async () => ({ replayMessageId: 'already-sent' });
  engine.sendWhatsapp = async () => { assert.fail('accepted message must not be sent again'); };
  await engine.advance(run, flow, 'question');
  assert.equal(run.status, 'awaiting_reply');
  assert.equal(run.context.__reply_after_question, '2026-11-04T09:30:00Z');
});

test('delayed callback of a durably consumed inbox message cannot release the next question', async () => {
  const { handleReply, clock } = runtime();
  const { run, db } = parked();
  run.context.__reply_consumed_at = run.context.ultima_resposta_received_at;
  run.context.__reply_after_question = '2026-11-04T09:59:30Z';
  clock.time += 1000;
  db.rpc = async () => { assert.fail('persisted inbox callback must not re-stamp its ingestion fact'); };
  const result = await handleReply(db, { organization_id: 'org', phone: '351912345678', text: 'Sim', conversation_id: 'conversation', message_at: '2026-11-04T09:59:00Z' });
  assert.equal(result.resumed, 0);
  assert.equal(run.status, 'awaiting_reply');
  assert.equal(run.context.ultima_resposta_received_at, '2026-11-04T09:59:00Z');
  assert.equal(db.steps.length, 0);
});
