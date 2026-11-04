import {
  type AutomationFlowRow,
  loadAutomationFlow,
  parseAutomationFlowRow,
} from "../otto/lib/generic-automation-store.ts";
import { loadContext } from "../otto/lib/context.ts";
import type {
  ActivationEndpointDependencies,
  FlowSummary,
} from "./contract.ts";
import { authenticateRuntimeActor, type RuntimeActor } from "./runtime-auth.ts";
import {
  prepareRuntimeSnapshot,
  recordRuntimeProof,
  type RuntimeCandidate,
} from "./runtime-preview.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flowSummary(flow: AutomationFlowRow): FlowSummary {
  return {
    id: flow.id,
    name: flow.name,
    status: flow.status,
    triggerType: flow.trigger_type,
    version: flow.version,
    updatedAt: flow.updated_at,
  };
}

async function loadCandidate(
  request: Request,
  actor: RuntimeActor,
  flowId: string,
): Promise<
  | {
    readonly ok: true;
    readonly access: {
      readonly organizationId: string;
      readonly isAdmin: boolean;
      readonly dataScope: "own" | "team" | "all";
      readonly automationsEnabled: boolean;
    };
    readonly flow: FlowSummary;
    readonly token: RuntimeCandidate;
  }
  | {
    readonly ok: false;
    readonly reason:
      | "flow_not_found"
      | "admin_required"
      | "module_disabled"
      | "authorization_unavailable"
      | "database_unavailable";
  }
> {
  const anchor = await actor.adminClient.from("automation_flows")
    .select("id,organization_id")
    .eq("id", flowId)
    .maybeSingle();
  if (anchor.error) return { ok: false, reason: "database_unavailable" };
  if (
    !isRecord(anchor.data) ||
    anchor.data.id !== flowId ||
    typeof anchor.data.organization_id !== "string" ||
    !UUID_PATTERN.test(anchor.data.organization_id)
  ) {
    return { ok: false, reason: "flow_not_found" };
  }

  const loadedContext = await loadContext(request, anchor.data.organization_id);
  if (!loadedContext.ctx || loadedContext.userId !== actor.userId) {
    return loadedContext.blockedReason === "membership_unavailable"
      ? { ok: false, reason: "flow_not_found" }
      : { ok: false, reason: "authorization_unavailable" };
  }
  if (!loadedContext.ctx.enabledModules.has("automations")) {
    return { ok: false, reason: "module_disabled" };
  }
  if (!loadedContext.ctx.isAdmin || loadedContext.ctx.dataScope !== "all") {
    return { ok: false, reason: "admin_required" };
  }
  const loadedFlow = await loadAutomationFlow(loadedContext.ctx, flowId);
  if (!loadedFlow.ok) {
    return loadedFlow.result.reason_code === "flow_not_found"
      ? { ok: false, reason: "flow_not_found" }
      : { ok: false, reason: "database_unavailable" };
  }
  return {
    ok: true,
    access: {
      organizationId: loadedContext.ctx.orgId,
      isAdmin: loadedContext.ctx.isAdmin,
      dataScope: loadedContext.ctx.dataScope,
      automationsEnabled: loadedContext.ctx.enabledModules.has("automations"),
    },
    flow: flowSummary(loadedFlow.flow),
    token: { ctx: loadedContext.ctx, flow: loadedFlow.flow },
  };
}

async function activate(
  actor: RuntimeActor,
  previewId: string,
  digest: string,
): Promise<
  | { readonly ok: true; readonly flow: FlowSummary }
  | {
    readonly ok: false;
    readonly reason: "activation_rejected" | "database_unavailable";
  }
> {
  const result = await actor.userClient.rpc(
    "activate_configured_workflow_from_preview",
    {
      p_preview_id: previewId,
      p_snapshot_digest: digest,
    },
  );
  const rows: unknown = result.data;
  if (result.error) {
    const code = isRecord(result.error) && typeof result.error.code === "string"
      ? result.error.code
      : "";
    return code === "40001" || code === "42501" || code === "22023"
      ? { ok: false, reason: "activation_rejected" }
      : { ok: false, reason: "database_unavailable" };
  }
  if (
    !Array.isArray(rows) || rows.length !== 1 || !isRecord(rows[0]) ||
    rows[0].activated_by !== actor.userId
  ) {
    return { ok: false, reason: "database_unavailable" };
  }
  const flow = parseAutomationFlowRow(rows[0]);
  if (
    !flow || flow.trigger_type !== "configured_workflow" ||
    flow.status !== "active"
  ) {
    return { ok: false, reason: "database_unavailable" };
  }
  return { ok: true, flow: flowSummary(flow) };
}

export const runtimeDependencies: ActivationEndpointDependencies<
  RuntimeActor,
  RuntimeCandidate
> = {
  authenticate: authenticateRuntimeActor,
  loadCandidate,
  prepareSnapshot: prepareRuntimeSnapshot,
  recordProof: recordRuntimeProof,
  activate,
};
