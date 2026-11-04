import type {
  AutomationWorkflowDefinition,
  WorkflowAccessScope,
  WorkflowEntity,
  WorkflowPage,
  WorkflowRecord,
} from "../../_shared/automation-workflow-contract.ts";
import { WORKFLOW_ENTITIES } from "../../_shared/automation-workflow-contract.ts";
import { queryWorkflowEntities } from "../../_shared/automation-workflow-entities.ts";
import {
  estimateConfiguredWorkflowPreview,
  type ConfiguredWorkflowPreviewResult,
} from "../../automation-engine/configured-workflow-preview.ts";
import { configuredWorkflowRequiredModules } from "../../automation-engine/configured-workflow-integration.ts";
import { queryWorkflowReceivables } from "../../automation-engine/configured-workflow-receivables.ts";
import type { ConfiguredStageAttempt } from "../../automation-engine/configured-workflow-runtime.ts";

import type { NativeAutomationFlow } from "./generic-automation-store.ts";
import type { OttoModuleKey } from "./modules.ts";
import type { OttoPermissionModule } from "./modules.ts";
import type { ToolContext } from "./types.ts";

const ATTEMPT_PAGE_SIZE = 1_000;
const ATTEMPT_PAGE_LIMIT = 100;

type EntityPermission = {
  readonly module: OttoModuleKey;
  readonly permissionModule: OttoPermissionModule;
  readonly subarea: string;
};

const ENTITY_PERMISSIONS = {
  receivables: { module: "sales", permissionModule: "sales", subarea: "payments" },
  clients: { module: "clients", permissionModule: "clients", subarea: "list" },
  leads: { module: "leads", permissionModule: "leads", subarea: "kanban" },
  proposals: { module: "proposals", permissionModule: "proposals", subarea: "proposals" },
} as const satisfies Readonly<Record<WorkflowEntity, EntityPermission>>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasViewPermission(ctx: ToolContext, entity: WorkflowEntity): boolean {
  const contract = ENTITY_PERMISSIONS[entity];
  if (!ctx.enabledModules.has(contract.module)) return false;
  if (ctx.isAdmin) return true;
  const modulePermissions = ctx.permissions?.[contract.permissionModule];
  if (!isRecord(modulePermissions) || !isRecord(modulePermissions.subareas)) return false;
  const subarea = modulePermissions.subareas[contract.subarea];
  return isRecord(subarea) && subarea.view === true;
}

function readableEntities(ctx: ToolContext): readonly WorkflowEntity[] {
  if (!ctx.isAdmin || ctx.dataScope !== "all") return [];
  return WORKFLOW_ENTITIES.filter((entity) => hasViewPermission(ctx, entity));
}

