import assert from "node:assert/strict";

import { Engine, type Flow, type Run } from "./index.ts";

type DbResult = { readonly data: unknown; readonly error: { readonly code?: string; readonly message: string } | null };

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const FLOW_ID = "33333333-3333-4333-8333-333333333333";
const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const ACTOR_ID = "55555555-5555-4555-8555-555555555555";

class Query implements PromiseLike<DbResult> {
  private operation: "select" | "insert" | "update" = "select";
  private value: unknown;

  constructor(private readonly db: FakeDatabase, private readonly table: string) {}
  select(): Query { return this; }
  insert(value: unknown): Query { this.operation = "insert"; this.value = value; return this; }
  update(value: unknown): Query { this.operation = "update"; this.value = value; return this; }
  eq(): Query { return this; }
  neq(): Query { return this; }
  in(): Query { return this; }
  is(): Query { return this; }
  gt(): Query { return this; }
  order(): Query { return this; }
  limit(): Query { return this; }
  maybeSingle(): Promise<DbResult> { return Promise.resolve(this.db.resolve(this.table, this.operation, this.value, true)); }
  single(): Promise<DbResult> { return Promise.resolve(this.db.resolve(this.table, this.operation, this.value, true)); }
  then<TResult1 = DbResult, TResult2 = never>(
    onfulfilled?: ((value: DbResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.db.resolve(this.table, this.operation, this.value, false)).then(onfulfilled, onrejected);
  }
}

class FakeDatabase {
  client = client("eligible", "first@example.invalid", "Primeiro");
  readonly steps: Array<Record<string, unknown>> = [];
  readonly runUpdates: Array<Record<string, unknown>> = [];
  readonly sentEmails: unknown[] = [];
  readonly claimCalls: Array<Record<string, unknown>> = [];
  readonly finishCalls: Array<Record<string, unknown>> = [];
  private claimSequence = 0;
  readonly functions = {
    invoke: (_name: string, input: unknown) => {
      this.sentEmails.push(input);
      return Promise.resolve({ data: { results: [{ status: "sent" }] }, error: null });
    },
  };

  from(table: string): Query { return new Query(this, table); }
  rpc(name: string, args: Record<string, unknown> = {}): Promise<DbResult> {
    if (name === "automation_contact_is_suppressed") return Promise.resolve({ data: false, error: null });
    if (name === "is_org_admin") return Promise.resolve({ data: true, error: null });
    if (name === "claim_automation_workflow_stage_execution") {
      this.claimSequence++;
      this.claimCalls.push(args);
      const suffix = String(this.claimSequence).padStart(12, "0");
      return Promise.resolve({ data: [{
        execution_id: `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`,
        claim_token: `bbbbbbbb-bbbb-4bbb-8bbb-${suffix}`,
      }], error: null });
    }
    if (name === "finish_automation_workflow_stage_execution") {
      this.finishCalls.push(args);
      return Promise.resolve({ data: true, error: null });
    }
    throw new Error(`unexpected rpc ${name}`);
  }

