import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../migrations/20261008150000_native_inbox_task_analysis.sql', import.meta.url), 'utf8');
const channelPolicy = await readFile(new URL('../migrations/20261002190000_super_admin_channel_access.sql', import.meta.url), 'utf8');
const org = '11111111-1111-4111-8111-111111111111';
const channel = '22222222-2222-4222-8222-222222222222';
const conversation = '33333333-3333-4333-8333-333333333333';
const allowedUser = '55555555-5555-4555-8555-555555555555';
const excludedUser = '66666666-6666-4666-8666-666666666666';
const messageId = index => `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE organizations (id uuid PRIMARY KEY);
    CREATE TABLE messaging_channels (id uuid PRIMARY KEY, organization_id uuid, channel_type text, status text, archived_at timestamptz, metadata jsonb, assigned_user_ids uuid[]);
    CREATE TABLE meta_conversations (id uuid PRIMARY KEY, organization_id uuid, channel_id uuid, contact_ref text, contact_name text);
    CREATE TABLE meta_messages (id uuid PRIMARY KEY, organization_id uuid, conversation_id uuid, content text, is_deleted boolean DEFAULT false);
    CREATE TABLE inbox_tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, created_by uuid, suggested boolean, source_message text,
      conversation_id integer, contact_phone text, contact_name text, title text, due_at timestamptz, done_at timestamptz,
      phone_key text GENERATED ALWAYS AS (right(contact_phone, 9)) STORED);
    INSERT INTO organizations VALUES ('${org}');
    INSERT INTO messaging_channels VALUES ('${channel}', '${org}', 'whatsapp', 'connected', NULL, '{}', ARRAY['${allowedUser}']::uuid[]);
    INSERT INTO meta_conversations VALUES ('${conversation}', '${org}', '${channel}', '351912345678', 'Cliente');
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    CREATE TYPE app_role AS ENUM ('super_admin');
    CREATE TABLE organization_members (organization_id uuid, user_id uuid);
    INSERT INTO organization_members VALUES ('${org}', '${allowedUser}'), ('${org}', '${excludedUser}');
    CREATE FUNCTION meets_mfa_policy(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE FUNCTION has_role(uuid, app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE FUNCTION is_org_admin(uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE FUNCTION is_org_member(p_user uuid, p_org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS (SELECT 1 FROM organization_members WHERE user_id=p_user AND organization_id=p_org) $$;
    ALTER TABLE inbox_tasks ENABLE ROW LEVEL SECURITY;
    CREATE POLICY org_members ON inbox_tasks FOR ALL TO authenticated USING (is_org_member(auth.uid(),organization_id)) WITH CHECK (is_org_member(auth.uid(),organization_id));
    GRANT USAGE ON SCHEMA auth TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON inbox_tasks TO authenticated;
  `);
  await db.exec(channelPolicy);
  await db.exec(migration);
  for (let index = 1; index <= 7; index++) {
    await db.query('INSERT INTO meta_messages(id,organization_id,conversation_id,content) VALUES ($1,$2,$3,$4)', [messageId(index), org, conversation, `Pedido concreto ${index}`]);
  }
  return db;
}
async function claim(db, index, organization = org) {
  const result = await db.query('SELECT claim_inbox_task_analysis($1,$2) AS token', [messageId(index), organization]);
  return result.rows[0].token;
}
async function finish(db, index, token, title = `Tarefa ${index}`) {
  const result = await db.query('SELECT finish_inbox_task_analysis($1,$2,$3,NULL) AS created', [messageId(index), token, title]);
  return result.rows[0].created;
}

test('claims once, persists no-task decisions and preserves dismissal idempotence', async () => {
  const db = await fixture();
  try {
    const token = await claim(db, 1);
    assert.equal(await claim(db, 1), null);
    assert.equal(await finish(db, 1, token, null), false);
    assert.equal(await claim(db, 1), null);
    const taskToken = await claim(db, 2);
    assert.equal(await finish(db, 2, taskToken), true);
    await db.exec('DELETE FROM inbox_tasks');
    assert.equal(await claim(db, 2), null);
    const ledger = await db.query('SELECT task_id,status FROM inbox_task_analysis WHERE message_id=$1', [messageId(2)]);
    assert.deepEqual(ledger.rows, [{ task_id: null, status: 'done' }]);
  } finally { await db.close(); }
});

