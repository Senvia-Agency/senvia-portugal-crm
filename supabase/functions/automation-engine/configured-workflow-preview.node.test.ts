import assert from "node:assert/strict";
import test from "node:test";

import type {
  AutomationWorkflowDefinition,
  WorkflowPage,
  WorkflowRecord,
} from "../_shared/automation-workflow-contract.ts";
import {
  estimateConfiguredWorkflowPreview,
  type ConfiguredWorkflowPreviewReadAttempts,
  type ConfiguredWorkflowPreviewReadPage,
} from "./configured-workflow-preview.ts";

const organizationId = "22222222-2222-4222-8222-222222222222";
const scope = { organizationId } as const;
const definition: AutomationWorkflowDefinition = {
  schemaVersion: 1,
  trigger: { kind: "daily_schedule", localTime: "09:00", timeZone: "Europe/Lisbon" },
  query: {
    entity: "receivables",
    select: ["due_date", "status", "outstanding_amount"],
    filters: [{ field: "status", operator: "equals", value: "pending" }],
    pageSize: 2,
  },
  stages: [
    {
      id: "email-10",
      nodeId: "send-email",
      conditions: [{
        field: "due_date",
        operator: "before",
        value: { kind: "today_offset_days", days: -10 },
      }],
      cadence: { mode: "once" },
    },
    {
      id: "whatsapp-15",
      nodeId: "send-whatsapp",
      conditions: [{
        field: "due_date",
        operator: "before",
        value: { kind: "today_offset_days", days: -15 },
      }],
      cadence: { mode: "once" },
    },
  ],
};
const entryNode = { id: "entry", type: "configured_workflow", config: {} } as const;
const emailNode = { id: "send-email", type: "send_email", config: {} } as const;
const whatsappNode = { id: "send-whatsapp", type: "send_whatsapp", config: {} } as const;
const graphNodes = [entryNode, emailNode, whatsappNode] as const;
const graphEdges = [
  { id: "entry-email", source: "entry", target: "send-email" },
  { id: "entry-whatsapp", source: "entry", target: "send-whatsapp" },
] as const;

function receivable(id: string, dueDate: string, status = "pending"): WorkflowRecord {
  return {
    entity: "receivables",
    id: `sale_payment:${id}`,
    organizationId,
    fields: { due_date: dueDate, status, outstanding_amount: 50 },
  };
}

function input(
  readPage: ConfiguredWorkflowPreviewReadPage,
  readAttempts: ConfiguredWorkflowPreviewReadAttempts = async () => [],
) {
  return {
    definition,
    graphNodes,
    graphEdges,
    entryNodeId: "entry",
    scope,
    authorization: {
      organizationId,
      isAdmin: true,
      dataScope: "all" as const,
      readableEntities: ["receivables"] as const,
    },
    occurrenceKey: "preview:flow-a:5:2026-11-04",
    occurrenceLocalDate: "2026-11-04",
    timeZone: "Europe/Lisbon",
    readPage,
    readAttempts,
  } as const;
}

test("counts every eligible stage across complete pages", async () => {
  // Given two pages with one very old debt, one recent debt and one paid debt.
  const first = receivable("11111111-1111-4111-8111-111111111111", "2026-10-01");
  const recent = receivable("33333333-3333-4333-8333-333333333333", "2026-11-01");
  const paid = receivable("44444444-4444-4444-8444-444444444444", "2026-10-01", "paid");
  const readPage: ConfiguredWorkflowPreviewReadPage = async ({ cursor }) => cursor === undefined
    ? { records: [first, recent], nextCursor: "page-2" }
    : { records: [paid], nextCursor: null };

  // When a read-only preview is estimated.
  const result = await estimateConfiguredWorkflowPreview(input(readPage));

  // Then every page is scanned and only the two matching stages are counted.
  assert.deepEqual(result, {
    ok: true,
    complete: true,
    scannedRecords: 3,
    eligibleRecords: 1,
    eligibleStages: 2,
    recordsWithImmediateActions: 1,
    recordsWithDeferredActions: 0,
    certainty: "exact",
    limitations: [],
    stages: [
      {
        stageId: "email-10", nodeId: "send-email", eligibleRecords: 1,
        immediateRecords: 1, deferredRecords: 0,
      },
      {
        stageId: "whatsapp-15", nodeId: "send-whatsapp", eligibleRecords: 1,
        immediateRecords: 1, deferredRecords: 0,
      },
    ],
    observedLocalDate: "2026-11-04",
    timeZone: "Europe/Lisbon",
    requiresRevalidation: true,
  });
});

