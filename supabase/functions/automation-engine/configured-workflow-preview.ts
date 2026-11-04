import type {
  AutomationWorkflowDefinition,
  WorkflowAccessScope,
  WorkflowEntity,
  WorkflowEvaluationClock,
  WorkflowPage,
  WorkflowQuery,
  WorkflowRecord,
} from "../_shared/automation-workflow-contract.ts";
import type {
  ConfiguredStageAttempt,
  ConfiguredWorkflowGraphNode,
} from "./configured-workflow-runtime.ts";
import {
  CONFIGURED_WORKFLOW_ACTION_TYPES,
  planConfiguredWorkflowStages,
} from "./configured-workflow-runtime.ts";
import type { ConfiguredGraphEdge } from "./configured-workflow-reachability.ts";
import { evaluateConfiguredPreviewReachability } from "./configured-workflow-preview-reachability.ts";

export type ConfiguredWorkflowPreviewAuthorization = {
  readonly organizationId: string;
  readonly isAdmin: boolean;
  readonly dataScope: "own" | "team" | "all";
  readonly readableEntities: readonly WorkflowEntity[];
};

export type ConfiguredWorkflowPreviewPageRequest = {
  readonly query: WorkflowQuery;
  readonly scope: WorkflowAccessScope;
  readonly cursor?: string;
  readonly clock: WorkflowEvaluationClock;
};

export type ConfiguredWorkflowPreviewAttemptRequest = {
  readonly scope: WorkflowAccessScope;
  readonly record: WorkflowRecord;
};

export type ConfiguredWorkflowPreviewReadPage =
  (request: ConfiguredWorkflowPreviewPageRequest) => Promise<WorkflowPage>;

export type ConfiguredWorkflowPreviewReadAttempts =
  (request: ConfiguredWorkflowPreviewAttemptRequest) => Promise<readonly ConfiguredStageAttempt[]>;

export type ConfiguredWorkflowPreviewStage = {
  readonly stageId: string;
  readonly nodeId: string;
  readonly eligibleRecords: number;
  readonly immediateRecords: number;
  readonly deferredRecords: number;
};

export type ConfiguredWorkflowPreviewResult =
  | {
    readonly ok: true;
    readonly complete: true;
    readonly scannedRecords: number;
    readonly eligibleRecords: number;
    readonly eligibleStages: number;
    readonly recordsWithImmediateActions: number;
    readonly recordsWithDeferredActions: number;
    readonly certainty: "exact" | "upper_bound";
    readonly limitations: readonly "actions_after_wait_require_revalidation"[];
    readonly stages: readonly ConfiguredWorkflowPreviewStage[];
    readonly observedLocalDate: string;
    readonly timeZone: string;
    readonly requiresRevalidation: true;
  }
  | {
    readonly ok: false;
    readonly complete: false;
    readonly reason:
      | "not_authorized"
      | "invalid_action_node"
      | "data_unavailable"
      | "stage_history_unavailable"
      | "scope_mismatch"
      | "pagination_invalid"
      | "page_limit_exceeded"
      | "invalid_clock"
      | "graph_reachability_unknown";
  };

export type ConfiguredWorkflowPreviewInput = {
  readonly definition: AutomationWorkflowDefinition;
  readonly graphNodes: readonly ConfiguredWorkflowGraphNode[];
  readonly graphEdges: readonly ConfiguredGraphEdge[];
  readonly entryNodeId: string;
  readonly scope: WorkflowAccessScope;
  readonly authorization: ConfiguredWorkflowPreviewAuthorization;
  readonly occurrenceKey: string;
  readonly occurrenceLocalDate: string;
  readonly timeZone: string;
  readonly readPage: ConfiguredWorkflowPreviewReadPage;
  readonly readAttempts: ConfiguredWorkflowPreviewReadAttempts;
  readonly pageLimit?: number;
};

