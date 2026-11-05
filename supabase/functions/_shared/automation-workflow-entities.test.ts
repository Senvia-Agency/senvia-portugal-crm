import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { readWorkflowEntityPage, readWorkflowRecord } from "./automation-workflow-entities.ts";

const org = "11111111-1111-4111-8111-111111111111";
const otherOrg = "22222222-2222-4222-8222-222222222222";
const owner = "33333333-3333-4333-8333-333333333333";
const id = "44444444-4444-4444-8444-444444444444";
const secondId = "55555555-5555-4555-8555-555555555555";
const client = { id, organization_id: org, name: "Fixture", email: "fixture@example.invalid", phone: null,
  status: "active", source: "direct", assigned_to: owner, created_at: null, updated_at: null };
const scope = { organizationId: org, ownerIds: [owner] } as const;

Deno.test("entity pages omit other organizations and unowned records", async () => {
  const rows = [client, { ...client, id: secondId, organization_id: otherOrg }, { ...client, id: "66666666-6666-4666-8666-666666666666", assigned_to: null }];
  const page = await readWorkflowEntityPage(async () => rows, scope, { entity: "clients", select: ["name"], pageSize: 10 });
  assertEquals(page.records.map((record) => record.id), [id]);
  assertEquals(page.records[0]?.fields, { name: "Fixture" });
});

Deno.test("entity pagination advances even when a scanned page has no accessible records", async () => {
  const page = await readWorkflowEntityPage(async () => [{ ...client, assigned_to: null }], scope,
    { entity: "clients", select: ["name"], pageSize: 1 });
  assertEquals(page.records, []);
  assertEquals(page.nextCursor, id);
});

Deno.test("entity query rejects unknown fields before database access", async () => {
  let reads = 0;
  await assertRejects(() => readWorkflowEntityPage(async () => { reads++; return []; }, scope,
    { entity: "clients", select: ["nif"], pageSize: 10 }));
  assertEquals(reads, 0);
});

Deno.test("archived leads are not yielded", async () => {
  const page = await readWorkflowEntityPage(async () => [{ ...client, archived_at: "2026-01-01", automation_enabled: true }], scope,
    { entity: "leads", select: ["name"], pageSize: 10 });
  assertEquals(page.records, []);
});

Deno.test("proposal contact and ownership cannot cross organization boundaries", async () => {
  const proposal = { id, organization_id: org, status: "sent", total_value: 50, proposal_date: "2026-01-01",
    created_at: null, updated_at: null, created_by: null, client_id: secondId, lead_id: secondId,
    client: { ...client, id: secondId, organization_id: otherOrg }, lead: { ...client, id: secondId, organization_id: otherOrg } };
  const page = await readWorkflowEntityPage(async () => [proposal], scope, { entity: "proposals", select: ["status"], pageSize: 10 });
  assertEquals(page.records, []);
});

Deno.test("proposal owned through its same-organization lead resolves client recipient", async () => {
  const proposal = { id, organization_id: org, status: "sent", total_value: 50, proposal_date: "2026-01-01",
    created_at: null, updated_at: null, created_by: null, client_id: secondId, lead_id: secondId,
    client: { ...client, id: secondId, name: "Client recipient" }, lead: { ...client, id: secondId } };
  const page = await readWorkflowEntityPage(async () => [proposal], scope, { entity: "proposals", select: ["status"], pageSize: 10 });
  assertEquals(page.records[0]?.contact?.name, "Client recipient");
  assertEquals(page.records[0]?.fields, { status: "sent" });
});

Deno.test("empty owner scope never becomes unrestricted", async () => {
  const page = await readWorkflowEntityPage(async () => [client], { organizationId: org, ownerIds: [] },
    { entity: "clients", select: ["name"], pageSize: 10 });
  assertEquals(page.records, []);
});

Deno.test("lead with automations disabled is excluded", async () => {
  const page = await readWorkflowEntityPage(async () => [{ ...client, archived_at: null, automation_enabled: false }], scope,
    { entity: "leads", select: ["name"], pageSize: 10 });
  assertEquals(page.records, []);
});

Deno.test("timestamp fields retain their instant for the shared calendar evaluator", async () => {
  const page = await readWorkflowEntityPage(async () => [{ ...client, created_at: "2026-01-01T00:30:00Z" }], scope,
    { entity: "clients", select: ["created_at"], pageSize: 10 }, undefined,
    { todayIso: "2026-01-01", timeZone: "America/New_York" });
  assertEquals(page.records[0]?.fields.created_at, "2026-01-01T00:30:00Z");
});

Deno.test("revalidation refuses a record returned for a different requested id", async () => {
  assertEquals(await readWorkflowRecord(async () => [client], scope, "clients", secondId), null);
});

Deno.test("filtered sparse pages still expose the scanned cursor", async () => {
  const page = await readWorkflowEntityPage(async () => [client], scope,
    { entity: "clients", select: ["status"], filters: [{ field: "status", operator: "equals", value: "inactive" }], pageSize: 1 },
    undefined, { todayIso: "2026-01-01", timeZone: "Europe/Lisbon" });
  assertEquals(page.records, []);
  assertEquals(page.nextCursor, id);
});

Deno.test("filtered queries require an explicit calendar before reading", async () => {
  let reads = 0;
  await assertRejects(() => readWorkflowEntityPage(async () => { reads++; return []; }, scope,
    { entity: "clients", select: ["created_at"], filters: [{ field: "created_at", operator: "before", value: { kind: "today_offset_days", days: 0 } }] }));
  assertEquals(reads, 0);
});

Deno.test("datetime filters use the organization civil day", async () => {
  const page = await readWorkflowEntityPage(async () => [{ ...client, created_at: "2026-01-01T00:30:00Z" }], scope,
    { entity: "clients", select: ["created_at"], filters: [{ field: "created_at", operator: "before", value: "2026-01-01" }] },
    undefined, { todayIso: "2026-01-01", timeZone: "America/New_York" });
  assertEquals(page.records.map((record) => record.id), [id]);
});