test("keeps once-only stages blocked by attempts from an earlier flow version", async () => {
  // Given an organization-wide preview and a version-four attempt for a version-five flow.
  const record = receivable("11111111-1111-4111-8111-111111111111", "2026-10-01");
  const readPage: ConfiguredWorkflowPreviewReadPage = async () => ({ records: [record], nextCursor: null });
  const readAttempts: ConfiguredWorkflowPreviewReadAttempts = async () => [{
    stageId: "email-10",
    occurrenceKey: "preview:flow-a:4:2026-11-03",
    localDate: "2026-11-03",
    status: "unknown",
  }];

  // When the preview is estimated.
  const result = await estimateConfiguredWorkflowPreview(input(readPage, readAttempts));

  // Then editing or reactivating the flow does not restart that once-only stage.
  assert.equal(result.ok ? result.eligibleStages : null, 1);
  assert.deepEqual(result.ok ? result.stages : null, [
    {
      stageId: "email-10", nodeId: "send-email", eligibleRecords: 0,
      immediateRecords: 0, deferredRecords: 0,
    },
    {
      stageId: "whatsapp-15", nodeId: "send-whatsapp", eligibleRecords: 1,
      immediateRecords: 1, deferredRecords: 0,
    },
  ]);
});

test("rejects non-admin and restricted-scope previews before reading data", async () => {
  // Given a reader that must not run without runtime-equivalent authorization.
  let reads = 0;
  const readPage: ConfiguredWorkflowPreviewReadPage = async () => {
    reads += 1;
    return { records: [], nextCursor: null };
  };

  // When a non-admin or owner-scoped actor requests a preview.
  const nonAdmin = await estimateConfiguredWorkflowPreview({
    ...input(readPage),
    authorization: { ...input(readPage).authorization, isAdmin: false },
  });
  const teamScoped = await estimateConfiguredWorkflowPreview({
    ...input(readPage),
    authorization: { ...input(readPage).authorization, dataScope: "team" },
  });
  const ownerScoped = await estimateConfiguredWorkflowPreview({
    ...input(readPage),
    scope: { organizationId, ownerIds: ["55555555-5555-4555-8555-555555555555"] },
  });

  // Then both fail closed before any organization data is queried.
  assert.deepEqual(nonAdmin, { ok: false, complete: false, reason: "not_authorized" });
  assert.deepEqual(teamScoped, { ok: false, complete: false, reason: "not_authorized" });
  assert.deepEqual(ownerScoped, { ok: false, complete: false, reason: "not_authorized" });
  assert.equal(reads, 0);
});

test("rejects unauthorized entities before reading data", async () => {
  // Given authorization that excludes the workflow entity.
  let read = false;
  const readPage: ConfiguredWorkflowPreviewReadPage = async () => {
    read = true;
    return { records: [], nextCursor: null };
  };

  // When the preview is requested.
  const result = await estimateConfiguredWorkflowPreview({
    ...input(readPage),
    authorization: {
      organizationId,
      isAdmin: true,
      dataScope: "all",
      readableEntities: ["clients"],
    },
  });

  // Then it fails before touching the reader.
  assert.deepEqual(result, { ok: false, complete: false, reason: "not_authorized" });
  assert.equal(read, false);
});

test("rejects invalid action nodes even when no records exist", async () => {
  // Given a stage that resolves to a non-action entry node.
  const readPage: ConfiguredWorkflowPreviewReadPage = async () => ({ records: [], nextCursor: null });

  // When the preview is requested.
  const result = await estimateConfiguredWorkflowPreview({
    ...input(readPage),
    graphNodes: [entryNode, { id: "send-email", type: "configured_workflow", config: {} }, whatsappNode],
  });
  const interactiveWhatsapp = await estimateConfiguredWorkflowPreview({
    ...input(readPage),
    graphNodes: [entryNode, emailNode, {
      id: "send-whatsapp",
      type: "send_whatsapp",
      config: { wait_reply: true },
    }],
  });

  // Then activation is blocked without depending on matching records.
  assert.deepEqual(result, { ok: false, complete: false, reason: "invalid_action_node" });
  assert.deepEqual(interactiveWhatsapp, { ok: false, complete: false, reason: "invalid_action_node" });
});

