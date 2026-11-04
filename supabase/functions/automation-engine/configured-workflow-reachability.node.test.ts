import assert from "node:assert/strict";
import test from "node:test";

import { evaluateConfiguredGraphReachability } from "./configured-workflow-reachability.ts";

const record = {
  entity: "clients" as const,
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  fields: { status: "inactive" },
};

function graph(operator = "equals") {
  return {
    nodes: [
      { id: "entry", type: "configured_workflow", config: {} },
      { id: "condition", type: "condition", config: { field: "status", operator, value: "active" } },
      { id: "yes-email", type: "send_email", config: {} },
      { id: "wait", type: "wait", config: { amount: 1, unit: "days" } },
      { id: "no-task", type: "create_task", config: {} },
    ],
    edges: [
      { id: "a", source: "entry", target: "condition" },
      { id: "b", source: "condition", target: "yes-email", branch: "yes" },
      { id: "c", source: "condition", target: "wait", branch: "no" },
      { id: "d", source: "wait", target: "no-task" },
    ],
  };
}

test("marks only the false branch action reachable and preserves wait deferral", () => {
  const result = evaluateConfiguredGraphReachability({ graph: graph(), entryNodeId: "entry", record });
  assert.deepEqual(result.actions, {
    "yes-email": { kind: "unreachable" },
    "no-task": { kind: "reachable_after_wait" },
  });
  assert.equal(result.complete, true);
});

test("marks database-dependent branches unknown instead of guessing", () => {
  const result = evaluateConfiguredGraphReachability({ graph: graph("in_crm"), entryNodeId: "entry", record });
  assert.deepEqual(result.actions, {
    "yes-email": { kind: "unknown", reason: "database_condition" },
    "no-task": { kind: "unknown", reason: "database_condition" },
  });
  assert.equal(result.complete, false);
});

test("fails closed when a graph contains a cycle", () => {
  const cyclic = graph();
  cyclic.edges.push({ id: "e", source: "no-task", target: "condition" });
  const result = evaluateConfiguredGraphReachability({ graph: cyclic, entryNodeId: "entry", record });
  assert.deepEqual(result.actions, {
    "yes-email": { kind: "unknown", reason: "cycle" },
    "no-task": { kind: "unknown", reason: "cycle" },
  });
  assert.equal(result.complete, false);
});
