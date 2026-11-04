import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";

export const ORG_A = "11111111-1111-4111-8111-111111111111";
export const ORG_B = "22222222-2222-4222-8222-222222222222";
export const ADMIN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const ADMIN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const MEMBER_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const FLOW_A = "33333333-3333-4333-8333-333333333333";
export const FLOW_B = "44444444-4444-4444-8444-444444444444";
export const LEGACY_FLOW = "55555555-5555-4555-8555-555555555555";
export const DIGEST_A = "a".repeat(64);

const MIGRATION = new URL(
  "../../migrations/20261104153556_configured_workflow_activation_proofs.sql",
  import.meta.url,
);

export interface PreviewProof {
  readonly preview_id: string;
  readonly expires_at: string;
}

export async function database(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create role anon;
    create role authenticated;
    create role service_role;

    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;

    create table public.organizations (id uuid primary key);
    create table public.organization_profiles (
      id uuid primary key,
      organization_id uuid not null references public.organizations(id),
      base_role text not null
    );
    create table public.organization_members (
      organization_id uuid not null references public.organizations(id),
      user_id uuid not null,
      profile_id uuid references public.organization_profiles(id),
      role text not null,
      is_active boolean not null default true,
      primary key (organization_id, user_id)
    );
    create table public.automation_flows (
      id uuid primary key,
      organization_id uuid not null references public.organizations(id),
      name text not null,
      description text,
      status text not null,
      trigger_type text not null,
      trigger_config jsonb not null default '{}'::jsonb,
      graph jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
      entry_node_id text,
      version integer not null default 1,
      reentry_policy text not null default 'once',
      quiet_hours jsonb not null default '{}'::jsonb,
      max_steps_per_run integer not null default 100,
      created_by uuid,
      activated_by uuid,
      updated_at timestamptz not null default clock_timestamp(),
      activated_at timestamptz
    );

    create function public.is_org_admin(p_user_id uuid, p_org_id uuid)
    returns boolean language sql stable as $$
      select p_user_id = auth.uid()
        and auth.jwt()->>'aal' = 'aal2'
        and exists (
          select 1
          from public.organization_members om
          left join public.organization_profiles op
            on op.id = om.profile_id and op.organization_id = om.organization_id
          where om.user_id = p_user_id
            and om.organization_id = p_org_id
            and om.is_active
            and (om.role = 'admin' or op.base_role = 'admin')
        )
    $$;

    create function public.fixture_set_flow_timestamps()
    returns trigger language plpgsql as $$
    begin
      new.updated_at := clock_timestamp();
      if tg_op = 'INSERT' then
        new.activated_at := case when new.status = 'active' then clock_timestamp() end;
      elsif new.status = 'active' and old.status is distinct from 'active' then
        new.activated_at := clock_timestamp();
      else
        new.activated_at := old.activated_at;
      end if;
      return new;
    end
    $$;
    create trigger aaa_fixture_flow_timestamps
      before insert or update on public.automation_flows
      for each row execute function public.fixture_set_flow_timestamps();
  `);

  await db.exec(await readFile(MIGRATION, "utf8"));
  await db.query(
    `insert into public.organizations(id) values ($1), ($2)`,
    [ORG_A, ORG_B],
  );
  await db.query(
    `insert into public.organization_profiles(id, organization_id, base_role)
     values
       ('10000000-0000-4000-8000-000000000001', $1, 'admin'),
       ('20000000-0000-4000-8000-000000000002', $2, 'admin')`,
    [ORG_A, ORG_B],
  );
  await db.query(
    `insert into public.organization_members
       (organization_id, user_id, profile_id, role, is_active)
     values
       ($1, $2, '10000000-0000-4000-8000-000000000001', 'admin', true),
       ($3, $4, '20000000-0000-4000-8000-000000000002', 'admin', true),
       ($1, $5, null, 'member', true)`,
    [ORG_A, ADMIN_A, ORG_B, ADMIN_B, MEMBER_A],
  );
  const triggerConfig = JSON.stringify({
    workflow: {
      trigger: { kind: "daily_schedule", localTime: "09:00", timeZone: "Europe/Lisbon" },
      stages: [{ id: "reminder", nodeId: "email" }],
    },
  });
  const graph = JSON.stringify({
    nodes: [{ id: "email", type: "send_email" }],
    edges: [],
  });
  await db.query(
    `insert into public.automation_flows
       (id, organization_id, name, status, trigger_type, trigger_config, graph,
        entry_node_id, version, created_by)
     values
       ($1, $2, 'Flow A', 'draft', 'configured_workflow', $3, $4, 'email', 3, $5),
       ($6, $7, 'Flow B', 'draft', 'configured_workflow', $3, $4, 'email', 7, $8),
       ($9, $2, 'Legacy', 'draft', 'sale_created', '{}'::jsonb, $4, 'email', 1, $5)`,
    [FLOW_A, ORG_A, triggerConfig, graph, ADMIN_A, FLOW_B, ORG_B, ADMIN_B, LEGACY_FLOW],
  );
  return db;
}

export async function asRole<T>(
  db: PGlite,
  role: "authenticated" | "service_role",
  claims: Readonly<Record<string, string>>,
  operation: () => Promise<T>,
): Promise<T> {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ role, ...claims }),
  ]);
  try {
    return await operation();
  } finally {
    await db.exec("reset role");
    await db.exec("reset request.jwt.claims");
  }
}

export async function recordPreview(
  db: PGlite,
  options: {
    readonly flowId?: string;
    readonly actor?: string;
    readonly digest?: string;
  } = {},
): Promise<PreviewProof> {
  const flowId = options.flowId ?? FLOW_A;
  const actor = options.actor ?? ADMIN_A;
  const digest = options.digest ?? DIGEST_A;
  return asRole(db, "service_role", {}, async () => {
    const result = await db.query<PreviewProof>(
      `select * from public.record_configured_workflow_activation_preview(
        $1, $2, $3, 3, 2, 2,
        '[{"stageId":"reminder","nodeId":"email","eligibleRecords":2}]'::jsonb,
        '2026-11-04'::date, 'Europe/Lisbon'
      )`,
      [flowId, actor, digest],
    );
    const proof = result.rows[0];
    if (!proof) throw new Error("preview RPC returned no proof");
    return proof;
  });
}

export async function activate(
  db: PGlite,
  proof: PreviewProof,
  options: {
    readonly actor?: string;
    readonly digest?: string;
    readonly aal?: "aal1" | "aal2";
  } = {},
) {
  return asRole(db, "authenticated", {
    sub: options.actor ?? ADMIN_A,
    aal: options.aal ?? "aal2",
  }, () => db.query<{
    readonly id: string;
    readonly status: string;
    readonly version: number;
    readonly activated_by: string | null;
  }>(
    `select id, status, version, activated_by
     from public.activate_configured_workflow_from_preview($1, $2)`,
    [proof.preview_id, options.digest ?? DIGEST_A],
  ));
}