test("counts only the currently selected condition branch", async () => {
  // Given one qualifying record and a native condition with actions on both branches.
  const record = receivable("11111111-1111-4111-8111-111111111111", "2026-10-01");
  const readPage: ConfiguredWorkflowPreviewReadPage = async () => ({ records: [record], nextCursor: null });
  const edges = [
    { id: "entry-condition", source: "entry", target: "condition" },
    { id: "yes", source: "condition", target: "send-email", branch: "yes" },
    { id: "no", source: "condition", target: "send-whatsapp", branch: "no" },
  ] as const;
  const nodes = (value: string) => [
    entryNode,
    { id: "condition", type: "condition", config: { field: "status", operator: "equals", value } },
    emailNode,
    whatsappNode,
  ] as const;

  // When the current value selects first the yes branch and then the no branch.
  const yes = await estimateConfiguredWorkflowPreview({
    ...input(readPage), graphNodes: nodes("pending"), graphEdges: edges,
  });
  const no = await estimateConfiguredWorkflowPreview({
    ...input(readPage), graphNodes: nodes("paid"), graphEdges: edges,
  });

  // Then each preview counts only its reachable action, never both branch actions.
  assert.deepEqual(yes.ok ? yes.stages.map(({ eligibleRecords }) => eligibleRecords) : null, [1, 0]);
  assert.deepEqual(no.ok ? no.stages.map(({ eligibleRecords }) => eligibleRecords) : null, [0, 1]);
});

test("treats every supported branch after a wait as a deferred upper bound", async () => {
  // Given a wait followed by a condition that is false now but may change before resume.
  const record = receivable("11111111-1111-4111-8111-111111111111", "2026-10-01");
  const readPage: ConfiguredWorkflowPreviewReadPage = async () => ({ records: [record], nextCursor: null });

  // When the preview traverses the graph.
  const result = await estimateConfiguredWorkflowPreview({
    ...input(readPage),
    graphNodes: [
      entryNode,
      { id: "wait", type: "wait", config: { amount: 1, unit: "days" } },
      { id: "condition", type: "condition", config: { field: "status", operator: "equals", value: "paid" } },
      emailNode,
      whatsappNode,
    ],
    graphEdges: [
      { id: "entry-wait", source: "entry", target: "wait" },
      { id: "wait-condition", source: "wait", target: "condition" },
      { id: "yes-email", source: "condition", target: "send-email", branch: "yes" },
      { id: "no-whatsapp", source: "condition", target: "send-whatsapp", branch: "no" },
    ],
  });

  // Then both future branches are upper bounds and neither is claimed immediate.
  assert.equal(result.ok ? result.certainty : null, "upper_bound");
  assert.equal(result.ok ? result.recordsWithImmediateActions : null, 0);
  assert.equal(result.ok ? result.recordsWithDeferredActions : null, 1);
  assert.deepEqual(result.ok ? result.stages[0] : null, {
    stageId: "email-10", nodeId: "send-email", eligibleRecords: 1,
    immediateRecords: 0, deferredRecords: 1,
  });
  assert.deepEqual(result.ok ? result.stages[1] : null, {
    stageId: "whatsapp-15", nodeId: "send-whatsapp", eligibleRecords: 1,
    immediateRecords: 0, deferredRecords: 1,
  });
});

test("fails closed when native graph reachability is unknown", async () => {
  // Given a DB-dependent condition and a cyclic path that cannot be quantified locally.
  const record = receivable("11111111-1111-4111-8111-111111111111", "2026-10-01");
  const readPage: ConfiguredWorkflowPreviewReadPage = async () => ({ records: [record], nextCursor: null });
  const databaseCondition = await estimateConfiguredWorkflowPreview({
    ...input(readPage),
    graphNodes: [
      entryNode,
      { id: "wait", type: "wait", config: { amount: 1, unit: "days" } },
      { id: "condition", type: "condition", config: { field: "email", operator: "in_crm", value: null } },
      emailNode,
      whatsappNode,
    ],
    graphEdges: [
      { id: "entry-wait", source: "entry", target: "wait" },
      { id: "wait-condition", source: "wait", target: "condition" },
      { id: "yes", source: "condition", target: "send-email", branch: "yes" },
      { id: "no", source: "condition", target: "send-whatsapp", branch: "no" },
    ],
  });
  const cyclic = await estimateConfiguredWorkflowPreview({
    ...input(readPage),
    graphNodes: [entryNode, { id: "wait", type: "wait", config: {} }, emailNode, whatsappNode],
    graphEdges: [
      { id: "entry-wait", source: "entry", target: "wait" },
      { id: "wait-entry", source: "wait", target: "entry" },
      { id: "wait-email", source: "wait", target: "send-email" },
    ],
  });

  // Then activation gets no partial or misleading eligible count.
  assert.deepEqual(databaseCondition, {
    ok: false, complete: false, reason: "graph_reachability_unknown",
  });
  assert.deepEqual(cyclic, { ok: false, complete: false, reason: "graph_reachability_unknown" });
});

