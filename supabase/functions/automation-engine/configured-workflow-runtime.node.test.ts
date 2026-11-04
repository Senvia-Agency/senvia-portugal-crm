import assert from "node:assert/strict";
import test from "node:test";

import type {
  AutomationWorkflowDefinition,
  WorkflowRecord,
} from "../_shared/automation-workflow-contract.ts";
import {
  planConfiguredWorkflowStages,
  type ConfiguredStageAttempt,
} from "./configured-workflow-runtime.ts";

const definition: AutomationWorkflowDefinition = {
  schemaVersion: 1,
  trigger: { kind: "daily_schedule", localTime: "09:00", timeZone: "Europe/Lisbon" },
  query: {
    entity: "receivables",
    select: ["due_date", "status", "outstanding_amount"],
    filters: [],
    pageSize: 100,
  },
  stages: [
    {
      id: "late-email",
      nodeId: "send-email",
      conditions: [{
        field: "due_date",
        operator: "before",
        value: { kind: "today_offset_days", days: -10 },
      }],
      cadence: { mode: "once" },
    },
  ],
};

const record: WorkflowRecord = {
  entity: "receivables",
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  fields: { due_date: "2026-10-01", status: "pending", outstanding_amount: 100 },
  contact: { name: "Fixture", email: "fixture@example.invalid", phone: null },
};

const nodes = [{ id: "send-email", type: "send_email", config: { subject: "Fixture", html: "Fixture" } }] as const;

function plan(attempts: readonly ConfiguredStageAttempt[] = []) {
  return planConfiguredWorkflowStages({
    definition,
    record,
    graphNodes: nodes,
    occurrenceKey: "2026-11-04",
    occurrenceLocalDate: "2026-11-04",
    timeZone: "Europe/Lisbon",
    attempts,
  });
}

test("plans the native action when the current record matches", () => {
  // Given a debt older than ten completed days and no prior stage attempt.
  // When the runtime plans the configured stages.
  const result = plan();
  // Then the referenced native action is ready with a once-only claim key.
  assert.deepEqual(result.map((item) => ({ kind: item.kind, key: item.kind === "ready" ? item.cadenceKey : null })), [
    { kind: "ready", key: "once" },
  ]);
});

test("does not plan an action whose condition no longer matches", () => {
  // Given a debt whose due date is not older than the configured threshold.
  const current = { ...record, fields: { ...record.fields, due_date: "2026-11-01" } };
  // When the runtime re-evaluates the stage against current data.
  const result = planConfiguredWorkflowStages({
    definition,
    record: current,
    graphNodes: nodes,
    occurrenceKey: "2026-11-04",
    occurrenceLocalDate: "2026-11-04",
    timeZone: "Europe/Lisbon",
    attempts: [],
  });
  // Then it skips the action rather than sending with stale scheduler data.
  assert.equal(result[0]?.kind, "skipped");
  assert.equal(result[0]?.kind === "skipped" ? result[0].reason : null, "condition_mismatch");
});

test("blocks a once-only stage after any prior attempt", () => {
  // Given an unknown prior outcome for the same record and stage.
  const attempts: readonly ConfiguredStageAttempt[] = [{
    stageId: "late-email",
    occurrenceKey: "2026-11-03",
    localDate: "2026-11-03",
    status: "unknown",
  }];
  // When the next daily occurrence is planned.
  const result = plan(attempts);
  // Then it does not retry the external effect automatically.
  assert.equal(result[0]?.kind === "skipped" ? result[0].reason : null, "cadence_blocked");
});

test("rejects a stage that points outside the native action graph", () => {
  // Given a stage reference that resolves only to the workflow entry node.
  const graphNodes = [{ id: "send-email", type: "configured_workflow", config: {} }] as const;
  // When the runtime validates the stage action.
  const result = planConfiguredWorkflowStages({
    definition,
    record,
    graphNodes,
    occurrenceKey: "2026-11-04",
    occurrenceLocalDate: "2026-11-04",
    timeZone: "Europe/Lisbon",
    attempts: [],
  });
  // Then the stage fails closed and no action is planned.
  assert.equal(result[0]?.kind === "skipped" ? result[0].reason : null, "invalid_action_node");
});

test("rejects conversational WhatsApp nodes that could outlive a configured stage", () => {
  const result = planConfiguredWorkflowStages({
    definition,
    record,
    graphNodes: [{ id: "send-email", type: "send_whatsapp", config: { message: "Fixture", wait_reply: true } }],
    occurrenceKey: "2026-11-04",
    occurrenceLocalDate: "2026-11-04",
    timeZone: "Europe/Lisbon",
    attempts: [],
  });
  assert.equal(result[0]?.kind === "skipped" ? result[0].reason : null, "invalid_action_node");
});

test("fails closed when a record belongs to another configured entity", () => {
  const result = planConfiguredWorkflowStages({
    definition,
    record: { ...record, entity: "clients" },
    graphNodes: nodes,
    occurrenceKey: "2026-11-04",
    occurrenceLocalDate: "2026-11-04",
    timeZone: "Europe/Lisbon",
    attempts: [],
  });
  assert.equal(result[0]?.kind === "skipped" ? result[0].reason : null, "query_mismatch");
});

test("re-evaluates query filters before planning the action", () => {
  const filtered: AutomationWorkflowDefinition = {
    ...definition,
    query: {
      ...definition.query,
      filters: [{ field: "status", operator: "equals", value: "pending" }],
      select: [...definition.query.select, "status"],
    },
  };
  const result = planConfiguredWorkflowStages({
    definition: filtered,
    record: { ...record, fields: { ...record.fields, status: "paid" } },
    graphNodes: nodes,
    occurrenceKey: "2026-11-04",
    occurrenceLocalDate: "2026-11-04",
    timeZone: "Europe/Lisbon",
    attempts: [],
  });
  assert.equal(result[0]?.kind === "skipped" ? result[0].reason : null, "query_mismatch");
});

test("blocks interval cadence after a failed or unknown external attempt", () => {
  const intervalDefinition: AutomationWorkflowDefinition = {
    ...definition,
    stages: [{ ...definition.stages[0], cadence: { mode: "interval_days", days: 7 } }],
  };
  const result = planConfiguredWorkflowStages({
    definition: intervalDefinition,
    record,
    graphNodes: nodes,
    occurrenceKey: "2026-11-04",
    occurrenceLocalDate: "2026-11-04",
    timeZone: "Europe/Lisbon",
    attempts: [{
      stageId: "late-email", occurrenceKey: "2026-11-03", localDate: "2026-11-03", status: "failed",
    }],
  });
  assert.equal(result[0]?.kind === "skipped" ? result[0].reason : null, "cadence_blocked");
});
