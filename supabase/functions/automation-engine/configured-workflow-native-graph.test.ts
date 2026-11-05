import assert from "node:assert/strict";

import { Engine, type Flow, type Run } from "./index.ts";

type Result = { readonly data: unknown; readonly error: { readonly message: string } | null };

class Chain implements PromiseLike<Result> {
  constructor(
    private readonly database: FakeDatabase,
    private readonly table: string,
    private result: Result = { data: null, error: null },
  ) {}
  select(): Chain {
    if (this.table === "automation_run_steps") this.result = { data: [], error: null };
    if (this.table === "automation_runs") this.result = { data: { id: "run", status: "running" }, error: null };
    if (this.table === "crm_clients") this.result = { data: { name: "Fixture", email: "fixture@example.invalid", status: this.database.clientStatus }, error: null };
    return this;
  }
  insert(value: unknown): Chain {
    if (this.table === "automation_run_steps") this.database.steps.push(value);
    this.result = { data: value, error: null };
    return this;
  }
  update(value: unknown): Chain {
    if (this.table === "automation_runs") this.database.runUpdates.push(value);
    return this;
  }
  maybeSingle(): Promise<Result> { return Promise.resolve(this.result); }
  eq(): Chain { return this; }
  neq(): Chain { return this; }
  in(): Chain { return this; }
  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

class FakeDatabase {
  constructor(readonly clientStatus = "eligible") {}
  readonly steps: unknown[] = [];
  readonly runUpdates: unknown[] = [];
  readonly sentEmails: unknown[] = [];
  readonly functions = {
    invoke: (_name: string, input: unknown) => {
      this.sentEmails.push(input);
      return Promise.resolve({ data: { results: [{ status: "sent" }] }, error: null });
    },
  };
  rpc(name: string) {
    if (name !== "automation_contact_is_suppressed") throw new Error(`unexpected rpc ${name}`);
    return Promise.resolve({ data: false, error: null });
  }
  from(table: string): Chain { return new Chain(this, table); }
}

function run(status: string): Run {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    organization_id: "22222222-2222-4222-8222-222222222222",
    flow_id: "33333333-3333-4333-8333-333333333333",
    flow_version: 1,
    subject_type: "client",
    subject_id: "44444444-4444-4444-8444-444444444444",
    contact_name: "Fixture",
    contact_email: "fixture@example.invalid",
    contact_phone: null,
    contact_phone_key: null,
    status: "running",
    current_node_id: "entry",
    context: { status },
    steps_taken: 0,
  };
}

function branchFlow(): Flow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    organization_id: "22222222-2222-4222-8222-222222222222",
    name: "Fixture",
    status: "active",
    trigger_type: "fixture",
    graph: {
      nodes: [
        { id: "entry", type: "trigger", config: {} },
        { id: "condition", type: "condition", config: { field: "status", operator: "equals", value: "eligible" } },
        { id: "email", type: "send_email", config: { subject: "Fixture", html: "Fixture" } },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "a", source: "entry", target: "condition" },
        { id: "b", source: "condition", target: "email", branch: "yes" },
        { id: "c", source: "condition", target: "end", branch: "no" },
      ],
    },
    entry_node_id: "entry",
    version: 1,
    reentry_policy: "once",
    quiet_hours: null,
    max_steps_per_run: 10,
  };
}

Deno.test("a false native condition branch never reaches the email action", async () => {
  const database = new FakeDatabase("ineligible");
  await new Engine(database).advance(run("ineligible"), branchFlow(), "entry");
  assert.equal(database.sentEmails.length, 0);
});

Deno.test("a true native condition branch reaches the email action once", async () => {
  const database = new FakeDatabase();
  await new Engine(database).advance(run("eligible"), branchFlow(), "entry");
  assert.equal(database.sentEmails.length, 1);
});

Deno.test("a native wait parks the run before its following action", async () => {
  const database = new FakeDatabase();
  const flow = branchFlow();
  flow.graph = {
    nodes: [
      { id: "entry", type: "trigger", config: {} },
      { id: "wait", type: "wait", config: { amount: 1, unit: "hours" } },
      { id: "email", type: "send_email", config: { subject: "Fixture", html: "Fixture" } },
    ],
    edges: [
      { id: "a", source: "entry", target: "wait" },
      { id: "b", source: "wait", target: "email" },
    ],
  };
  await new Engine(database).advance(run("eligible"), flow, "entry");
  assert.equal(database.sentEmails.length, 0);
  assert.equal(database.runUpdates.some((value) => (
    typeof value === "object" && value !== null && "status" in value && value.status === "waiting"
  )), true);
});
