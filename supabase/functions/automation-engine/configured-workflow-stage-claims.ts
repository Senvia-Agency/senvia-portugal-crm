export interface ConfiguredStageClaimRpc {
  rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): PromiseLike<{ readonly data: unknown; readonly error: { readonly message?: string } | null }>;
}

export type ConfiguredStageClaim = {
  readonly executionId: string;
  readonly claimToken: string;
};

export type ClaimConfiguredStageResult =
  | { readonly kind: "claimed"; readonly claim: ConfiguredStageClaim }
  | { readonly kind: "blocked" }
  | { readonly kind: "unavailable"; readonly reason: "database_error" | "invalid_response" };

export type FinishConfiguredStageResult =
  | { readonly kind: "finished" }
  | { readonly kind: "lost_claim" }
  | { readonly kind: "unavailable"; readonly reason: "database_error" | "invalid_response" };

export type ClaimConfiguredStageInput = {
  readonly organizationId: string;
  readonly flowId: string;
  readonly flowVersion: number;
  readonly entity: string;
  readonly recordId: string;
  readonly stageId: string;
  readonly cadence: Readonly<{ mode: "once" | "per_run" | "interval_days"; days?: number }>;
  readonly occurrenceKey: string;
  readonly localDate: string;
  readonly leaseSeconds: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseClaim(value: unknown): ConfiguredStageClaim | null {
  if (!Array.isArray(value) || value.length > 1) return null;
  if (value.length === 0) return null;
  const row = value[0];
  if (typeof row !== "object" || row === null || Array.isArray(row)) return null;
  const record = row as Readonly<Record<string, unknown>>;
  return typeof record.execution_id === "string" && UUID.test(record.execution_id)
      && typeof record.claim_token === "string" && UUID.test(record.claim_token)
    ? { executionId: record.execution_id, claimToken: record.claim_token }
    : null;
}

export async function claimConfiguredWorkflowStage(
  client: ConfiguredStageClaimRpc,
  input: ClaimConfiguredStageInput,
): Promise<ClaimConfiguredStageResult> {
  const response = await client.rpc("claim_automation_workflow_stage_execution", {
    p_organization_id: input.organizationId,
    p_flow_id: input.flowId,
    p_flow_version: input.flowVersion,
    p_entity_type: input.entity,
    p_record_id: input.recordId,
    p_stage_id: input.stageId,
    p_cadence_mode: input.cadence.mode,
    p_cadence_days: input.cadence.mode === "interval_days" ? input.cadence.days ?? null : null,
    p_occurrence_key: input.occurrenceKey,
    p_local_date: input.localDate,
    p_lease_seconds: input.leaseSeconds,
  });
  if (response.error) return { kind: "unavailable", reason: "database_error" };
  if (Array.isArray(response.data) && response.data.length === 0) return { kind: "blocked" };
  const claim = parseClaim(response.data);
  return claim ? { kind: "claimed", claim } : { kind: "unavailable", reason: "invalid_response" };
}

export async function finishConfiguredWorkflowStage(
  client: ConfiguredStageClaimRpc,
  input: Readonly<{
    executionId: string;
    claimToken: string;
    outcome: "succeeded" | "failed" | "unknown";
    runId?: string;
    error?: string;
  }>,
): Promise<FinishConfiguredStageResult> {
  const response = await client.rpc("finish_automation_workflow_stage_execution", {
    p_execution_id: input.executionId,
    p_claim_token: input.claimToken,
    p_outcome: input.outcome,
    p_run_id: input.runId ?? null,
    p_error: input.error ?? null,
  });
  if (response.error) return { kind: "unavailable", reason: "database_error" };
  if (typeof response.data !== "boolean") return { kind: "unavailable", reason: "invalid_response" };
  return response.data ? { kind: "finished" } : { kind: "lost_claim" };
}
