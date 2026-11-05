import assert from "node:assert/strict";

import {
  configuredNativeEventTarget,
  configuredWorkflowRequiredModules,
} from "./configured-workflow-integration.ts";
import type { AutomationWorkflowDefinition } from "../_shared/automation-workflow-contract.ts";

Deno.test("maps a client event to exactly the event record", () => {
  assert.deepEqual(configuredNativeEventTarget("client_status_changed", {
    id: "11111111-1111-4111-8111-111111111111",
    updated_at: "2026-11-04T09:00:00.000Z",
  }), {
    entity: "clients",
    recordId: "11111111-1111-4111-8111-111111111111",
    identity: "2026-11-04T09:00:00.000Z",
  });
});

Deno.test("does not turn an unsupported sale event into an organization-wide query", () => {
  assert.equal(configuredNativeEventTarget("sale_status_changed", {
    id: "11111111-1111-4111-8111-111111111111",
  }), null);
});

Deno.test("rejects a supported event without a record id", () => {
  assert.equal(configuredNativeEventTarget("proposal_created", {
    created_at: "2026-11-04T09:00:00.000Z",
  }), null);
});

Deno.test("requires current finance and channel modules for receivable actions", () => {
  const definition: AutomationWorkflowDefinition = {
    schemaVersion: 1,
    trigger: { kind: "daily_schedule", localTime: "09:00", timeZone: "Europe/Lisbon" },
    query: { entity: "receivables", select: ["status"], filters: [], pageSize: 100 },
    stages: [
      { id: "email", nodeId: "email-node", conditions: [], cadence: { mode: "once" } },
      { id: "whatsapp", nodeId: "wa-node", conditions: [], cadence: { mode: "once" } },
    ],
  };
  const modules = configuredWorkflowRequiredModules({ graph: {
    nodes: [
      { id: "email-node", type: "send_email", config: {} },
      { id: "wa-node", type: "send_whatsapp", config: {} },
    ], edges: [],
  } }, definition);
  assert.deepEqual([...modules].sort(), ["automations", "finance", "inbox", "marketing", "sales"]);
});
