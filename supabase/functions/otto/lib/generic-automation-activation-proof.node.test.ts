import assert from "node:assert/strict";
import test from "node:test";

import { genericAutomationConfirmedTools } from "./tools/generic-automation-confirmed-tools.ts";

const organizationId = "22222222-2222-4222-8222-222222222222";
const userId = "44444444-4444-4444-8444-444444444444";
const flowId = "11111111-1111-4111-8111-111111111111";
const proofId = "55555555-5555-4555-8555-555555555555";

const workflow = {
  schemaVersion: 1,
  trigger: { kind: "daily_schedule", localTime: "09:00", timeZone: "Europe/Lisbon" },
  query: { entity: "clients", select: ["name", "email"], filters: [], pageSize: 100 },
  stages: [{
    id: "email_clients",
    nodeId: "send_email",
    conditions: [{ field: "email", operator: "exists" }],
    cadence: { mode: "once" },
  }],
} as const;
const graph = {
  nodes: [
    { id: "trigger", type: "configured_workflow", config: { workflow } },
    { id: "send_email", type: "send_email", config: { subject: "Atualização", html: "Mensagem ao cliente." } },
  ],
  edges: [{ id: "trigger_email", source: "trigger", target: "send_email", branch: null }],
};
const flow = {
  id: flowId,
  organization_id: organizationId,
  name: "Clientes por email",
  description: null,
  status: "draft",
  trigger_type: "configured_workflow",
  trigger_config: { workflow },
  folder_id: null,
  graph,
  entry_node_id: "trigger",
  version: 1,
  reentry_policy: "once",
  quiet_hours: null,
  max_steps_per_run: 100,
  created_by: userId,
  created_at: "2026-11-04T09:00:00Z",
  updated_at: "2026-11-04T09:00:00Z",
  last_enrolled_at: null,
};

type FixtureResponse = {
  readonly data: unknown;
  readonly error: Readonly<{ message: string }> | null;
  readonly count: number | null;
};

class FixtureQuery implements PromiseLike<FixtureResponse> {
  constructor(private readonly response: FixtureResponse) {}

  select(): FixtureQuery { return this; }
  update(): FixtureQuery { throw new Error("configured activation must not update with the admin client"); }
  eq(): FixtureQuery { return this; }
  in(): FixtureQuery { return this; }
  is(): FixtureQuery { return this; }
  order(): FixtureQuery { return this; }
  limit(): FixtureQuery { return this; }
  range(): FixtureQuery { return this; }
  maybeSingle(): Promise<FixtureResponse> { return Promise.resolve(this.response); }

  then<TResult1 = FixtureResponse, TResult2 = never>(
    onfulfilled?: ((value: FixtureResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.response).then(onfulfilled, onrejected);
  }
}

test("configured activation records a server proof and consumes it with the user session", async () => {
  const proofCalls: Readonly<Record<string, unknown>>[] = [];
  const activationCalls: Readonly<Record<string, unknown>>[] = [];
  const activeFlow = { ...flow, status: "active", version: 2 };
  const clientRow = {
    id: "33333333-3333-4333-8333-333333333333",
    organization_id: organizationId,
    name: "Cliente elegível",
    email: "cliente@example.test",
    phone: null,
    status: "active",
    source: "test",
    assigned_to: null,
    created_at: "2026-11-01T09:00:00Z",
    updated_at: "2026-11-01T09:00:00Z",
  };
  const supabaseAdmin = {
    from: () => new FixtureQuery({ data: flow, error: null, count: null }),
    rpc(name: string, args: Readonly<Record<string, unknown>>) {
      assert.equal(name, "record_configured_workflow_activation_preview");
      proofCalls.push(args);
      return Promise.resolve({
        data: [{ preview_id: proofId, expires_at: "2026-11-04T09:05:00Z" }],
        error: null,
      });
    },
  };
  const supabaseUser = {
    from(table: string) {
      if (table === "crm_clients") {
        return new FixtureQuery({ data: [clientRow], error: null, count: null });
      }
      return new FixtureQuery({ data: [], error: null, count: 0 });
    },
    rpc(name: string, args: Readonly<Record<string, unknown>>) {
      assert.equal(name, "activate_configured_workflow_from_preview");
      activationCalls.push(args);
      return Promise.resolve({ data: [activeFlow], error: null });
    },
  };
  const ctx = {
    orgId: organizationId,
    userId,
    isAdmin: true,
    dataScope: "all",
    scopeUserIds: new Set([userId]),
    enabledModules: new Set(["automations", "clients", "marketing"]),
    writeGrants: new Set(["automations"]),
    permissions: null,
    supabaseAdmin,
    supabaseUser,
  };
  const tool = genericAutomationConfirmedTools.find(({ name }) => name === "activate_automation_flow");
  assert.ok(tool);
  assert.equal(tool.confirmation?.kind, "confirmation_required");
  if (tool.confirmation?.kind !== "confirmation_required") return;

  const preview = await Reflect.apply(tool.confirmation.preview, undefined, [{
    flow_id: flowId,
    expected_version: 1,
    expected_updated_at: flow.updated_at,
  }, ctx]);
  assert.ok(preview?.preparedArgs);
  assert.equal(preview.preparedArgs.activation_preview_id, proofId);
  assert.equal(proofCalls.length, 1);
  assert.equal(proofCalls[0].p_previewed_by, userId);
  assert.equal(proofCalls[0].p_eligible_records, 1);

  const result = await Reflect.apply(tool.execute, undefined, [preview.preparedArgs, ctx, tool]);
  assert.equal(result.operation, "activated");
  assert.equal(result.flow.status, "active");
  assert.equal(activationCalls.length, 1);
  assert.equal(activationCalls[0].p_preview_id, proofId);
  assert.equal(activationCalls[0].p_snapshot_digest, preview.preparedArgs.activation_snapshot_digest);
});
