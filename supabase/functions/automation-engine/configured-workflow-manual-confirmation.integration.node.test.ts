import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const MIGRATION = new URL("../../migrations/20261009103000_otto_pending_actions.sql", import.meta.url);
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const FLOW = "44444444-4444-4444-8444-444444444444";
const DIGEST = "a".repeat(64);

async function database(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.role() returns text language sql stable as $$ select 'service_role'::text $$;
    create table public.organizations (id uuid primary key);
    create role anon;
    create role authenticated;
    create role service_role;
  `);
  await db.exec(await readFile(MIGRATION, "utf8"));
  await db.query("insert into auth.users(id) values ($1),($2)", [USER, OTHER_USER]);
  await db.query("insert into public.organizations(id) values ($1)", [ORG]);
  return db;
}

async function prepare(db: PGlite) {
  return db.query<{ readonly confirmation_id: string }>(`select confirmation_id from public.prepare_otto_pending_action(
    $1,$2,'automations','run_configured_manual',$3,$4::jsonb
  )`, [USER, ORG, DIGEST, JSON.stringify({ flow_id: FLOW, flow_version: 7 })]);
}

test("a manual workflow proof is bound to actor, organization and tool", async () => {
  const db = await database();
  const proof = await prepare(db);
  const id = proof.rows[0]?.confirmation_id;
  assert.ok(id);
  const wrongActor = await db.query(`select * from public.consume_otto_pending_action(
    $1,$2,$3,'automations','run_configured_manual'
  )`, [id, OTHER_USER, ORG]);
  const correct = await db.query<{ readonly payload: { readonly flow_id: string; readonly flow_version: number } }>(`select payload from public.consume_otto_pending_action(
    $1,$2,$3,'automations','run_configured_manual'
  )`, [id, USER, ORG]);
  assert.equal(wrongActor.rows.length, 0);
  assert.deepEqual(correct.rows[0]?.payload, { flow_id: FLOW, flow_version: 7 });
  await db.close();
});

test("a consumed manual workflow proof cannot be replayed", async () => {
  const db = await database();
  const proof = await prepare(db);
  const id = proof.rows[0]?.confirmation_id;
  assert.ok(id);
  const args = [id, USER, ORG];
  const first = await db.query(`select * from public.consume_otto_pending_action(
    $1,$2,$3,'automations','run_configured_manual'
  )`, args);
  const replay = await db.query(`select * from public.consume_otto_pending_action(
    $1,$2,$3,'automations','run_configured_manual'
  )`, args);
  assert.equal(first.rows.length, 1);
  assert.equal(replay.rows.length, 0);
  await db.close();
});
