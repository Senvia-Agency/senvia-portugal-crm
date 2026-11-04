import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const MIGRATION = new URL("../../migrations/20261104153526_configured_workflow_scheduler.sql", import.meta.url);
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const FLOW_A = "33333333-3333-4333-8333-333333333333";
const FLOW_B = "44444444-4444-4444-8444-444444444444";

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
      status text not null, trigger_type text not null,
      trigger_config jsonb not null default '{}'::jsonb,
      version integer not null default 1, updated_at timestamptz not null default now()
    );
    create role anon;
    create role authenticated;
    create role service_role;
  `);
  await db.exec(await readFile(MIGRATION, "utf8"));
  return db;
}

function workflow(localTime: string, timeZone = "Europe/Lisbon"): string {
  return JSON.stringify({
    workflow: { trigger: { kind: "daily_schedule", localTime, timeZone } },
  });
}

async function setActivation(db: PGlite, flowId: string, activatedAt: string): Promise<void> {
  await db.exec("alter table public.automation_flows disable trigger trg_automation_flow_activated_at");
  await db.query("update public.automation_flows set activated_at = $1 where id = $2", [activatedAt, flowId]);
  await db.exec("alter table public.automation_flows enable trigger trg_automation_flow_activated_at");
}

test("claims one active occurrence per flow and local date", async () => {
  // Given
  const db = await database();
  await db.query("insert into public.organizations(id) values ($1), ($2)", [ORG_A, ORG_B]);
  await db.query(`insert into public.automation_flows
    (id, organization_id, status, trigger_type, trigger_config, activated_at, updated_at)
    values
    ($1, $2, 'active', 'configured_workflow', $3::jsonb, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z'),
    ($4, $5, 'active', 'configured_workflow', $3::jsonb, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')`,
  [FLOW_A, ORG_A, workflow("09:30"), FLOW_B, ORG_B]);

  // When
  const first = await db.query<{ readonly organization_id: string; readonly local_date: Date }>(
    "select organization_id, local_date from public.claim_due_automation_workflow_occurrences($1, 25, 300)",
    ["2030-11-04T10:00:00Z"],
  );
  const second = await db.query(
    "select * from public.claim_due_automation_workflow_occurrences($1, 25, 300)",
    ["2030-11-04T10:01:00Z"],
  );

  // Then
  assert.deepEqual(first.rows.map((row) => row.organization_id).sort(), [ORG_A, ORG_B]);
  assert.deepEqual(
    [...new Set(first.rows.map((row) => row.local_date.toISOString().slice(0, 10)))],
    ["2030-11-04"],
  );
  assert.equal(second.rows.length, 0);
  await db.close();
});

test("recovers an expired lease without creating another occurrence", async () => {
  // Given
  const db = await database();
  await db.query("insert into public.organizations(id) values ($1)", [ORG_A]);
  await db.query(`insert into public.automation_flows
    (id, organization_id, status, trigger_type, trigger_config, activated_at, updated_at)
    values ($1, $2, 'active', 'configured_workflow', $3::jsonb,
      '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')`,
  [FLOW_A, ORG_A, workflow("09:30")]);
  const first = await db.query<{ readonly occurrence_id: string; readonly claim_token: string }>(
    "select occurrence_id, claim_token from public.claim_due_automation_workflow_occurrences($1, 25, 30)",
    ["2030-11-04T10:00:00Z"],
  );

  // When
  const recovered = await db.query<{ readonly occurrence_id: string; readonly claim_token: string }>(
    "select occurrence_id, claim_token from public.claim_due_automation_workflow_occurrences($1, 25, 30)",
    ["2030-11-04T10:01:00Z"],
  );

  // Then
  assert.equal(recovered.rows[0]?.occurrence_id, first.rows[0]?.occurrence_id);
  assert.notEqual(recovered.rows[0]?.claim_token, first.rows[0]?.claim_token);
  const count = await db.query<{ readonly count: number }>(
    "select count(*)::integer as count from public.automation_workflow_occurrences",
  );
  assert.equal(count.rows[0]?.count, 1);
  await db.close();
});

test("only the current lease token can finish an occurrence", async () => {
  // Given
  const db = await database();
  await db.query("insert into public.organizations(id) values ($1)", [ORG_A]);
  await db.query(`insert into public.automation_flows
    (id, organization_id, status, trigger_type, trigger_config, updated_at)
    values ($1, $2, 'active', 'configured_workflow', $3::jsonb, '2026-11-01T00:00:00Z')`,
  [FLOW_A, ORG_A, workflow("09:30")]);
  const claim = await db.query<{ readonly occurrence_id: string; readonly claim_token: string }>(
    "select occurrence_id, claim_token from public.claim_due_automation_workflow_occurrences($1, 25, 300)",
    ["2030-11-04T10:00:00Z"],
  );
  const occurrence = claim.rows[0];
  assert.ok(occurrence);

  // When
  const wrong = await db.query<{ readonly finished: boolean }>(
    "select public.finish_automation_workflow_occurrence($1, $2, 'completed', null) as finished",
    [occurrence.occurrence_id, "55555555-5555-4555-8555-555555555555"],
  );
  const held = await db.query<{ readonly finished: boolean }>(
    "select public.finish_automation_workflow_occurrence($1, $2, 'completed', null) as finished",
    [occurrence.occurrence_id, occurrence.claim_token],
  );

  // Then
  assert.equal(wrong.rows[0]?.finished, false);
  assert.equal(held.rows[0]?.finished, true);
  await db.close();
});