test('message-derived tasks preserve channel restrictions for two members of the same organization', async () => {
  const db = await fixture();
  try {
    assert.equal(await finish(db, 1, await claim(db, 1)), true);
    const task = await db.query('SELECT id,source_channel_id FROM inbox_tasks');
    assert.equal(task.rows[0].source_channel_id, channel);
    const taskId = task.rows[0].id;
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${excludedUser}',false)`);
    assert.equal((await db.query('SELECT * FROM inbox_tasks')).rows.length, 0);
    assert.equal((await db.query('UPDATE inbox_tasks SET title=$1 WHERE id=$2 RETURNING id', ['Leaked',taskId])).rows.length, 0);
    assert.equal((await db.query('DELETE FROM inbox_tasks WHERE id=$1 RETURNING id', [taskId])).rows.length, 0);
    await assert.rejects(db.query('INSERT INTO inbox_tasks (organization_id,title,source_channel_id) VALUES ($1,$2,$3)', [org,'Spoofed',channel]), /row-level security/);
    await db.exec(`SELECT set_config('request.jwt.claim.sub','${allowedUser}',false)`);
    assert.equal((await db.query('SELECT * FROM inbox_tasks')).rows.length, 1);
    await assert.rejects(db.query('UPDATE inbox_tasks SET source_channel_id=NULL WHERE id=$1', [taskId]), /Task source scope is immutable/);
    await assert.rejects(db.query('UPDATE inbox_tasks SET source_channel_id=$1 WHERE id=$2', ['99999999-9999-4999-8999-999999999999',taskId]), /Task source scope is immutable/);
    assert.equal((await db.query('UPDATE inbox_tasks SET suggested=false WHERE id=$1 RETURNING id', [taskId])).rows.length, 1);
    assert.equal((await db.query('DELETE FROM inbox_tasks WHERE id=$1 RETURNING id', [taskId])).rows.length, 1);
  } finally { await db.close(); }
});

test('concurrent finalizers cap at three and allow the same title after completion', async () => {
  const db = await fixture();
  try {
    const tokens = await Promise.all([1, 2, 3, 4].map(index => claim(db, index)));
    const results = await Promise.all(tokens.map((token, index) => finish(db, index + 1, token)));
    assert.equal(results.filter(Boolean).length, 3);
    const tasks = await db.query('SELECT suggested,conversation_id,created_by FROM inbox_tasks');
    assert.equal(tasks.rows.length, 3);
    assert.ok(tasks.rows.every(task => task.suggested && task.conversation_id === null && task.created_by === null));
    await db.exec('UPDATE inbox_tasks SET suggested=false');
    assert.equal(await finish(db, 5, await claim(db, 5), '  TAREFA   1 '), false);
    await db.query('UPDATE meta_messages SET content=$1 WHERE id=$2', ['Pedido concreto 2', messageId(6)]);
    assert.equal(await finish(db, 6, await claim(db, 6), 'Outro título'), false);
    await db.exec('UPDATE inbox_tasks SET done_at=now()');
    assert.equal(await finish(db, 7, await claim(db, 7), 'Tarefa 1'), true);
  } finally { await db.close(); }
});

test('expired leases retry with fencing and failed releases permit a fresh claim', async () => {
  const db = await fixture();
  try {
    const stale = await claim(db, 1);
    await db.query("UPDATE inbox_task_analysis SET lease_expires_at=now()-interval '1 second' WHERE message_id=$1", [messageId(1)]);
    const fresh = await claim(db, 1);
    assert.notEqual(fresh, stale);
    assert.equal(await finish(db, 1, stale), false);
    assert.equal(await finish(db, 1, fresh), true);
    await claim(db, 2);
    await db.query("DELETE FROM inbox_task_analysis WHERE message_id=$1 AND status='processing'", [messageId(2)]);
    assert.ok(await claim(db, 2));
  } finally { await db.close(); }
});

test('blocks mismatched tenants, deleted messages, disabled channels and authenticated RPCs', async () => {
  const db = await fixture();
  try {
    await assert.rejects(claim(db, 1, '99999999-9999-4999-8999-999999999999'), /Message unavailable/);
    await db.query('UPDATE meta_messages SET is_deleted=true WHERE id=$1', [messageId(1)]);
    await assert.rejects(claim(db, 1), /Message unavailable/);
    const token = await claim(db, 2);
    await db.exec(`UPDATE messaging_channels SET metadata='{"ai_tasks_enabled":false}'`);
    assert.equal(await finish(db, 2, token), false);
    await db.exec('SET ROLE authenticated');
    await assert.rejects(claim(db, 3), /permission denied/);
    await assert.rejects(db.query('SELECT * FROM inbox_task_analysis'), /permission denied/);
  } finally { await db.close(); }
});
