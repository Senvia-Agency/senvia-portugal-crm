import assert from "node:assert/strict";
import test from "node:test";

import {
  isCreatableAutomationTrigger,
} from "./generic-automation-schema.ts";
import {
  validateAutomationNodeConfig,
} from "./generic-automation-config.ts";
import {
  buildAutomationActivationSnapshot,
} from "./generic-automation-activation-preview.ts";
import { buildConfiguredWorkflowPreview } from "./generic-automation-workflow-preview.ts";
import {
  deriveAutomationTriggerConfig,
  validateNativeAutomationGraph,
} from "./generic-automation-validation.ts";
import {
  genericAutomationReadTools,
} from "./tools/generic-automation-read-tools.ts";
import {
  genericAutomationWriteTools,
} from "./tools/generic-automation-write-tools.ts";

const workflow = {
  schemaVersion: 1,
  trigger: { kind: "daily_schedule", localTime: "09:00", timeZone: "Europe/Lisbon" },
  query: {
    entity: "receivables",
    select: ["due_date", "contact_email"],
    filters: [],
    pageSize: 100,
  },
  stages: [{
    id: "email_after_10_days",
    nodeId: "send_email",
    conditions: [{
      field: "due_date",
      operator: "before",
      value: { kind: "today_offset_days", days: -10 },
    }],
    cadence: { mode: "once" },
  }],
} as const;

const clientWorkflow = {
  schemaVersion: 1,
  trigger: { kind: "daily_schedule", localTime: "09:00", timeZone: "Europe/Lisbon" },
  query: {
    entity: "clients",
    select: ["name", "email"],
    filters: [],
    pageSize: 100,
  },
  stages: [{
    id: "email_clients",
    nodeId: "send_email",
    conditions: [{ field: "email", operator: "exists" }],
    cadence: { mode: "once" },
  }],
} as const;

type FixtureResponse = {
  readonly data: unknown;
  readonly error: null;
  readonly count: number | null;
};

class FixtureQuery implements PromiseLike<FixtureResponse> {
  constructor(
    private readonly response: FixtureResponse | (() => FixtureResponse),
    private readonly onEq?: (column: string, value: unknown) => void,
    private readonly onIn?: (column: string, values: readonly unknown[]) => void,
  ) {}

  select(): FixtureQuery { return this; }
  eq(column: string, value: unknown): FixtureQuery { this.onEq?.(column, value); return this; }
  in(column: string, values: readonly unknown[]): FixtureQuery { this.onIn?.(column, values); return this; }
  is(): FixtureQuery { return this; }
  order(): FixtureQuery { return this; }
  limit(): FixtureQuery { return this; }
  gt(): FixtureQuery { return this; }
  range(): FixtureQuery { return this; }
  private value(): FixtureResponse {
    return typeof this.response === "function" ? this.response() : this.response;
  }

  maybeSingle(): Promise<FixtureResponse> { return Promise.resolve(this.value()); }