test("does not schedule a draft", async () => {
  // Given
  const db = await database();
  await db.query("insert into public.organizations(id) values ($1), ($2)", [ORG_A, ORG_B]);
  await db.query(`insert into public.automation_flows
    (id, organization_id, status, trigger_type, trigger_config, activated_at, updated_at)
    values ($1, $2, 'draft', 'configured_workflow', $3::jsonb, null, '2026-11-01T00:00:00Z')`,
  [FLOW_B, ORG_B, workflow("09:30")]);

  // When
  const claims = await db.query(
    "select * from public.claim_due_automation_workflow_occurrences($1, 25, 300)",
    ["2030-11-04T10:00:00Z"],
  );

  // Then
  assert.equal(claims.rows.length, 0);
  await db.close();
});

test("catches up today's occurrence when activated after its local time", async () => {
  // Given
  const db = await database();
  await db.query("insert into public.organizations(id) values ($1)", [ORG_A]);
  await db.query(`insert into public.automation_flows
    (id, organization_id, status, trigger_type, trigger_config, updated_at)
    values ($1, $2, 'active', 'configured_workflow', $3::jsonb, '2030-11-04T10:00:00Z')`,
  [FLOW_A, ORG_A, workflow("09:30")]);
  await setActivation(db, FLOW_A, "2030-11-04T10:00:00Z");

  // When
  const claims = await db.query<{ readonly local_date: Date }>(
    "select local_date from public.claim_due_automation_workflow_occurrences($1, 25, 300)",
    ["2030-11-04T10:01:00Z"],
  );

  // Then
  assert.equal(claims.rows[0]?.local_date.toISOString().slice(0, 10), "2030-11-04");
  await db.close();
});

test("does not run yesterday when activated before today's local time", async () => {
  // Given
  const db = await database();
  await db.query("insert into public.organizations(id) values ($1)", [ORG_A]);
  await db.query(`insert into public.automation_flows
    (id, organization_id, status, trigger_type, trigger_config, updated_at)
    values ($1, $2, 'active', 'configured_workflow', $3::jsonb, '2030-11-04T08:00:00Z')`,
  [FLOW_A, ORG_A, workflow("09:30")]);
  await setActivation(db, FLOW_A, "2030-11-04T08:00:00Z");

  // When
  const claims = await db.query(
    "select * from public.claim_due_automation_workflow_occurrences($1, 25, 300)",
    ["2030-11-04T08:30:00Z"],
  );

  // Then
  assert.equal(claims.rows.length, 0);
  await db.close();
});

test("catches only the latest missed occurrence after two days", async () => {
  // Given
  const db = await database();
  await db.query("insert into public.organizations(id) values ($1)", [ORG_A]);
  await db.query(`insert into public.automation_flows
    (id, organization_id, status, trigger_type, trigger_config, updated_at)
    values ($1, $2, 'active', 'configured_workflow', $3::jsonb, '2030-11-02T08:00:00Z')`,
  [FLOW_A, ORG_A, workflow("09:30")]);
  await setActivation(db, FLOW_A, "2030-11-02T08:00:00Z");

  // When
  const claims = await db.query<{ readonly local_date: Date }>(
    "select local_date from public.claim_due_automation_workflow_occurrences($1, 25, 300)",
    ["2030-11-04T08:30:00Z"],
  );

  // Then
  assert.deepEqual(
    claims.rows.map((row) => row.local_date.toISOString().slice(0, 10)),
    ["2030-11-03"],
  );
  await db.close();
});

test("uses each workflow timezone to choose its latest local date", async () => {
  // Given
  const db = await database();
  await db.query("insert into public.organizations(id) values ($1), ($2)", [ORG_A, ORG_B]);
  await db.query(`insert into public.automation_flows
    (id, organization_id, status, trigger_type, trigger_config, updated_at)
    values
    ($1, $2, 'active', 'configured_workflow', $3::jsonb, '2030-11-01T00:00:00Z'),
    ($4, $5, 'active', 'configured_workflow', $6::jsonb, '2030-11-01T00:00:00Z')`,
  [FLOW_A, ORG_A, workflow("09:30"), FLOW_B, ORG_B, workflow("09:30", "America/New_York")]);
  await setActivation(db, FLOW_A, "2030-11-01T00:00:00Z");
  await setActivation(db, FLOW_B, "2030-11-01T00:00:00Z");

  // When
  const claims = await db.query<{ readonly organization_id: string; readonly local_date: Date }>(
    "select organization_id, local_date from public.claim_due_automation_workflow_occurrences($1, 25, 300)",
    ["2030-11-04T10:00:00Z"],
  );

  // Then
  const dates = Object.fromEntries(claims.rows.map((row) => [
    row.organization_id,
    row.local_date.toISOString().slice(0, 10),
  ]));
  assert.deepEqual(dates, { [ORG_A]: "2030-11-04", [ORG_B]: "2030-11-03" });
  await db.close();
});

test("chooses the first instant when a Lisbon wall-clock time repeats", async () => {
  // Given
  const db = await database();

  // When
  const result = await db.query<{ readonly scheduled_at: Date }>(`select
    public.automation_workflow_scheduled_at(
      '2026-10-25'::date, '01:30'::time, 'Europe/Lisbon'
    ) as scheduled_at`);

  // Then
  assert.equal(result.rows[0]?.scheduled_at.toISOString(), "2026-10-25T00:30:00.000Z");
  await db.close();
});
