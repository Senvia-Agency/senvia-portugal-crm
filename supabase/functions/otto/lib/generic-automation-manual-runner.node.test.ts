import assert from "node:assert/strict";
import test from "node:test";

import { runConfiguredManualConfirmation } from "./generic-automation-manual-runner.ts";
import {
  genericAutomationConfirmedTools,
  PREPARE_CONFIGURED_MANUAL_RUN,
} from "./tools/generic-automation-confirmed-tools.ts";

const organizationId = "22222222-2222-4222-8222-222222222222";
const userId = "44444444-4444-4444-8444-444444444444";
const flowId = "11111111-1111-4111-8111-111111111111";
const confirmationId = "55555555-5555-4555-8555-555555555555";
const auditId = "66666666-6666-4666-8666-666666666666";
const workflow = {
  schemaVersion: 1,
  trigger: { kind: "authenticated_manual", timeZone: "Europe/Lisbon" },
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
  name: "Execução manual",
  description: null,
  status: "active",
  trigger_type: "configured_workflow",
  trigger_config: { workflow },
  folder_id: null,
  graph,
  entry_node_id: "trigger",
  version: 3,
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
  readonly error: null;
  readonly count?: number | null;
};

class FixtureQuery implements PromiseLike<FixtureResponse> {
  private mutation: "insert" | "update" | null = null;

  constructor(private readonly table: string) {}

  select(): FixtureQuery { return this; }
  eq(): FixtureQuery { return this; }
  insert(): FixtureQuery { this.mutation = "insert"; return this; }
  update(): FixtureQuery { this.mutation = "update"; return this; }

  private response(): FixtureResponse {
    if (this.table === "otto_pending_actions") {
      return {
        data: {
          id: confirmationId,
          user_id: userId,
          organization_id: organizationId,
          module_key: "automations",
          tool: "run_configured_manual",
          status: "pending",
          expires_at: "2099-11-04T09:05:00Z",
          payload: { flow_id: flowId, flow_version: 3 },
        },
        error: null,
      };
    }
    if (this.table === "organization_members") {
      return { data: { profile_id: null, role: "admin" }, error: null };
    }
    if (this.table === "automation_flows") return { data: flow, error: null };
    if (this.table === "user_roles") return { data: { id: userId }, error: null };
    if (this.table === "organizations") {
      return { data: { enabled_modules: ["automations"] }, error: null };
    }
    if (this.table === "otto_write_grants") {
      return { data: [{ module_key: "automations" }], error: null };
    }
    if (this.table === "otto_action_log" && this.mutation) {
      return { data: { id: auditId }, error: null };
    }
    return { data: null, error: null };
  }

  single(): Promise<FixtureResponse> { return Promise.resolve(this.response()); }
  maybeSingle(): Promise<FixtureResponse> { return Promise.resolve(this.response()); }

  then<TResult1 = FixtureResponse, TResult2 = never>(
    onfulfilled?: ((value: FixtureResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.response()).then(onfulfilled, onrejected);
  }
}

test("manual confirmation is delegated once to the authenticated engine session", async () => {
  const engineCalls: Readonly<Record<string, unknown>>[] = [];
  const adminRpcCalls: string[] = [];
  const supabaseAdmin = {
    from: (table: string) => new FixtureQuery(table),
    rpc(name: string) {
      adminRpcCalls.push(name);
      return Promise.resolve({ data: name === "is_org_admin" ? true : null, error: null });
    },
  };
  const supabaseUser = {
    from(table: string) {
      if (table === "crm_clients") {
        return {
          select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
          then(resolve: (value: FixtureResponse) => unknown) {
            return Promise.resolve(resolve({
              data: [{
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
              }],
              error: null,
              count: null,
            }));
          },
        };
      }
      return {
        select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; }, range() { return this; },
        then(resolve: (value: FixtureResponse & { readonly count: number }) => unknown) {
          return Promise.resolve(resolve({ data: [], error: null, count: 0 }));
        },
      };
    },
    functions: {
      invoke(name: string, input: Readonly<{ body: Readonly<Record<string, unknown>> }>) {
        assert.equal(name, "automation-engine");
        engineCalls.push(input.body);
        if (input.body.action === "prepare_configured_manual") {
          return Promise.resolve({
            data: { confirmation_id: confirmationId, expires_at: "2099-11-04T09:05:00Z" },
            error: null,
          });
        }
        return Promise.resolve({
          data: { scanned: 3, started: 2, skipped: 1, errors: [] },
          error: null,
        });
      },
    },
  };
  const ctx = {
    orgId: organizationId,
    userId,
    isAdmin: true,
    permissions: null,
    writeGrants: new Set(["automations"]),
    enabledModules: new Set(["automations", "clients", "marketing"]),
    dataScope: "all",
    scopeUserIds: new Set([userId]),
    mode: "support",
    supabaseAdmin,
    supabaseUser,
  };
  const gateTool = genericAutomationConfirmedTools.find(({ name }) =>
    name === PREPARE_CONFIGURED_MANUAL_RUN
  );
  assert.ok(gateTool);
  const prepared = await Reflect.apply(gateTool.execute, undefined, [
    { flow_id: flowId },
    ctx,
    gateTool,
  ]);
  assert.equal(prepared.confirmation_id, confirmationId);
  assert.equal(prepared._action_preview.confirmationId, confirmationId);

  const result = await Reflect.apply(runConfiguredManualConfirmation, undefined, [
    ctx,
    confirmationId,
    gateTool,
  ]);

  assert.equal(result.operation, "configured_manual_executed");
  assert.equal(result.outcome, "completed");
  assert.equal(result.started, 2);
  assert.deepEqual(engineCalls, [
    { action: "prepare_configured_manual", flow_id: flowId },
    { action: "run_configured_manual", flow_id: flowId, confirmation_id: confirmationId },
  ]);
  assert.deepEqual(adminRpcCalls, ["is_org_admin"]);
});
