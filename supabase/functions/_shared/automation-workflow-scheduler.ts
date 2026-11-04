export type WorkflowSchedulerRpcResponse = {
  readonly data: unknown;
  readonly error: { readonly message?: string } | null;
};

export interface WorkflowSchedulerRpc {
  rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): PromiseLike<WorkflowSchedulerRpcResponse>;
}

export type WorkflowOccurrenceClaim = {
  readonly occurrenceId: string;
  readonly organizationId: string;
  readonly flowId: string;
  readonly flowVersion: number;
  readonly localDate: string;
  readonly scheduledFor: string;
  readonly claimToken: string;
  readonly leaseUntil: string;
};

export type ClaimWorkflowOccurrencesResult =
  | { readonly kind: "claimed"; readonly occurrences: readonly WorkflowOccurrenceClaim[] }
  | { readonly kind: "unavailable"; readonly reason: "database_error" | "invalid_claim_response" };

export type FinishWorkflowOccurrenceResult =
  | { readonly kind: "finished" }
  | { readonly kind: "lost_claim" }
  | { readonly kind: "unavailable"; readonly reason: "database_error" | "invalid_finish_response" };

type ClaimWorkflowOccurrencesInput = {
  readonly now: Date;
  readonly limit: number;
  readonly leaseSeconds: number;
};

type FinishWorkflowOccurrenceInput = {
  readonly occurrenceId: string;
  readonly claimToken: string;
  readonly outcome: "completed" | "failed";
  readonly error?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function isoInstant(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function occurrenceClaim(value: unknown): WorkflowOccurrenceClaim | null {
  const row = record(value);
  if (!row
    || typeof row.occurrence_id !== "string" || !UUID.test(row.occurrence_id)
    || typeof row.organization_id !== "string" || !UUID.test(row.organization_id)
    || typeof row.flow_id !== "string" || !UUID.test(row.flow_id)
    || typeof row.flow_version !== "number" || !Number.isInteger(row.flow_version) || row.flow_version < 1
    || typeof row.local_date !== "string" || !ISO_DATE.test(row.local_date)
    || typeof row.claim_token !== "string" || !UUID.test(row.claim_token)) return null;
  const scheduledFor = isoInstant(row.scheduled_for);
  const leaseUntil = isoInstant(row.lease_until);
  if (!scheduledFor || !leaseUntil) return null;
  return {
    occurrenceId: row.occurrence_id,
    organizationId: row.organization_id,
    flowId: row.flow_id,
    flowVersion: row.flow_version,
    localDate: row.local_date,
    scheduledFor,
    claimToken: row.claim_token,
    leaseUntil,
  };
}

export async function claimDueWorkflowOccurrences(
  client: WorkflowSchedulerRpc,
  input: ClaimWorkflowOccurrencesInput,
): Promise<ClaimWorkflowOccurrencesResult> {
  const response = await client.rpc("claim_due_automation_workflow_occurrences", {
    p_now: input.now.toISOString(),
    p_limit: input.limit,
    p_lease_seconds: input.leaseSeconds,
  });
  if (response.error) return { kind: "unavailable", reason: "database_error" };
  if (!Array.isArray(response.data)) return { kind: "unavailable", reason: "invalid_claim_response" };
  const claims = response.data.map(occurrenceClaim);
  if (claims.some((claim) => claim === null)) {
    return { kind: "unavailable", reason: "invalid_claim_response" };
  }
  return {
    kind: "claimed",
    occurrences: claims.filter((claim): claim is WorkflowOccurrenceClaim => claim !== null),
  };
}

export async function finishWorkflowOccurrence(
  client: WorkflowSchedulerRpc,
  input: FinishWorkflowOccurrenceInput,
): Promise<FinishWorkflowOccurrenceResult> {
  const response = await client.rpc("finish_automation_workflow_occurrence", {
    p_occurrence_id: input.occurrenceId,
    p_claim_token: input.claimToken,
    p_outcome: input.outcome,
    p_error: input.error ?? null,
  });
  if (response.error) return { kind: "unavailable", reason: "database_error" };
  if (typeof response.data !== "boolean") {
    return { kind: "unavailable", reason: "invalid_finish_response" };
  }
  return response.data ? { kind: "finished" } : { kind: "lost_claim" };
}
