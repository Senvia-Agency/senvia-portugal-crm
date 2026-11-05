import type { WorkflowRecord } from "../_shared/automation-workflow-contract.ts";
import { deterministicUuid } from "../_shared/agency-automations.ts";

export type ConfiguredRunRefresh = {
  readonly context: Record<string, unknown>;
  readonly contactName: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
};

export function refreshConfiguredRun(
  context: Readonly<Record<string, unknown>>,
  record: WorkflowRecord,
): ConfiguredRunRefresh {
  return {
    context: { ...context, ...record.fields },
    contactName: record.contact?.name ?? null,
    contactEmail: record.contact?.email ?? null,
    contactPhone: record.contact?.phone ?? null,
  };
}

export async function configuredRecordSubjectId(
  organizationId: string,
  record: WorkflowRecord,
): Promise<string | null> {
  if (record.entity === "receivables") {
    return deterministicUuid(`configured-receivable-subject:${organizationId}:${record.id}`);
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.id)
    ? record.id : null;
}
