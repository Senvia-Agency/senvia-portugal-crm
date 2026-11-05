import assert from "node:assert/strict";
import test from "node:test";

import {
  claimConfiguredWorkflowStage,
  finishConfiguredWorkflowStage,
  type ConfiguredStageClaimRpc,
} from "./configured-workflow-stage-claims.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const FLOW_ID = "22222222-2222-4222-8222-222222222222";
const EXECUTION_ID = "33333333-3333-4333-8333-333333333333";
const CLAIM_TOKEN = "44444444-4444-4444-8444-444444444444";

test("claims a configured stage with its tenant and cadence identity", async () => {
  const calls: Array<Readonly<{ name: string; args: Readonly<Record<string, unknown>> }>> = [];
  const rpc: ConfiguredStageClaimRpc = { rpc: (name, args) => {
    calls.push({ name, args });
    return Promise.resolve({ data: [{ execution_id: EXECUTION_ID, claim_token: CLAIM_TOKEN }], error: null });
  } };

  const result = await claimConfiguredWorkflowStage(rpc, {
    organizationId: ORGANIZATION_ID,
    flowId: FLOW_ID,
    flowVersion: 3,
    entity: "clients",
    recordId: "55555555-5555-4555-8555-555555555555",
    stageId: "welcome",
    cadence: { mode: "interval_days", days: 7 },
    occurrenceKey: "2026-11-04",
    localDate: "2026-11-04",
    leaseSeconds: 300,
  });

  assert.deepEqual(result, { kind: "claimed", claim: { executionId: EXECUTION_ID, claimToken: CLAIM_TOKEN } });
  assert.equal(calls[0]?.name, "claim_automation_workflow_stage_execution");
  assert.deepEqual(calls[0]?.args, {
    p_organization_id: ORGANIZATION_ID,
    p_flow_id: FLOW_ID,
    p_flow_version: 3,
    p_entity_type: "clients",
    p_record_id: "55555555-5555-4555-8555-555555555555",
    p_stage_id: "welcome",
    p_cadence_mode: "interval_days",
    p_cadence_days: 7,
    p_occurrence_key: "2026-11-04",
    p_local_date: "2026-11-04",
    p_lease_seconds: 300,
  });
});

test("reports a cadence block without manufacturing a claim", async () => {
  const rpc: ConfiguredStageClaimRpc = { rpc: () => Promise.resolve({ data: [], error: null }) };
  const result = await claimConfiguredWorkflowStage(rpc, {
    organizationId: ORGANIZATION_ID, flowId: FLOW_ID, flowVersion: 1,
    entity: "clients", recordId: EXECUTION_ID, stageId: "welcome",
    cadence: { mode: "once" }, occurrenceKey: "manual:fixture",
    localDate: "2026-11-04", leaseSeconds: 300,
  });
  assert.deepEqual(result, { kind: "blocked" });
});

test("finishes only the stage execution held by the supplied token", async () => {
  const rpc: ConfiguredStageClaimRpc = { rpc: () => Promise.resolve({ data: true, error: null }) };
  const result = await finishConfiguredWorkflowStage(rpc, {
    executionId: EXECUTION_ID, claimToken: CLAIM_TOKEN, outcome: "unknown", error: "effect outcome unknown",
  });
  assert.deepEqual(result, { kind: "finished" });
});

test("fails closed on malformed claim responses", async () => {
  const rpc: ConfiguredStageClaimRpc = { rpc: () => Promise.resolve({ data: [{ execution_id: EXECUTION_ID }], error: null }) };
  const result = await claimConfiguredWorkflowStage(rpc, {
    organizationId: ORGANIZATION_ID, flowId: FLOW_ID, flowVersion: 1,
    entity: "clients", recordId: EXECUTION_ID, stageId: "welcome",
    cadence: { mode: "once" }, occurrenceKey: "manual:fixture",
    localDate: "2026-11-04", leaseSeconds: 300,
  });
  assert.deepEqual(result, { kind: "unavailable", reason: "invalid_response" });
});
