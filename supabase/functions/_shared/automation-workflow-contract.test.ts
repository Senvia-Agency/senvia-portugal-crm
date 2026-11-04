import { describe, expect, test } from "bun:test";
import {
  evaluateWorkflowConditions,
  parseAutomationWorkflowDefinition,
  parseAutomationWorkflowDraft,
  parseWorkflowAccessScope,
  parseWorkflowQuery,
  parseWorkflowRecord,
  validateWorkflowStageNodeReferences,
} from "./automation-workflow-contract.ts";

const query = {
  entity: "receivables",
  select: ["due_date", "status", "outstanding_amount"],
  filters: [{ field: "status", operator: "equals", value: "pending" }],
};
const complete = {
  schemaVersion: 1,
  trigger: { kind: "daily_schedule", localTime: "09:30", timeZone: "Europe/Lisbon" },
  query,
  stages: [{
    id: "late-15",
    nodeId: "send-reminder",
    conditions: [{ field: "due_date", operator: "before", value: { kind: "today_offset_days", days: -15 } }],
  }],
};

describe("automation workflow contract", () => {
  test("separates editable drafts from executable definitions", () => {
    expect(parseAutomationWorkflowDraft({ ...complete, stages: [] }).ok).toBe(true);
    expect(parseAutomationWorkflowDefinition({ ...complete, stages: [] }).ok).toBe(false);
    const parsed = parseAutomationWorkflowDefinition(complete);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.stages[0]?.cadence).toEqual({ mode: "once" });
  });

  test("accepts only declared triggers and valid IANA schedules", () => {
    expect(parseAutomationWorkflowDefinition({ ...complete, trigger: { kind: "native_event", event: "lead_created" } }).ok).toBe(true);
    expect(parseAutomationWorkflowDefinition({ ...complete, trigger: { kind: "authenticated_manual" } }).ok).toBe(true);
    expect(parseAutomationWorkflowDefinition({ ...complete, trigger: { kind: "native_event", event: "invented_event" } }).ok).toBe(false);
    expect(parseAutomationWorkflowDefinition({ ...complete, trigger: { kind: "daily_schedule", localTime: "09:30", timeZone: "Mars/Olympus" } }).ok).toBe(false);
  });

  test("rejects unsafe fields, operators and hidden filter projections", () => {
    expect(parseWorkflowQuery({ ...query, select: ["unknown"] }).ok).toBe(false);
    expect(parseWorkflowQuery({ ...query, filters: [{ field: "due_date", operator: "contains", value: "2026" }] }).ok).toBe(false);
    expect(parseWorkflowQuery({ ...query, select: ["due_date", "outstanding_amount"] }).ok).toBe(false);
  });

  test("validates injected organization scope and graph references", () => {
    expect(parseWorkflowAccessScope({ organizationId: "22222222-2222-4222-8222-222222222222", ownerIds: ["11111111-1111-4111-8111-111111111111"] }).ok).toBe(true);
    expect(parseWorkflowAccessScope({ ownerIds: [] }).ok).toBe(false);
    const parsed = parseAutomationWorkflowDefinition(complete);
    if (!parsed.ok) throw new Error("fixture must parse");
    expect(validateWorkflowStageNodeReferences(parsed.value, new Set(["send-reminder"]))).toEqual([]);
    expect(validateWorkflowStageNodeReferences(parsed.value, new Set())).toHaveLength(1);
  });

  test("evaluates relative dates against a deterministic clock", () => {
    const parsedDefinition = parseAutomationWorkflowDefinition(complete);
    const parsedRecord = parseWorkflowRecord({
      entity: "receivables",
      id: "sale_payment:33333333-3333-4333-8333-333333333333",
      organizationId: "22222222-2222-4222-8222-222222222222",
      fields: { due_date: "2026-10-19", status: "pending", outstanding_amount: 50 },
    });
    if (!parsedDefinition.ok || !parsedRecord.ok) throw new Error("fixtures must parse");
    const conditions = parsedDefinition.value.stages[0]?.conditions ?? [];
    expect(evaluateWorkflowConditions(parsedRecord.value, conditions, { todayIso: "2026-11-04", timeZone: "Europe/Lisbon" })).toBe(true);
    expect(evaluateWorkflowConditions(parsedRecord.value, conditions, { todayIso: "2026-11-03", timeZone: "Europe/Lisbon" })).toBe(false);
  });

  test("distinguishes date-only and timestamp fields", () => {
    expect(parseWorkflowRecord({ entity: "clients", id: "33333333-3333-4333-8333-333333333333", organizationId: "22222222-2222-4222-8222-222222222222", fields: { created_at: "2026-11-04T09:30:00+00:00" } }).ok).toBe(true);
    expect(parseWorkflowRecord({ entity: "clients", id: "33333333-3333-4333-8333-333333333333", organizationId: "22222222-2222-4222-8222-222222222222", fields: { created_at: "2026-11-04" } }).ok).toBe(false);
  });

  test("compares a timestamp with the tenant civil day", () => {
    const record = parseWorkflowRecord({ entity: "clients", id: "33333333-3333-4333-8333-333333333333", organizationId: "22222222-2222-4222-8222-222222222222", fields: { created_at: "2026-11-04T00:30:00Z" } });
    if (!record.ok) throw new Error("fixture must parse");
    const condition = [{ field: "created_at", operator: "before", value: "2026-11-04" }] as const;
    expect(evaluateWorkflowConditions(record.value, condition, { todayIso: "2026-11-04", timeZone: "America/New_York" })).toBe(true);
    expect(evaluateWorkflowConditions(record.value, condition, { todayIso: "2026-11-04", timeZone: "UTC" })).toBe(false);
  });
});
