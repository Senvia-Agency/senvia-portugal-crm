import assert from "node:assert/strict";
import test from "node:test";

import { configuredRecordSubjectId, refreshConfiguredRun } from "./configured-workflow-run-state.ts";

test("refreshes contact and financial fields immediately before an action", () => {
  const refreshed = refreshConfiguredRun({
    outstanding_amount: 100,
    __configured_workflow_record_id: "sale_payment:11111111-1111-4111-8111-111111111111",
  }, {
    entity: "receivables",
    id: "sale_payment:11111111-1111-4111-8111-111111111111",
    organizationId: "22222222-2222-4222-8222-222222222222",
    fields: { outstanding_amount: 40, status: "pending" },
    contact: { name: "Atual", email: "atual@example.invalid", phone: "+351900000000" },
  });

  assert.equal(refreshed.context.outstanding_amount, 40);
  assert.equal(refreshed.context.__configured_workflow_record_id,
    "sale_payment:11111111-1111-4111-8111-111111111111");
  assert.deepEqual({
    name: refreshed.contactName,
    email: refreshed.contactEmail,
    phone: refreshed.contactPhone,
  }, {
    name: "Atual",
    email: "atual@example.invalid",
    phone: "+351900000000",
  });
});

test("keeps two receivables from the same sale as distinct active subjects", async () => {
  const organizationId = "22222222-2222-4222-8222-222222222222";
  const base = {
    entity: "receivables" as const,
    organizationId,
    fields: { sale_id: "33333333-3333-4333-8333-333333333333" },
  };
  const first = await configuredRecordSubjectId(organizationId, {
    ...base, id: "sale_payment:44444444-4444-4444-8444-444444444444",
  });
  const second = await configuredRecordSubjectId(organizationId, {
    ...base, id: "sale_payment:55555555-5555-4555-8555-555555555555",
  });
  assert.match(first ?? "", /^[0-9a-f-]{36}$/);
  assert.match(second ?? "", /^[0-9a-f-]{36}$/);
  assert.notEqual(first, second);
});