function localDate(now: Date, timeZone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value;
    const year = value("year");
    const month = value("month");
    const day = value("day");
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

function parseAttempt(value: unknown): (ConfiguredStageAttempt & { readonly recordId: string }) | null {
  if (!isRecord(value)
    || typeof value.record_id !== "string"
    || typeof value.stage_id !== "string"
    || typeof value.occurrence_key !== "string"
    || typeof value.local_date !== "string"
    || (value.status !== "running" && value.status !== "succeeded"
      && value.status !== "failed" && value.status !== "unknown")) return null;
  return {
    recordId: value.record_id,
    stageId: value.stage_id,
    occurrenceKey: value.occurrence_key,
    localDate: value.local_date,
    status: value.status,
  };
}

async function readAttemptHistoryPage(
  ctx: ToolContext,
  flow: NativeAutomationFlow,
  executionVersion: number | null,
  definition: AutomationWorkflowDefinition,
  stageIds: readonly string[],
  recordIds: readonly string[],
  from: number,
): Promise<Readonly<{ rows: readonly unknown[]; count: number }>> {
  let query = ctx.supabaseUser.from("automation_workflow_stage_executions")
    .select("record_id,stage_id,occurrence_key,local_date,status", { count: "exact" })
    .eq("organization_id", ctx.orgId)
    .eq("flow_id", flow.id)
    .eq("entity_type", definition.query.entity)
    .in("record_id", [...recordIds])
    .in("stage_id", [...stageIds]);
  if (executionVersion !== null) query = query.eq("flow_version", executionVersion);
  const response = await query
    .order("record_id", { ascending: true })
    .order("stage_id", { ascending: true })
    .order("local_date", { ascending: false })
    .range(from, from + ATTEMPT_PAGE_SIZE - 1);
  const rows: unknown = response.data;
  if (response.error || !Array.isArray(rows) || typeof response.count !== "number") {
    throw new Error("configured workflow stage history unavailable");
  }
  return { rows, count: response.count };
}

async function loadAttemptHistory(
  ctx: ToolContext,
  flow: NativeAutomationFlow,
  executionVersion: number,
  definition: AutomationWorkflowDefinition,
  records: readonly WorkflowRecord[],
): Promise<ReadonlyMap<string, readonly ConfiguredStageAttempt[]>> {
  const recordIds = records.map(({ id }) => id);
  const result = new Map<string, ConfiguredStageAttempt[]>(recordIds.map((id) => [id, []]));
  if (recordIds.length === 0) return result;

  const categories = [
    {
      stageIds: definition.stages.filter(({ cadence }) => cadence.mode === "once").map(({ id }) => id),
      version: null,
    },
    {
      stageIds: definition.stages.filter(({ cadence }) => cadence.mode !== "once").map(({ id }) => id),
      version: executionVersion,
    },
  ] as const;
  for (const category of categories) {
    if (category.stageIds.length === 0) continue;
    let expectedCount: number | null = null;
    let consumed = 0;
    for (let page = 0; page < ATTEMPT_PAGE_LIMIT; page += 1) {
      const response = await readAttemptHistoryPage(
        ctx,
        flow,
        category.version,
        definition,
        category.stageIds,
        recordIds,
        page * ATTEMPT_PAGE_SIZE,
      );
      expectedCount ??= response.count;
      if (response.count !== expectedCount) {
        throw new Error("configured workflow stage history changed during preview");
      }
      for (const row of response.rows) {
        const attempt = parseAttempt(row);
        const attempts = attempt ? result.get(attempt.recordId) : undefined;
        if (!attempt || !attempts) {
          throw new Error("configured workflow stage history invalid");
        }
        attempts.push(attempt);
      }
      consumed += response.rows.length;
      if (consumed === expectedCount) break;
      if (response.rows.length !== ATTEMPT_PAGE_SIZE || consumed > expectedCount) {
        throw new Error("configured workflow stage history pagination invalid");
      }
      if (page === ATTEMPT_PAGE_LIMIT - 1) {
        throw new Error("configured workflow stage history exceeds preview limit");
      }
    }
  }
  return result;
}

function previewClock(definition: AutomationWorkflowDefinition, now: Date) {
  const timeZone = definition.trigger.timeZone;
  const occurrenceLocalDate = localDate(now, timeZone);
  return occurrenceLocalDate ? { occurrenceLocalDate, timeZone } : null;
}

export async function buildConfiguredWorkflowPreview(
  ctx: ToolContext,
  flow: NativeAutomationFlow,
  definition: AutomationWorkflowDefinition,
  options: Readonly<{ now?: Date; executionVersion?: number }> = {},
): Promise<ConfiguredWorkflowPreviewResult> {
  const clock = previewClock(definition, options.now ?? new Date());
  if (!clock) return { ok: false, complete: false, reason: "invalid_clock" };
  const executionVersion = options.executionVersion ?? flow.version;
  if (!Number.isInteger(executionVersion) || executionVersion < 1) {
    return { ok: false, complete: false, reason: "data_unavailable" };
  }
  if (!flow.entry_node_id) {
    return { ok: false, complete: false, reason: "graph_reachability_unknown" };
  }
  const enabledModules = new Set<string>(ctx.enabledModules);
  if ([...configuredWorkflowRequiredModules(flow, definition)].some((module) =>
    !enabledModules.has(module)
  )) {
    return { ok: false, complete: false, reason: "not_authorized" };
  }
  const scope: WorkflowAccessScope = { organizationId: ctx.orgId };
  let attemptHistory: ReadonlyMap<string, readonly ConfiguredStageAttempt[]> = new Map();

  const readPage = async (request: Readonly<{
    query: AutomationWorkflowDefinition["query"];
    scope: WorkflowAccessScope;
    cursor?: string;
    clock: Readonly<{ todayIso: string; timeZone: string }>;
  }>): Promise<WorkflowPage> => {
    const page = request.query.entity === "receivables"
      ? await queryWorkflowReceivables(
        ctx.supabaseUser,
        request.scope,
        request.query,
        request.cursor,
        request.clock,
      )
      : await queryWorkflowEntities(
        ctx.supabaseUser,
        request.scope,
        request.query,
        request.cursor,
        request.clock,
      );
    attemptHistory = await loadAttemptHistory(
      ctx,
      flow,
      executionVersion,
      definition,
      page.records,
    );
    return page;
  };

  return estimateConfiguredWorkflowPreview({
    definition,
    graphNodes: flow.graph.nodes,
    graphEdges: flow.graph.edges,
    entryNodeId: flow.entry_node_id,
    scope,
    authorization: {
      organizationId: ctx.orgId,
      isAdmin: ctx.isAdmin,
      dataScope: ctx.dataScope,
      readableEntities: readableEntities(ctx),
    },
    occurrenceKey: `preview:${flow.id}:${flow.version}:${clock.occurrenceLocalDate}`,
    occurrenceLocalDate: clock.occurrenceLocalDate,
    timeZone: clock.timeZone,
    readPage,
    readAttempts: async ({ record }) => {
      const attempts = attemptHistory.get(record.id);
      if (!attempts) throw new Error("configured workflow stage history unavailable");
      return attempts;
    },
  });
}
