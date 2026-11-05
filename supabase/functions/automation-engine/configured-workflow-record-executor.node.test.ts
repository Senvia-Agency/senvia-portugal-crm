import assert from "node:assert/strict";
import test from "node:test";

import type { AutomationWorkflowDefinition, WorkflowRecord } from "../_shared/automation-workflow-contract.ts";
import { executeConfiguredWorkflowRecords } from "./configured-workflow-record-executor.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const definition: AutomationWorkflowDefinition = {
  schemaVersion: 1,
  trigger: { kind: "authenticated_manual", timeZone: "Europe/Lisbon" },
  query: { entity: "clients", select: ["status"], filters: [{ field: "status", operator: "equals", value: "active" }], pageSize: 100 },
  stages: [{ id: "email", nodeId: "email", conditions: [], cadence: { mode: "once" } }],
};
const active: WorkflowRecord = {
  entity: "clients", id: ID, organizationId: ORG, fields: { status: "active" },
};

test("starts one native graph run after current query revalidation", async () => {
  const started: string[] = [];
  const result = await executeConfiguredWorkflowRecords({
    organizationId: ORG, definition, scope: { organizationId: ORG },
    occurrenceLocalDate: "2026-11-04", timeZone: "Europe/Lisbon",
  }, {
    readPage: () => Promise.resolve({ records: [active], nextCursor: null }),
    readCurrentRecord: () => Promise.resolve(active),
    startRecord: (record) => { started.push(record.id); return Promise.resolve(); },
  });
  assert.deepEqual(result, { scanned: 1, started: 1, skipped: 0, errors: [] });
  assert.deepEqual(started, [ID]);
});

test("does not start a graph when current data stopped matching", async () => {
  let started = false;
  const result = await executeConfiguredWorkflowRecords({
    organizationId: ORG, definition, scope: { organizationId: ORG },
    occurrenceLocalDate: "2026-11-04", timeZone: "Europe/Lisbon",
  }, {
    readPage: () => Promise.resolve({ records: [active], nextCursor: null }),
    readCurrentRecord: () => Promise.resolve({ ...active, fields: { status: "inactive" } }),
    startRecord: () => { started = true; return Promise.resolve(); },
  });
  assert.equal(started, false);
  assert.deepEqual(result, { scanned: 1, started: 0, skipped: 1, errors: [] });
});