  then<TResult1 = FixtureResponse, TResult2 = never>(
    onfulfilled?: ((value: FixtureResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.value()).then(onfulfilled, onrejected);
  }
}

function workflowClient(organizationId: string) {
  return {
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
}

test("configured workflows are available to the native draft builder", () => {
  assert.equal(isCreatableAutomationTrigger("configured_workflow"), true);
});

test("configured workflow nodes accept the shared execution contract", () => {
  const issues = validateAutomationNodeConfig({
    type: "configured_workflow",
    config: { workflow },
  }, true);

  assert.deepEqual(issues, []);
});

test("configured workflow nodes reject unsupported query fields", () => {
  const issues = validateAutomationNodeConfig({
    type: "configured_workflow",
    config: {
      workflow: {
        ...workflow,
        query: { ...workflow.query, select: ["password"] },
      },
    },
  }, true);

  assert.equal(issues[0]?.code, "configured_workflow_invalid");
});

test("configured workflow drafts may omit stages but activation may not", () => {
  const node = {
    type: "configured_workflow" as const,
    config: { workflow: { ...workflow, stages: [] } },
  };

  assert.deepEqual(validateAutomationNodeConfig(node, false), []);
  assert.equal(
    validateAutomationNodeConfig(node, true)[0]?.code,
    "configured_workflow_invalid",
  );
});

test("configured workflow graph persists the shared definition in trigger config", () => {
  const graph = {
    nodes: [
      { id: "trigger", type: "configured_workflow", config: { workflow } },
      {
        id: "send_email",
        type: "send_email",
        config: { subject: "Pagamento pendente", html: "Regularize o pagamento." },
      },
    ],
    edges: [{ id: "trigger_email", source: "trigger", target: "send_email", branch: null }],
  };
  const result = validateNativeAutomationGraph(graph, {
    entryNodeId: "trigger",
    allowedEntryTriggers: new Set(["configured_workflow"]),
    requireComplete: true,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(deriveAutomationTriggerConfig(result.entryNode), { workflow });
});

test("configured workflow stages must reference an action node in the graph", () => {
  const result = validateNativeAutomationGraph({
    nodes: [{ id: "trigger", type: "configured_workflow", config: { workflow } }],
    edges: [],
  }, {
    entryNodeId: "trigger",
    allowedEntryTriggers: new Set(["configured_workflow"]),
    requireComplete: true,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(
    result.issues.some(({ code }) => code === "workflow_stage_node_missing"),
    true,
  );
});

test("configured workflow validation accepts native conditions, branches and temporal waits", () => {
  const graph = {
    nodes: [
      { id: "trigger", type: "configured_workflow", config: { workflow: clientWorkflow } },
      { id: "condition", type: "condition", config: { field: "name", operator: "equals", value: "Cliente elegível" } },
      { id: "wait", type: "wait", config: { amount: 1, unit: "days" } },
      { id: "send_email", type: "send_email", config: { subject: "Atualização", html: "Mensagem ao cliente." } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "trigger_condition", source: "trigger", target: "condition", branch: null },
      { id: "condition_yes", source: "condition", target: "wait", branch: "yes" },
      { id: "condition_no", source: "condition", target: "end", branch: "no" },
      { id: "wait_email", source: "wait", target: "send_email", branch: null },
    ],
  };

  const result = validateNativeAutomationGraph(graph, {
    entryNodeId: "trigger",
    allowedEntryTriggers: new Set(["configured_workflow"]),
    requireComplete: true,
  });

  assert.equal(result.ok, true);
});

test("configured workflow validation rejects conversational waits", () => {
  const interactiveWorkflow = {
    ...clientWorkflow,
    stages: [{ ...clientWorkflow.stages[0], nodeId: "send_whatsapp" }],
  };
  const result = validateNativeAutomationGraph({
    nodes: [
      { id: "trigger", type: "configured_workflow", config: { workflow: interactiveWorkflow } },
      {
        id: "send_whatsapp",
        type: "send_whatsapp",
        config: {
          message: "Confirma a receção.",
          wait_reply: true,
          rules: [
            { id: "yes", label: "Sim", keywords: ["sim"] },
            { id: "no", label: "Não", keywords: ["não"] },
          ],
        },
      },
    ],
    edges: [{ id: "trigger_whatsapp", source: "trigger", target: "send_whatsapp", branch: null }],
  }, {
    entryNodeId: "trigger",
    allowedEntryTriggers: new Set(["configured_workflow"]),
    requireComplete: true,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(
    result.issues.some(({ code }) => code === "workflow_interactive_wait_unsupported"),
    true,
  );
});

test("configured workflow drafts require an explicit graph", async () => {
  const tool = genericAutomationWriteTools.find(({ name }) => name === "create_automation_draft");
  assert.ok(tool);

  const result = await Reflect.apply(tool.execute, undefined, [{
    name: "Cobranças configuráveis",
    trigger_type: "configured_workflow",
  }, null]);

  assert.equal(result.reason_code, "configured_workflow_graph_required");
});

test("builder schema publishes the shared workflow catalog", async () => {
  const tool = genericAutomationReadTools.find(({ name }) => name === "get_automation_builder_schema");
  assert.ok(tool);

  const result = await Reflect.apply(tool.execute, undefined, [{}, null]);
  assert.equal(result.configured_workflow_contract.schema_version, 1);
  assert.deepEqual(result.configured_workflow_contract.entities, [
    "receivables",
    "clients",
    "leads",
    "proposals",
  ]);
  assert.deepEqual(result.configured_workflow_contract.cadence_default, { mode: "once" });
});

test("configured workflows cannot activate without a real catch-up estimate", async () => {
  const result = await Reflect.apply(buildAutomationActivationSnapshot, undefined, [{
    isAdmin: false,
    dataScope: "own",
    enabledModules: new Set(["automations"]),
    permissions: null,
  }, {
    id: "11111111-1111-4111-8111-111111111111",
    version: 1,
    trigger_type: "configured_workflow",
    entryNode: { config: { workflow } },
    graph: { nodes: [], edges: [] },
  }]);

  assert.deepEqual(result, {
    ok: false,
    reasonCode: "catchup_estimate_unavailable",
  });
});

test("configured workflow activation snapshot includes a complete RLS-scoped estimate", async () => {
  const organizationId = "22222222-2222-4222-8222-222222222222";
  const graph = {
    nodes: [
      { id: "trigger", type: "configured_workflow", config: { workflow: clientWorkflow } },
      {
        id: "send_email",
        type: "send_email",
        config: { subject: "Atualização", html: "Mensagem ao cliente." },
      },
    ],
    edges: [{ id: "trigger_email", source: "trigger", target: "send_email", branch: null }],
  };
  const flow = {
    id: "11111111-1111-4111-8111-111111111111",
    organization_id: organizationId,
    name: "Clientes por email",
    description: null,
    status: "draft",
    trigger_type: "configured_workflow",
    trigger_config: { workflow: clientWorkflow },
    folder_id: null,
    graph,
    entry_node_id: "trigger",
    entryNode: graph.nodes[0],
    version: 1,
    reentry_policy: "once",
    quiet_hours: null,
    max_steps_per_run: 100,
    created_by: null,
    created_at: "2026-11-04T09:00:00Z",
    updated_at: "2026-11-04T09:00:00Z",
    last_enrolled_at: null,
  };
  const supabaseUser = {
    from(table: string) {
      if (table === "crm_clients") {
        return new FixtureQuery({ data: [workflowClient(organizationId)], error: null, count: null });
      }
      if (table === "automation_workflow_stage_executions") {
        return new FixtureQuery({ data: [], error: null, count: 0 });
      }
      return new FixtureQuery({ data: [], error: null, count: null });
    },
  };

  const result = await Reflect.apply(buildAutomationActivationSnapshot, undefined, [{
    orgId: organizationId,
    isAdmin: true,
    dataScope: "all",
    scopeUserIds: new Set(),
    enabledModules: new Set(["automations", "clients", "marketing"]),
    permissions: null,
    supabaseUser,
  }, flow]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.digest.length, 64);
  assert.equal(result.configuredWorkflowPreview?.eligibleRecords, 1);
  assert.match(result.summary, /1 registos avaliados, 1 com ações imediatas e 1 ações imediatas elegíveis/);
  assert.match(result.summary, /revalida a elegibilidade antes de cada ação/);
});

test("preview keeps once cadence across versions and scopes other cadence to the execution version", async () => {
  const organizationId = "22222222-2222-4222-8222-222222222222";
  const clientId = "33333333-3333-4333-8333-333333333333";
  const definition = {
    ...clientWorkflow,
    stages: [
      clientWorkflow.stages[0],
      {
        id: "task_interval",
        nodeId: "create_task",
        conditions: [{ field: "email", operator: "exists" }],
        cadence: { mode: "interval_days", days: 7 },
      },
    ],
  } as const;
  const historyReads: Array<Readonly<{ stageIds: readonly unknown[]; version: unknown }>> = [];
  const supabaseUser = {
    from(table: string) {
      if (table === "crm_clients") {
        return new FixtureQuery({ data: [workflowClient(organizationId)], error: null, count: null });
      }
      let version: unknown = null;
      let stageIds: readonly unknown[] = [];
      return new FixtureQuery(
        () => {
          historyReads.push({ stageIds, version });
          const once = stageIds.includes("email_clients");
          return {
            data: once ? [{
              record_id: clientId,
              stage_id: "email_clients",
              occurrence_key: "run-v4",
              local_date: "2026-11-03",
              status: "succeeded",
            }] : [],
            error: null,
            count: once ? 1 : 0,
          };
        },
        (column, value) => {
          if (column === "flow_version") version = value;
        },
        (column, values) => {
          if (column === "stage_id") stageIds = values;
        },
      );
    },
  };
  const result = await Reflect.apply(buildConfiguredWorkflowPreview, undefined, [{
    orgId: organizationId,
    isAdmin: true,
    dataScope: "all",
    enabledModules: new Set(["automations", "clients", "marketing", "inbox"]),
    permissions: null,
    supabaseUser,
  }, {
    id: "11111111-1111-4111-8111-111111111111",
    version: 4,
    entry_node_id: "trigger",
    graph: {
      nodes: [
        { id: "trigger", type: "configured_workflow", config: { workflow: definition } },
        { id: "send_email", type: "send_email", config: {} },
        { id: "create_task", type: "create_task", config: {} },
      ],
      edges: [
        { id: "trigger_email", source: "trigger", target: "send_email", branch: null },
        { id: "trigger_task", source: "trigger", target: "create_task", branch: null },
      ],
    },
  }, definition, {
    now: new Date("2026-11-04T12:00:00Z"),
    executionVersion: 5,
  }]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.stages, [
    {
      stageId: "email_clients",
      nodeId: "send_email",
      eligibleRecords: 0,
      immediateRecords: 0,
      deferredRecords: 0,
    },
    {
      stageId: "task_interval",
      nodeId: "create_task",
      eligibleRecords: 1,
      immediateRecords: 1,
      deferredRecords: 0,
    },
  ]);
  assert.deepEqual(historyReads, [
    { stageIds: ["email_clients"], version: null },
    { stageIds: ["task_interval"], version: 5 },
  ]);
});

test("workflow detail remains a draft until catch-up can be estimated", async () => {
  const organizationId = "22222222-2222-4222-8222-222222222222";
  const flowId = "11111111-1111-4111-8111-111111111111";
  const graph = {
    nodes: [
      { id: "trigger", type: "configured_workflow", config: { workflow } },
      {
        id: "send_email",
        type: "send_email",
        config: { subject: "Pagamento pendente", html: "Regularize o pagamento." },
      },
    ],
    edges: [{ id: "trigger_email", source: "trigger", target: "send_email", branch: null }],
  };
  const flow = {
    id: flowId,
    organization_id: organizationId,
    name: "Cobranças configuráveis",
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
    created_by: null,
    created_at: "2026-11-04T09:00:00Z",
    updated_at: "2026-11-04T09:00:00Z",
    last_enrolled_at: null,
  };
  const query = {
    select() { return query; },
    eq() { return query; },
    maybeSingle() { return Promise.resolve({ data: flow, error: null }); },
  };
  const tool = genericAutomationReadTools.find(({ name }) => name === "get_automation_flow");
  assert.ok(tool);

  const result = await Reflect.apply(tool.execute, undefined, [{ flow_id: flowId }, {
    orgId: organizationId,
    dataScope: "all",
    scopeUserIds: new Set(),
    isAdmin: false,
    enabledModules: new Set(["automations"]),
    permissions: null,
    supabaseAdmin: { from: () => query },
    supabaseUser: {},
  }]);

  assert.deepEqual(result.configured_workflow, workflow);
  assert.equal(result.activation_validation.ready, false);
  assert.equal(
    result.activation_validation.catchup_estimate.reason_code,
    "catchup_estimate_unavailable",
  );
});