export async function estimateConfiguredWorkflowPreview(
  input: ConfiguredWorkflowPreviewInput,
): Promise<ConfiguredWorkflowPreviewResult> {
  if (input.authorization.organizationId !== input.scope.organizationId
    || !input.authorization.isAdmin
    || input.authorization.dataScope !== "all"
    || input.scope.ownerIds !== undefined
    || !input.authorization.readableEntities.includes(input.definition.query.entity)) {
    return { ok: false, complete: false, reason: "not_authorized" };
  }
  const dateInstant = Date.parse(`${input.occurrenceLocalDate}T00:00:00Z`);
  const dateIsValid = Number.isFinite(dateInstant)
    && new Date(dateInstant).toISOString().slice(0, 10) === input.occurrenceLocalDate;
  let timeZoneIsValid = false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timeZone }).format(0);
    timeZoneIsValid = true;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  if (!dateIsValid || !timeZoneIsValid || (input.definition.trigger.kind === "daily_schedule"
    && input.definition.trigger.timeZone !== input.timeZone)) {
    return { ok: false, complete: false, reason: "invalid_clock" };
  }

  const actionTypes = new Set<string>(CONFIGURED_WORKFLOW_ACTION_TYPES);
  const stageNodes = new Map<string, ConfiguredWorkflowGraphNode>();
  for (const stage of input.definition.stages) {
    const matches = input.graphNodes.filter((node) => node.id === stage.nodeId);
    const node = matches[0];
    const rules = node?.config.rules;
    const unsupportedInteractiveWhatsapp = node?.type === "send_whatsapp"
      && (node.config.wait_reply === true || (Array.isArray(rules) && rules.length > 0));
    if (matches.length !== 1 || !node || !actionTypes.has(node.type) || unsupportedInteractiveWhatsapp) {
      return { ok: false, complete: false, reason: "invalid_action_node" };
    }
    stageNodes.set(stage.id, node);
  }

  const pageLimit = input.pageLimit ?? 10_000;
  if (!Number.isInteger(pageLimit) || pageLimit < 1) {
    return { ok: false, complete: false, reason: "pagination_invalid" };
  }
  const stageCounts = new Map(input.definition.stages.map((stage) => [stage.id, {
    immediate: 0,
    deferred: 0,
  }]));
  const recordIds = new Set<string>();
  const cursors = new Set<string>();
  const clock = { todayIso: input.occurrenceLocalDate, timeZone: input.timeZone };
  let cursor: string | undefined;
  let scannedRecords = 0;
  let eligibleRecords = 0;
  let eligibleStages = 0;
  let recordsWithImmediateActions = 0;
  let recordsWithDeferredActions = 0;

  for (let pageNumber = 0; pageNumber < pageLimit; pageNumber += 1) {
    let page: WorkflowPage;
    try {
      page = await input.readPage({
        query: input.definition.query,
        scope: input.scope,
        ...(cursor === undefined ? {} : { cursor }),
        clock,
      });
    } catch {
      return { ok: false, complete: false, reason: "data_unavailable" };
    }
    if (page.records.length > (input.definition.query.pageSize ?? 100)) {
      return { ok: false, complete: false, reason: "pagination_invalid" };
    }
    for (const record of page.records) {
      if (record.organizationId !== input.scope.organizationId
        || record.entity !== input.definition.query.entity) {
        return { ok: false, complete: false, reason: "scope_mismatch" };
      }
      if (recordIds.has(record.id)) {
        return { ok: false, complete: false, reason: "pagination_invalid" };
      }
      recordIds.add(record.id);
      scannedRecords += 1;

      let attempts: readonly ConfiguredStageAttempt[];
      try {
        attempts = await input.readAttempts({ scope: input.scope, record });
      } catch {
        return { ok: false, complete: false, reason: "stage_history_unavailable" };
      }
      const plans = planConfiguredWorkflowStages({
        definition: input.definition,
        record,
        graphNodes: input.graphNodes,
        occurrenceKey: input.occurrenceKey,
        occurrenceLocalDate: input.occurrenceLocalDate,
        timeZone: input.timeZone,
        attempts,
      });
      const ready = plans.filter((plan) => plan.kind === "ready");
      const reachability = evaluateConfiguredPreviewReachability({
        nodes: input.graphNodes,
        edges: input.graphEdges,
        entryNodeId: input.entryNodeId,
        record,
      });
      if (!reachability.complete) {
        return { ok: false, complete: false, reason: "graph_reachability_unknown" };
      }
      let immediate = false;
      let deferred = false;
      for (const plan of ready) {
        const count = stageCounts.get(plan.stage.id);
        if (!count) continue;
        if (reachability.immediate.has(plan.node.id)) {
          count.immediate += 1;
          immediate = true;
        } else if (reachability.deferred.has(plan.node.id)) {
          count.deferred += 1;
          deferred = true;
        }
        eligibleStages += 1;
      }
      if (immediate || deferred) eligibleRecords += 1;
      if (immediate) recordsWithImmediateActions += 1;
      if (deferred) recordsWithDeferredActions += 1;
    }

    if (page.nextCursor === null) {
      return {
        ok: true,
        complete: true,
        scannedRecords,
        eligibleRecords,
        eligibleStages,
        recordsWithImmediateActions,
        recordsWithDeferredActions,
        certainty: recordsWithDeferredActions > 0 ? "upper_bound" : "exact",
        limitations: recordsWithDeferredActions > 0
          ? ["actions_after_wait_require_revalidation"]
          : [],
        stages: input.definition.stages.map((stage) => ({
          stageId: stage.id,
          nodeId: stageNodes.get(stage.id)?.id ?? stage.nodeId,
          eligibleRecords: (stageCounts.get(stage.id)?.immediate ?? 0)
            + (stageCounts.get(stage.id)?.deferred ?? 0),
          immediateRecords: stageCounts.get(stage.id)?.immediate ?? 0,
          deferredRecords: stageCounts.get(stage.id)?.deferred ?? 0,
        })),
        observedLocalDate: input.occurrenceLocalDate,
        timeZone: input.timeZone,
        requiresRevalidation: true,
      };
    }
    if (page.nextCursor.length === 0 || page.nextCursor === cursor || cursors.has(page.nextCursor)) {
      return { ok: false, complete: false, reason: "pagination_invalid" };
    }
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return { ok: false, complete: false, reason: "page_limit_exceeded" };
}
