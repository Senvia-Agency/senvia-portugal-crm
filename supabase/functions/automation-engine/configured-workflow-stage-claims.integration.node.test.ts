import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const MIGRATION = new URL("../../migrations/20261104201000_configured_workflow_stage_claims.sql", import.meta.url);
const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const FLOW = "33333333-3333-4333-8333-333333333333";
const RECORD = "sale_payment:44444444-4444-4444-8444-444444444444";

async function database(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create type public.app_role as enum ('admin', 'super_admin');
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create function public.is_org_member(uuid, uuid) returns boolean language sql stable as $$ select false $$;
    create function public.has_role(uuid, public.app_role) returns boolean language sql stable as $$ select false $$;
    create table public.organizations (id uuid primary key);
    create table public.automation_flows (
      id uuid primary key, organization_id uuid not null references public.organizations(id),
      status text not null, trigger_type text not null, trigger_config jsonb not null,
      version integer not null
    );
    create table public.automation_runs (id uuid primary key);
    create role anon;
    create role authenticated;
    create role service_role;
  `);
  await db.exec(await readFile(MIGRATION, "utf8"));
  await db.query("insert into public.organizations(id) values ($1), ($2)", [ORG, OTHER_ORG]);
  await db.query(`insert into public.automation_flows
    (id, organization_id, status, trigger_type, trigger_config, version)
    values ($1, $2, 'active', 'configured_workflow', $3::jsonb, 4)`,
  [FLOW, ORG, JSON.stringify({ workflow: { stages: [{ id: "reminder", nodeId: "email" }] } })]);
  return db;
}

async function claim(db: PGlite, overrides: Readonly<Record<string, unknown>> = {}) {
  const values = {
    organizationId: ORG, flowId: FLOW, flowVersion: 4, entity: "receivables",
    recordId: RECORD, stageId: "reminder", cadenceMode: "once", cadenceDays: null,
    occurrenceKey: "2026-11-04", localDate: "2026-11-04", leaseSeconds: 300,
    ...overrides,
  };
  return db.query<{ readonly execution_id: string; readonly claim_token: string }>(`select * from
    public.claim_automation_workflow_stage_execution(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
    )`, [values.organizationId, values.flowId, values.flowVersion, values.entity,
    values.recordId, values.stageId, values.cadenceMode, values.cadenceDays,
    values.occurrenceKey, values.localDate, values.leaseSeconds]);
}

test("a once cadence is claimed exactly once for a typed receivable id", async () => {
  const db = await database();
  const first = await claim(db);
  const second = await claim(db, { occurrenceKey: "2026-11-05", localDate: "2026-11-05" });
  assert.equal(first.rows.length, 1);
  assert.equal(second.rows.length, 0);
  await db.close();
});

test("pause, edit and reactivation do not reset once cadence for a stable stage id", async () => {
  const db = await database();
  const first = await claim(db);
  assert.equal(first.rows.length, 1);
  await db.query(`update public.automation_flows
    set version=5, trigger_config=$2::jsonb where id=$1`, [FLOW, JSON.stringify({
    workflow: { stages: [
      { id: "reminder", nodeId: "email-v2" },
      { id: "follow-up", nodeId: "task" },
    ] },
  })]);

  const stableStage = await claim(db, {
    flowVersion: 5, occurrenceKey: "2026-11-05", localDate: "2026-11-05",
  });
  const newStage = await claim(db, {
    flowVersion: 5, stageId: "follow-up", occurrenceKey: "2026-11-05", localDate: "2026-11-05",
  });

  assert.equal(stableStage.rows.length, 0);
  assert.equal(newStage.rows.length, 1);
  await db.close();
});

test("an unknown outcome blocks automatic interval retries", async () => {
  const db = await database();
  const first = await claim(db, { cadenceMode: "interval_days", cadenceDays: 7 });
  const token = first.rows[0];
  assert.ok(token);
  await db.query("select public.finish_automation_workflow_stage_execution($1,$2,'unknown',null,'fixture')",
    [token.execution_id, token.claim_token]);
  const later = await claim(db, {
    cadenceMode: "interval_days", cadenceDays: 7,
    occurrenceKey: "2026-11-20", localDate: "2026-11-20",
  });
  assert.equal(later.rows.length, 0);
  await db.close();
});

test("a successful interval becomes eligible only after its configured days", async () => {
  const db = await database();
  const first = await claim(db, { cadenceMode: "interval_days", cadenceDays: 7 });
  const token = first.rows[0];
  assert.ok(token);
  await db.query("select public.finish_automation_workflow_stage_execution($1,$2,'succeeded',null,null)",
    [token.execution_id, token.claim_token]);
  const early = await claim(db, {
    cadenceMode: "interval_days", cadenceDays: 7,
    occurrenceKey: "2026-11-10", localDate: "2026-11-10",
  });
  const due = await claim(db, {
    cadenceMode: "interval_days", cadenceDays: 7,
    occurrenceKey: "2026-11-11", localDate: "2026-11-11",
  });
  assert.equal(early.rows.length, 0);
  assert.equal(due.rows.length, 1);
  await db.close();
});

test("a new per-run occurrence cannot overlap an unresolved prior effect", async () => {
  const db = await database();
  const first = await claim(db, { cadenceMode: "per_run" });
  const overlapping = await claim(db, {
    cadenceMode: "per_run", occurrenceKey: "2026-11-05", localDate: "2026-11-05",
  });
  assert.equal(first.rows.length, 1);
  assert.equal(overlapping.rows.length, 0);
  await db.close();
});

test("tenant and active flow identity are checked inside the claim RPC", async () => {
  const db = await database();
  const wrongTenant = await claim(db, { organizationId: OTHER_ORG });
  await db.query("update public.automation_flows set status='paused' where id=$1", [FLOW]);
  const paused = await claim(db);
  assert.equal(wrongTenant.rows.length, 0);
  assert.equal(paused.rows.length, 0);
  await db.close();
});
