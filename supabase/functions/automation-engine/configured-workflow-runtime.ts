import type {
  AutomationWorkflowDefinition,
  WorkflowCadence,
  WorkflowRecord,
  WorkflowStage,
} from "../_shared/automation-workflow-contract.ts";
import {
  evaluateWorkflowConditions,
  evaluateWorkflowFilters,
} from "../_shared/automation-workflow-contract.ts";

export const CONFIGURED_WORKFLOW_ACTION_TYPES = [
  "send_whatsapp",
  "send_email",
  "move_stage",
  "assign_user",
  "add_to_list",
  "create_task",
  "webhook",
] as const;

export type ConfiguredWorkflowActionType = (typeof CONFIGURED_WORKFLOW_ACTION_TYPES)[number];

export type ConfiguredWorkflowGraphNode = {
  readonly id: string;
  readonly type: string;
  readonly config: Readonly<Record<string, unknown>>;
};

export type ConfiguredStageAttempt = {
  readonly stageId: string;
  readonly occurrenceKey: string;
  readonly localDate: string;
  readonly status: "running" | "succeeded" | "failed" | "unknown";
};

export type ConfiguredStagePlan =
  | {
    readonly kind: "ready";
    readonly stage: WorkflowStage;
    readonly node: ConfiguredWorkflowGraphNode;
    readonly cadenceKey: string;
  }
  | {
    readonly kind: "skipped";
    readonly stage: WorkflowStage;
    readonly reason: "query_mismatch" | "condition_mismatch" | "cadence_blocked" | "invalid_action_node";
  };

export type ConfiguredWorkflowPlanInput = {
  readonly definition: AutomationWorkflowDefinition;
  readonly record: WorkflowRecord;
  readonly graphNodes: readonly ConfiguredWorkflowGraphNode[];
  readonly occurrenceKey: string;
  readonly occurrenceLocalDate: string;
  readonly timeZone: string;
  readonly attempts: readonly ConfiguredStageAttempt[];
};

function isConfiguredAction(
  node: ConfiguredWorkflowGraphNode | undefined,
  actionTypes: ReadonlySet<string>,
): node is ConfiguredWorkflowGraphNode {
  if (!node || !actionTypes.has(node.type)) return false;
  if (node.type !== "send_whatsapp") return true;
  const rules = node.config.rules;
  return node.config.wait_reply !== true && (!Array.isArray(rules) || rules.length === 0);
}

function cadenceKey(cadence: WorkflowCadence, occurrenceKey: string, localDate: string): string {
  switch (cadence.mode) {
    case "once":
      return "once";
    case "per_run":
      return `run:${occurrenceKey}`;
    case "interval_days":
      return `interval:${localDate}`;
  }
}

function calendarDays(from: string, to: string): number | null {
  const fromInstant = Date.parse(`${from}T00:00:00Z`);
  const toInstant = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(fromInstant) || !Number.isFinite(toInstant)) return null;
  return Math.floor((toInstant - fromInstant) / 86_400_000);
}

function cadenceAllows(
  stage: WorkflowStage,
  occurrenceKey: string,
  localDate: string,
  attempts: readonly ConfiguredStageAttempt[],
): boolean {
  const stageAttempts = attempts.filter((attempt) => attempt.stageId === stage.id);
  switch (stage.cadence.mode) {
    case "once":
      return stageAttempts.length === 0;
    case "per_run":
      return !stageAttempts.some((attempt) => attempt.occurrenceKey === occurrenceKey);
    case "interval_days": {
      const latest = stageAttempts
        .sort((left, right) => right.localDate.localeCompare(left.localDate))[0];
      if (!latest) return true;
      if (latest.status !== "succeeded") return false;
      const elapsed = calendarDays(latest.localDate, localDate);
      return elapsed !== null && elapsed >= stage.cadence.days;
    }
  }
}

export function planConfiguredWorkflowStages(input: ConfiguredWorkflowPlanInput): readonly ConfiguredStagePlan[] {
  const nodes = new Map(input.graphNodes.map((node) => [node.id, node]));
  const actionTypes = new Set<string>(CONFIGURED_WORKFLOW_ACTION_TYPES);
  const clock = { todayIso: input.occurrenceLocalDate, timeZone: input.timeZone };
  return input.definition.stages.map((stage): ConfiguredStagePlan => {
    const node = nodes.get(stage.nodeId);
    if (!isConfiguredAction(node, actionTypes)) {
      return { kind: "skipped", stage, reason: "invalid_action_node" };
    }
    if (input.record.entity !== input.definition.query.entity
      || !evaluateWorkflowFilters(input.record, input.definition.query.filters, clock)) {
      return { kind: "skipped", stage, reason: "query_mismatch" };
    }
    if (!evaluateWorkflowConditions(input.record, stage.conditions, clock)) {
      return { kind: "skipped", stage, reason: "condition_mismatch" };
    }
    if (!cadenceAllows(stage, input.occurrenceKey, input.occurrenceLocalDate, input.attempts)) {
      return { kind: "skipped", stage, reason: "cadence_blocked" };
    }
    return {
      kind: "ready",
      stage,
      node,
      cadenceKey: cadenceKey(stage.cadence, input.occurrenceKey, input.occurrenceLocalDate),
    };
  });
}