  resolve(table: string, operation: string, value: unknown, single: boolean): DbResult {
    if (operation === "insert" && table === "automation_run_steps") {
      this.steps.push(value as Record<string, unknown>);
      return { data: single ? value : [value], error: null };
    }
    if (operation === "update" && table === "automation_runs") {
      this.runUpdates.push(value as Record<string, unknown>);
      return { data: single ? { id: "run", status: "running" } : [], error: null };
    }
    if (table === "automation_runs") return { data: single ? { id: "run", status: "running" } : [], error: null };
    if (table === "automation_run_steps") return { data: this.steps.map(({ node_id }) => ({ node_id })), error: null };
    if (table === "automation_flows") return { data: single ? configuredFlowRow() : [configuredFlowRow()], error: null };
    if (table === "organization_members") return { data: { user_id: ACTOR_ID }, error: null };
    if (table === "organizations") {
      return { data: { enabled_modules: { automations: true, clients: true, marketing: true } }, error: null };
    }
    if (table === "crm_clients") return { data: single ? this.client : [this.client], error: null };
    return { data: single ? null : [], error: null };
  }
}

function client(status: string, email: string, name: string) {
  return {
    id: CLIENT_ID, organization_id: ORG_ID, name, email, phone: "+351900000000",
    status, source: "test", assigned_to: null,
    created_at: "2026-11-01T10:00:00.000Z", updated_at: "2026-11-04T10:00:00.000Z",
  };
}

function definition() {
  return {
    schemaVersion: 1,
    trigger: { kind: "daily_schedule", localTime: "09:00", timeZone: "Europe/Lisbon" },
    query: { entity: "clients", select: ["name", "email", "phone", "status"], filters: [], pageSize: 100 },
    stages: [
      { id: "first-message", nodeId: "email-first", conditions: [], cadence: { mode: "once" } },
      { id: "second-message", nodeId: "email-second", conditions: [], cadence: { mode: "once" } },
    ],
  };
}

function graph() {
  return {
    nodes: [
      { id: "entry", type: "configured_workflow", config: {} },
      { id: "condition", type: "condition", config: { field: "status", operator: "equals", value: "eligible" } },
      { id: "email-first", type: "send_email", config: { subject: "Primeira", html: "{{nome}}" } },
      { id: "wait", type: "wait", config: { amount: 1, unit: "hours" } },
      { id: "email-second", type: "send_email", config: { subject: "Segunda", html: "{{nome}}" } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "a", source: "entry", target: "condition" },
      { id: "b", source: "condition", target: "email-first", branch: "yes" },
      { id: "c", source: "condition", target: "end", branch: "no" },
      { id: "d", source: "email-first", target: "wait" },
      { id: "e", source: "wait", target: "email-second" },
      { id: "f", source: "email-second", target: "end" },
    ],
  };
}

function configuredFlowRow() {
  return {
    id: FLOW_ID, organization_id: ORG_ID, name: "Configured", status: "active",
    trigger_type: "configured_workflow", trigger_config: { workflow: definition() }, graph: graph(),
    entry_node_id: "entry", version: 4, reentry_policy: "once", quiet_hours: null,
    max_steps_per_run: 20, created_by: ACTOR_ID, activated_by: ACTOR_ID,
  };
}

function flow(): Flow { return configuredFlowRow(); }

function run(status: string): Run {
  return {
    id: "11111111-1111-4111-8111-111111111111", organization_id: ORG_ID,
    flow_id: FLOW_ID, flow_version: 4, subject_type: "client", subject_id: CLIENT_ID,
    contact_name: "Inicial", contact_email: "initial@example.invalid", contact_phone: "+351900000000",
    contact_phone_key: "351900000000", status: "running", current_node_id: "entry",
    context: {
      status, name: "Inicial", email: "initial@example.invalid", phone: "+351900000000",
      __configured_workflow_record_id: CLIENT_ID,
      __configured_workflow_entity: "clients",
      __configured_workflow_occurrence_key: "occurrence-2026-11-04",
      __configured_workflow_local_date: "2026-11-04",
      __configured_workflow_time_zone: "Europe/Lisbon",
    },
    steps_taken: 0,
  };
}

function recipient(input: unknown): Readonly<Record<string, unknown>> {
  const body = (input as { body: { recipients: Array<Record<string, unknown>> } }).body;
  return body.recipients[0] ?? {};
}

Deno.test("configured workflow false branch performs no action and creates no cadence claim", async () => {
  const db = new FakeDatabase();
  db.client = client("ineligible", "never@example.invalid", "Ignorado");

  await new Engine(db).advance(run("ineligible"), flow(), "entry");

  assert.equal(db.sentEmails.length, 0);
  assert.equal(db.claimCalls.length, 0);
});

Deno.test("configured workflow resumes after wait, refreshes contact, and claims each reached stage", async () => {
  const db = new FakeDatabase();
  const currentRun = run("eligible");
  const engine = new Engine(db);

  await engine.advance(currentRun, flow(), "entry");
  db.client = client("eligible", "updated@example.invalid", "Atualizado");
  await engine.advance(currentRun, flow(), "email-second");

  assert.deepEqual(db.sentEmails.map((input) => recipient(input).email), [
    "first@example.invalid", "updated@example.invalid",
  ]);
  assert.deepEqual(db.claimCalls.map((call) => call.p_stage_id), ["first-message", "second-message"]);
  assert.deepEqual(db.finishCalls.map((call) => call.p_outcome), ["succeeded", "succeeded"]);
  assert.equal(db.runUpdates.some((update) => update.contact_email === "updated@example.invalid"), true);
});
