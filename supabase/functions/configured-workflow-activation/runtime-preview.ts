import { NATIVE_AUTOMATION_TRIGGERS } from "../otto/lib/generic-automation-schema.ts";
import {
  type AutomationFlowRow,
  type NativeAutomationFlow,
  nativeFlowState,
} from "../otto/lib/generic-automation-store.ts";
import { validateNativeAutomationGraph } from "../otto/lib/generic-automation-validation.ts";
import { validateAutomationReferences } from "../otto/lib/generic-automation-references.ts";
import { buildAutomationActivationSnapshot } from "../otto/lib/generic-automation-activation-preview.ts";
import type { ToolContext } from "../otto/lib/types.ts";
import type { PreviewSnapshot } from "./contract.ts";

export type RuntimeCandidate = {
  readonly ctx: ToolContext;
  readonly flow: AutomationFlowRow;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const ALL_NATIVE_TRIGGERS: ReadonlySet<
  (typeof NATIVE_AUTOMATION_TRIGGERS)[number]
> = new Set(NATIVE_AUTOMATION_TRIGGERS);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nativeCandidate(
  candidate: RuntimeCandidate,
): NativeAutomationFlow | null {
  const state = nativeFlowState(candidate.flow);
  return state.native ? state.flow : null;
}

export async function prepareRuntimeSnapshot(
  candidate: RuntimeCandidate,
): Promise<
  | { readonly ok: true; readonly snapshot: PreviewSnapshot }
  | {
    readonly ok: false;
    readonly reason:
      | "graph_invalid"
      | "preview_unavailable"
      | "database_unavailable";
  }
> {
  const flow = nativeCandidate(candidate);
  if (!flow || flow.trigger_type !== "configured_workflow") {
    return { ok: false, reason: "graph_invalid" };
  }
  const validation = validateNativeAutomationGraph(flow.graph, {
    entryNodeId: flow.entry_node_id,
    allowedEntryTriggers: ALL_NATIVE_TRIGGERS,
    requireComplete: true,
  });
  if (!validation.ok) return { ok: false, reason: "graph_invalid" };
  const referenceFailure = await validateAutomationReferences(
    candidate.ctx,
    validation.graph,
    flow.folder_id,
  );
  if (referenceFailure) return { ok: false, reason: "preview_unavailable" };
  const built = await buildAutomationActivationSnapshot(candidate.ctx, flow);
  if (
    !built.ok || !built.configuredWorkflowPreview ||
    !DIGEST_PATTERN.test(built.digest)
  ) {
    return { ok: false, reason: "preview_unavailable" };
  }
  const preview = built.configuredWorkflowPreview;
  return {
    ok: true,
    snapshot: {
      digest: built.digest,
      scannedRecords: preview.scannedRecords,
      eligibleRecords: preview.eligibleRecords,
      eligibleStages: preview.eligibleStages,
      observedLocalDate: preview.observedLocalDate,
      timeZone: preview.timeZone,
      stages: preview.stages,
    },
  };
}

export async function recordRuntimeProof(
  candidate: RuntimeCandidate,
  snapshot: PreviewSnapshot,
): Promise<
  | {
    readonly ok: true;
    readonly previewId: string;
    readonly expiresAt: string;
  }
  | {
    readonly ok: false;
    readonly reason: "preview_unavailable" | "database_unavailable";
  }
> {
  const flow = nativeCandidate(candidate);
  if (!flow || flow.trigger_type !== "configured_workflow") {
    return { ok: false, reason: "preview_unavailable" };
  }
  const result = await candidate.ctx.supabaseAdmin.rpc(
    "record_configured_workflow_activation_preview",
    {
      p_flow_id: flow.id,
      p_previewed_by: candidate.ctx.userId,
      p_snapshot_digest: snapshot.digest,
      p_scanned_records: snapshot.scannedRecords,
      p_eligible_records: snapshot.eligibleRecords,
      p_eligible_stages: snapshot.eligibleStages,
      p_stage_counts: snapshot.stages,
      p_observed_local_date: snapshot.observedLocalDate,
      p_time_zone: snapshot.timeZone,
    },
  );
  const rows: unknown = result.data;
  if (result.error) return { ok: false, reason: "preview_unavailable" };
  if (!Array.isArray(rows) || rows.length !== 1 || !isRecord(rows[0])) {
    return { ok: false, reason: "database_unavailable" };
  }
  const row = rows[0];
  if (
    typeof row.preview_id !== "string" || !UUID_PATTERN.test(row.preview_id) ||
    typeof row.expires_at !== "string" ||
    !Number.isFinite(Date.parse(row.expires_at))
  ) {
    return { ok: false, reason: "database_unavailable" };
  }
  return { ok: true, previewId: row.preview_id, expiresAt: row.expires_at };
}