test("rejects an invalid or mismatched evaluation clock", async () => {
  // Given a valid reader that must not run with an invalid civil clock.
  let read = false;
  const readPage: ConfiguredWorkflowPreviewReadPage = async () => {
    read = true;
    return { records: [], nextCursor: null };
  };

  // When the preview date is invalid and the timezone differs from the schedule.
  const invalidDate = await estimateConfiguredWorkflowPreview({
    ...input(readPage), occurrenceLocalDate: "2026-02-30",
  });
  const mismatchedZone = await estimateConfiguredWorkflowPreview({
    ...input(readPage), timeZone: "UTC",
  });

  // Then both snapshots fail closed before querying data.
  assert.deepEqual(invalidDate, { ok: false, complete: false, reason: "invalid_clock" });
  assert.deepEqual(mismatchedZone, { ok: false, complete: false, reason: "invalid_clock" });
  assert.equal(read, false);
});

test("fails closed when a page crosses the tenant boundary", async () => {
  // Given a page that returns a record from another organization.
  const foreign = { ...receivable("11111111-1111-4111-8111-111111111111", "2026-10-01"),
    organizationId: "66666666-6666-4666-8666-666666666666" };
  const readPage: ConfiguredWorkflowPreviewReadPage = async () => ({ records: [foreign], nextCursor: null });

  // When the preview is requested.
  const result = await estimateConfiguredWorkflowPreview(input(readPage));

  // Then it reports an incomplete snapshot rather than silently skipping the record.
  assert.deepEqual(result, { ok: false, complete: false, reason: "scope_mismatch" });
});

test("fails closed on data and stage-history read errors", async () => {
  // Given downstream reads that fail at each boundary.
  const unavailablePage: ConfiguredWorkflowPreviewReadPage = async () => {
    throw new Error("fixture database failure");
  };
  const record = receivable("11111111-1111-4111-8111-111111111111", "2026-10-01");
  const availablePage: ConfiguredWorkflowPreviewReadPage = async () => ({ records: [record], nextCursor: null });
  const unavailableAttempts: ConfiguredWorkflowPreviewReadAttempts = async () => {
    throw new Error("fixture history failure");
  };

  // When each preview is requested.
  const dataResult = await estimateConfiguredWorkflowPreview(input(unavailablePage));
  const attemptResult = await estimateConfiguredWorkflowPreview(input(availablePage, unavailableAttempts));

  // Then neither failure produces a partial estimate.
  assert.deepEqual(dataResult, { ok: false, complete: false, reason: "data_unavailable" });
  assert.deepEqual(attemptResult, { ok: false, complete: false, reason: "stage_history_unavailable" });
});

test("reports incomplete pagination instead of truncating the estimate", async () => {
  // Given a reader that has another page after the configured safety limit.
  const page: WorkflowPage = { records: [], nextCursor: "next" };
  const readPage: ConfiguredWorkflowPreviewReadPage = async () => page;

  // When the preview reaches the page limit.
  const result = await estimateConfiguredWorkflowPreview({ ...input(readPage), pageLimit: 1 });

  // Then it fails closed and never presents the partial count.
  assert.deepEqual(result, { ok: false, complete: false, reason: "page_limit_exceeded" });
});

test("rejects repeated cursors and duplicate records", async () => {
  // Given pagination that cannot make forward progress.
  const record = receivable("11111111-1111-4111-8111-111111111111", "2026-10-01");
  const repeatedCursor: ConfiguredWorkflowPreviewReadPage = async () => ({ records: [record], nextCursor: "same" });

  // When the same cursor is returned twice.
  const result = await estimateConfiguredWorkflowPreview({ ...input(repeatedCursor), pageLimit: 3 });

  // Then it fails rather than double-counting the record.
  assert.deepEqual(result, { ok: false, complete: false, reason: "pagination_invalid" });
});
