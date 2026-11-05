import assert from "node:assert/strict";
import test from "node:test";

import {
  claimDueWorkflowOccurrences,
  finishWorkflowOccurrence,
  type WorkflowSchedulerRpc,
} from "./automation-workflow-scheduler.ts";

const OCCURRENCE_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";
const FLOW_ID = "33333333-3333-4333-8333-333333333333";
const CLAIM_TOKEN = "44444444-4444-4444-8444-444444444444";

test("claims due configured workflows with bounded lease arguments", async () => {
  // Given
  const calls: Array<{ readonly name: string; readonly args: Readonly<Record<string, unknown>> }> = [];
  const rpc: WorkflowSchedulerRpc = {
    rpc: (name, args) => {
      calls.push({ name, args });
      return Promise.resolve({
        data: [{
          occurrence_id: OCCURRENCE_ID,
          organization_id: ORGANIZATION_ID,
          flow_id: FLOW_ID,
          flow_version: 7,
          local_date: "2026-11-04",
          scheduled_for: "2026-11-04T09:30:00.000Z",
          claim_token: CLAIM_TOKEN,
          lease_until: "2026-11-04T09:35:00.000Z",
        }],
        error: null,
      });
    },
  };

  // When
  const result = await claimDueWorkflowOccurrences(rpc, {
    now: new Date("2026-11-04T09:31:00.000Z"),
    limit: 25,
    leaseSeconds: 300,
  });

  // Then
  assert.deepEqual(result, {
    kind: "claimed",
    occurrences: [{
      occurrenceId: OCCURRENCE_ID,
      organizationId: ORGANIZATION_ID,
      flowId: FLOW_ID,
      flowVersion: 7,
      localDate: "2026-11-04",
      scheduledFor: "2026-11-04T09:30:00.000Z",
      claimToken: CLAIM_TOKEN,
      leaseUntil: "2026-11-04T09:35:00.000Z",
    }],
  });
  assert.deepEqual(calls, [{
    name: "claim_due_automation_workflow_occurrences",
    args: {
      p_now: "2026-11-04T09:31:00.000Z",
      p_limit: 25,
      p_lease_seconds: 300,
    },
  }]);
});

test("rejects malformed claim rows instead of running another tenant occurrence", async () => {
  // Given
  const rpc: WorkflowSchedulerRpc = {
    rpc: () => Promise.resolve({ data: [{ occurrence_id: OCCURRENCE_ID }], error: null }),
  };

  // When
  const result = await claimDueWorkflowOccurrences(rpc, {
    now: new Date("2026-11-04T09:31:00.000Z"),
    limit: 25,
    leaseSeconds: 300,
  });

  // Then
  assert.deepEqual(result, { kind: "unavailable", reason: "invalid_claim_response" });
});

test("finishes only the occurrence held by the supplied claim token", async () => {
  // Given
  const calls: Array<{ readonly name: string; readonly args: Readonly<Record<string, unknown>> }> = [];
  const rpc: WorkflowSchedulerRpc = {
    rpc: (name, args) => {
      calls.push({ name, args });
      return Promise.resolve({ data: true, error: null });
    },
  };

  // When
  const result = await finishWorkflowOccurrence(rpc, {
    occurrenceId: OCCURRENCE_ID,
    claimToken: CLAIM_TOKEN,
    outcome: "completed",
  });

  // Then
  assert.deepEqual(result, { kind: "finished" });
  assert.deepEqual(calls, [{
    name: "finish_automation_workflow_occurrence",
    args: {
      p_occurrence_id: OCCURRENCE_ID,
      p_claim_token: CLAIM_TOKEN,
      p_outcome: "completed",
      p_error: null,
    },
  }]);
});

test("reports a lost lease when completion no longer owns the claim", async () => {
  // Given
  const rpc: WorkflowSchedulerRpc = {
    rpc: () => Promise.resolve({ data: false, error: null }),
  };

  // When
  const result = await finishWorkflowOccurrence(rpc, {
    occurrenceId: OCCURRENCE_ID,
    claimToken: CLAIM_TOKEN,
    outcome: "failed",
    error: "fixture failure",
  });

  // Then
  assert.deepEqual(result, { kind: "lost_claim" });
});
