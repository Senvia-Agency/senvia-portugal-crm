import assert from "node:assert/strict";
import test from "node:test";

import {
  activate,
  ADMIN_A,
  ADMIN_B,
  asRole,
  database,
  DIGEST_A,
  FLOW_A,
  FLOW_B,
  LEGACY_FLOW,
  MEMBER_A,
  ORG_A,
  recordPreview,
} from "./configured-workflow-activation-security.fixture.ts";

test("an exact reviewed preview activates once and is consumed atomically", async () => {
  const db = await database();
  const proof = await recordPreview(db);
  await assert.rejects(
    () => activate(db, proof, { digest: "b".repeat(64) }),
    /invalid, expired, or consumed/,
  );
  const activation = await activate(db, proof);
  assert.deepEqual(activation.rows, [{
    id: FLOW_A,
    status: "active",
    version: 4,
    activated_by: ADMIN_A,
  }]);

  const consumed = await db.query<{ readonly consumed: boolean }>(
    `select consumed_at is not null as consumed
     from public.automation_workflow_activation_previews where id = $1`,
    [proof.preview_id],
  );
  assert.equal(consumed.rows[0]?.consumed, true);
  await assert.rejects(() => activate(db, proof), /invalid, expired, or consumed/);
  await db.close();
});

test("direct activation and active configured inserts are rejected", async () => {
  const db = await database();
  await assert.rejects(
    () => db.query(`update public.automation_flows set status='active' where id=$1`, [FLOW_A]),
    /proof is missing or stale/,
  );
  await assert.rejects(
    () => db.query(
      `insert into public.automation_flows
        (id, organization_id, name, status, trigger_type, created_by)
       values ('66666666-6666-4666-8666-666666666666', $1, 'Bypass',
         'active', 'configured_workflow', $2)`,
      [ORG_A, ADMIN_A],
    ),
    /must be activated from a reviewed preview/,
  );
  await assert.rejects(
    () => db.query(
      `update public.automation_flows set activated_by=$1 where id=$2`,
      [MEMBER_A, FLOW_A],
    ),
    /activation actor is server-managed/,
  );
  await assert.rejects(
    () => db.query(
      `insert into public.automation_flows
        (id, organization_id, name, status, trigger_type, created_by, activated_by)
       values ('88888888-8888-4888-8888-888888888888', $1, 'Spoofed actor',
         'draft', 'configured_workflow', $2, $3)`,
      [ORG_A, MEMBER_A, ADMIN_A],
    ),
    /activation actor is server-managed/,
  );
  await db.close();
});

test("a member may create a draft but only the reviewing admin becomes activation actor", async () => {
  const db = await database();
  await db.query(
    `update public.automation_flows set created_by=$1 where id=$2`,
    [MEMBER_A, FLOW_A],
  );
  const proof = await recordPreview(db, { actor: ADMIN_A });
  const activation = await activate(db, proof, { actor: ADMIN_A });
  assert.equal(activation.rows[0]?.activated_by, ADMIN_A);

  await db.query(
    `update public.organization_members set is_active=false
     where organization_id=$1 and user_id=$2`,
    [ORG_A, ADMIN_A],
  );
  await db.query(
    `update public.automation_flows set status='paused' where id=$1`,
    [FLOW_A],
  );
  const paused = await db.query<{
    readonly status: string;
    readonly created_by: string;
    readonly activated_by: string;
  }>(
    `select status, created_by, activated_by
     from public.automation_flows where id=$1`,
    [FLOW_A],
  );
  assert.deepEqual(paused.rows, [{
    status: "paused",
    created_by: MEMBER_A,
    activated_by: ADMIN_A,
  }]);
  await assert.rejects(
    () => recordPreview(db, { actor: ADMIN_A }),
    /preview actor is not an active organization administrator/,
  );
  await db.close();
});

test("expired and changed previews fail closed without being consumed", async () => {
  const expiredDb = await database();
  const expired = await recordPreview(expiredDb);
  await expiredDb.query(
    `update public.automation_workflow_activation_previews
     set created_at = clock_timestamp() - interval '10 minutes',
         expires_at = clock_timestamp() - interval '1 minute'
     where id = $1`,
    [expired.preview_id],
  );
  await assert.rejects(() => activate(expiredDb, expired), /invalid, expired, or consumed/);
  await expiredDb.close();

  const changedDb = await database();
  const changed = await recordPreview(changedDb);
  await changedDb.query(
    `update public.automation_flows
     set graph = '{"nodes":[{"id":"changed","type":"send_email"}],"edges":[]}'::jsonb
     where id = $1`,
    [FLOW_A],
  );
  await assert.rejects(() => activate(changedDb, changed), /changed after preview/);
  const state = await changedDb.query<{ readonly consumed: boolean }>(
    `select consumed_at is not null as consumed
     from public.automation_workflow_activation_previews where id = $1`,
    [changed.preview_id],
  );
  assert.equal(state.rows[0]?.consumed, false);
  await changedDb.close();
});

test("activation requires current AAL2 and current active admin membership", async () => {
  const mfaDb = await database();
  const mfaProof = await recordPreview(mfaDb);
  await assert.rejects(
    () => activate(mfaDb, mfaProof, { aal: "aal1" }),
    /MFA-authenticated user required/,
  );
  const afterMfa = await mfaDb.query<{ readonly consumed: boolean }>(
    `select consumed_at is not null as consumed
     from public.automation_workflow_activation_previews where id = $1`,
    [mfaProof.preview_id],
  );
  assert.equal(afterMfa.rows[0]?.consumed, false);
  await mfaDb.close();

  const membershipDb = await database();
  const membershipProof = await recordPreview(membershipDb);
  await membershipDb.query(
    `update public.organization_members set role='member', profile_id=null
     where organization_id=$1 and user_id=$2`,
    [ORG_A, ADMIN_A],
  );
  await assert.rejects(
    () => activate(membershipDb, membershipProof),
    /active organization administrator required/,
  );
  await assert.rejects(
    () => recordPreview(membershipDb, { actor: MEMBER_A }),
    /preview actor is not an active organization administrator/,
  );
  await membershipDb.close();
});

test("proofs and preview actors cannot cross organization boundaries", async () => {
  const db = await database();
  await assert.rejects(
    () => recordPreview(db, { flowId: FLOW_B, actor: ADMIN_A }),
    /preview actor is not an active organization administrator/,
  );
  const proof = await recordPreview(db);
  await assert.rejects(
    () => activate(db, proof, { actor: ADMIN_B }),
    /invalid, expired, or consumed/,
  );
  const flow = await db.query<{ readonly status: string }>(
    `select status from public.automation_flows where id=$1`,
    [FLOW_A],
  );
  assert.equal(flow.rows[0]?.status, "draft");
  await db.close();
});

test("a later statement failure rolls back proof consumption", async () => {
  const db = await database();
  const proof = await recordPreview(db);
  await db.exec(`
    create function public.fixture_fail_after_activation()
    returns trigger language plpgsql as $$
    begin
      if new.status = 'active' then raise exception 'fixture downstream failure'; end if;
      return new;
    end
    $$;
    create trigger zzz_fixture_fail_after_activation
      before update on public.automation_flows
      for each row execute function public.fixture_fail_after_activation();
  `);
  await assert.rejects(() => activate(db, proof), /fixture downstream failure/);
  const rolledBack = await db.query<{
    readonly status: string;
    readonly consumed: boolean;
  }>(
    `select f.status, p.consumed_at is not null as consumed
     from public.automation_flows f
     join public.automation_workflow_activation_previews p on p.flow_id=f.id
     where p.id=$1`,
    [proof.preview_id],
  );
  assert.deepEqual(rolledBack.rows, [{ status: "draft", consumed: false }]);

  await db.exec("drop trigger zzz_fixture_fail_after_activation on public.automation_flows");
  const retry = await activate(db, proof);
  assert.equal(retry.rows[0]?.status, "active");
  await db.close();
});

test("legacy automations keep their existing direct activation semantics", async () => {
  const db = await database();
  await db.query(
    `update public.automation_flows
     set status='active', graph='{"nodes":[{"id":"legacy"}],"edges":[]}'::jsonb
     where id=$1`,
    [LEGACY_FLOW],
  );
  const updated = await db.query<{ readonly status: string }>(
    `select status from public.automation_flows where id=$1`,
    [LEGACY_FLOW],
  );
  assert.equal(updated.rows[0]?.status, "active");

  await db.query(
    `insert into public.automation_flows
      (id, organization_id, name, status, trigger_type, created_by)
     values ('77777777-7777-4777-8777-777777777777', $1, 'Legacy active',
       'active', 'lead_created', $2)`,
    [ORG_A, ADMIN_A],
  );
  await db.close();
});

test("active configured behavior cannot change without pause and a new preview", async () => {
  const db = await database();
  const proof = await recordPreview(db);
  await activate(db, proof);
  await assert.rejects(
    () => db.query(
      `update public.automation_flows
       set graph='{"nodes":[{"id":"mutated"}],"edges":[]}'::jsonb where id=$1`,
      [FLOW_A],
    ),
    /pause and review/,
  );
  await assert.rejects(
    () => db.query(
      `update public.automation_flows set activated_by=$1 where id=$2`,
      [MEMBER_A, FLOW_A],
    ),
    /pause and review/,
  );
  const stillActive = await db.query<{ readonly status: string; readonly version: number }>(
    `select status, version from public.automation_flows where id=$1`,
    [FLOW_A],
  );
  assert.deepEqual(stillActive.rows, [{ status: "active", version: 4 }]);
  await db.close();
});

test("only the service role can record a reviewed preview", async () => {
  const db = await database();
  await assert.rejects(
    () => asRole(db, "authenticated", { sub: ADMIN_A, aal: "aal2" }, () =>
      db.query(
        `select * from public.record_configured_workflow_activation_preview(
          $1, $2, $3, 3, 2, 2,
          '[{"stageId":"reminder","nodeId":"email","eligibleRecords":2}]'::jsonb,
          '2026-11-04'::date, 'Europe/Lisbon'
        )`,
        [FLOW_A, ADMIN_A, DIGEST_A],
      )),
    /permission denied/,
  );
  await db.close();
});
