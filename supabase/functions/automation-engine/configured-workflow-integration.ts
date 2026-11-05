import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.2";

import {
  parseAutomationWorkflowDefinition,
  type AutomationWorkflowDefinition,
  type WorkflowAccessScope,
  type WorkflowPage,
  type WorkflowRecord,
} from "../_shared/automation-workflow-contract.ts";
import { getWorkflowRecord, queryWorkflowEntities } from "../_shared/automation-workflow-entities.ts";
import {
  claimDueWorkflowOccurrences,
  finishWorkflowOccurrence,
} from "../_shared/automation-workflow-scheduler.ts";
import { executeConfiguredWorkflowRecords } from "./configured-workflow-record-executor.ts";
import { getWorkflowReceivable, queryWorkflowReceivables } from "./configured-workflow-receivables.ts";
import type { ConfiguredWorkflowGraphNode } from "./configured-workflow-runtime.ts";

export type ConfiguredFlow = {
  readonly id: string;
  readonly organization_id: string;
  readonly name: string;
  readonly status: string;
  readonly trigger_type: string;
  readonly trigger_config: Readonly<Record<string, unknown>>;
  readonly graph: Readonly<{
    nodes: readonly ConfiguredWorkflowGraphNode[];
    edges: readonly Readonly<{ id: string; source: string; target: string; branch?: string | null }>[];
  }>;
  readonly entry_node_id: string | null;
  readonly version: number;
  readonly reentry_policy: string;
  readonly quiet_hours: Readonly<{ start?: string; end?: string }> | null;
  readonly max_steps_per_run: number;
  readonly created_by: string | null;
  readonly activated_by: string | null;
};

export type StartConfiguredRecord = (input: Readonly<{
  flow: ConfiguredFlow;
  definition: AutomationWorkflowDefinition;
  record: WorkflowRecord;
  occurrenceKey: string;
  occurrenceLocalDate: string;
  timeZone: string;
}>) => Promise<void>;

type Loaded = Readonly<{ flow: ConfiguredFlow; definition: AutomationWorkflowDefinition; scope: WorkflowAccessScope }>;

function enabledModules(value: unknown): ReadonlySet<string> {
  if (Array.isArray(value)) return new Set(value.filter((item): item is string => typeof item === "string"));
  if (typeof value !== "object" || value === null) return new Set();
  return new Set(Object.entries(value).filter(([, enabled]) => enabled === true).map(([key]) => key));
}

export function configuredWorkflowRequiredModules(
  flow: Pick<ConfiguredFlow, "graph">,
  definition: AutomationWorkflowDefinition,
): ReadonlySet<string> {
  const required = new Set<string>(["automations"]);
  if (definition.query.entity === "receivables") { required.add("sales"); required.add("finance"); }
  else required.add(definition.query.entity);
  const stages = new Set(definition.stages.map((stage) => stage.nodeId));
  for (const node of flow.graph.nodes.filter((candidate) => stages.has(candidate.id))) {
    if (node.type === "send_whatsapp" || node.type === "create_task") required.add("inbox");
    if (node.type === "send_email" || node.type === "add_to_list") required.add("marketing");
  }
  return required;
}

export async function loadAuthorizedConfiguredFlow(
  db: SupabaseClient, flowId: string, expected?: Readonly<{ organizationId?: string; version?: number }>,
): Promise<Loaded> {
  const { data, error } = await db.from("automation_flows").select(
    "id,organization_id,name,status,trigger_type,trigger_config,graph,entry_node_id,version,reentry_policy,quiet_hours,max_steps_per_run,created_by,activated_by",
  ).eq("id", flowId).maybeSingle();
  if (error || !data) throw new Error("configured_workflow_not_found");
  const flow = data as ConfiguredFlow;
  if (flow.status !== "active" || flow.trigger_type !== "configured_workflow"
    || expected?.organizationId && flow.organization_id !== expected.organizationId
    || expected?.version && flow.version !== expected.version) throw new Error("configured_workflow_inactive_or_changed");
  if (!flow.activated_by) throw new Error("configured_workflow_activator_missing");
  const [membership, admin, organization] = await Promise.all([
    db.from("organization_members").select("user_id").eq("organization_id", flow.organization_id)
      .eq("user_id", flow.activated_by).eq("is_active", true).maybeSingle(),
    db.rpc("is_org_admin", { _user_id: flow.activated_by, _org_id: flow.organization_id }),
    db.from("organizations").select("enabled_modules").eq("id", flow.organization_id).maybeSingle(),
  ]);
  if (membership.error || !membership.data || admin.error || admin.data !== true
    || organization.error || !organization.data) {
    throw new Error("configured_workflow_author_not_authorized");
  }
  const parsed = parseAutomationWorkflowDefinition(flow.trigger_config?.workflow);
  if (!parsed.ok) throw new Error("configured_workflow_definition_invalid");
  const available = enabledModules(organization.data.enabled_modules);
  const missing = [...configuredWorkflowRequiredModules(flow, parsed.value)].find((module) => !available.has(module));
  if (missing) throw new Error(`configured_workflow_module_disabled:${missing}`);
  return { flow, definition: parsed.value, scope: { organizationId: flow.organization_id } };
}

export async function readConfiguredWorkflowRecord(
  db: SupabaseClient, loaded: Loaded, recordId: string,
): Promise<WorkflowRecord | null> {
  return loaded.definition.query.entity === "receivables"
    ? getWorkflowReceivable(db, loaded.scope, recordId)
    : getWorkflowRecord(db, loaded.scope, loaded.definition.query.entity, recordId);
}

async function executeLoaded(
  db: SupabaseClient,
  loaded: Loaded,
  occurrence: Readonly<{ key: string; localDate: string; timeZone: string; recordId?: string }>,
  startRecord: StartConfiguredRecord,
) {
  let singleRead = false;
  const readPage = async (cursor?: string): Promise<WorkflowPage> => {
    if (occurrence.recordId) {
      if (singleRead || cursor) return { records: [], nextCursor: null };
      singleRead = true;
      const record = await readConfiguredWorkflowRecord(db, loaded, occurrence.recordId);
      return { records: record ? [record] : [], nextCursor: null };
    }
    return loaded.definition.query.entity === "receivables"
      ? queryWorkflowReceivables(db, loaded.scope, loaded.definition.query, cursor, {
        todayIso: occurrence.localDate, timeZone: occurrence.timeZone,
      })
      : queryWorkflowEntities(db, loaded.scope, loaded.definition.query, cursor, {
        todayIso: occurrence.localDate, timeZone: occurrence.timeZone,
      });
  };
  return executeConfiguredWorkflowRecords({
    organizationId: loaded.flow.organization_id,
    definition: loaded.definition,
    scope: loaded.scope,
    occurrenceLocalDate: occurrence.localDate,
    timeZone: occurrence.timeZone,
  }, {
    readPage,
    readCurrentRecord: (id) => readConfiguredWorkflowRecord(db, loaded, id),
    startRecord: (record) => startRecord({
      flow: loaded.flow,
      definition: loaded.definition,
      record,
      occurrenceKey: occurrence.key,
      occurrenceLocalDate: occurrence.localDate,
      timeZone: occurrence.timeZone,
    }),
  });
}

export async function runDueConfiguredWorkflows(db: SupabaseClient, startRecord: StartConfiguredRecord) {
  const claimed = await claimDueWorkflowOccurrences(db, { now: new Date(), limit: 25, leaseSeconds: 900 });
  if (claimed.kind !== "claimed") return { claimed: 0, completed: 0, failed: 1, error: claimed.reason };
  let completed = 0;
  let failed = 0;
  for (const occurrence of claimed.occurrences) {
    try {
      const loaded = await loadAuthorizedConfiguredFlow(db, occurrence.flowId, {
        organizationId: occurrence.organizationId, version: occurrence.flowVersion,
      });
      if (loaded.definition.trigger.kind !== "daily_schedule") {
        throw new Error("configured_workflow_schedule_mismatch");
      }
      const result = await executeLoaded(db, loaded, {
        key: occurrence.occurrenceId,
        localDate: occurrence.localDate,
        timeZone: loaded.definition.trigger.timeZone,
      }, startRecord);
      if (result.errors.length) throw new Error(result.errors.join(","));
      const finish = await finishWorkflowOccurrence(db, {
        occurrenceId: occurrence.occurrenceId, claimToken: occurrence.claimToken, outcome: "completed",
      });
      if (finish.kind !== "finished") throw new Error("configured_workflow_occurrence_finish_failed");
      completed++;
    } catch (error) {
      failed++;
      await finishWorkflowOccurrence(db, {
        occurrenceId: occurrence.occurrenceId, claimToken: occurrence.claimToken, outcome: "failed",
        error: error instanceof Error ? error.message : "configured workflow failed",
      });
    }
  }
  return { claimed: claimed.occurrences.length, completed, failed };
}

export async function runConfiguredManual(
  db: SupabaseClient, flowId: string, flowVersion: number, actorId: string,
  occurrenceKey: string, startRecord: StartConfiguredRecord,
) {
  const loaded = await loadAuthorizedConfiguredFlow(db, flowId, { version: flowVersion });
  if (loaded.definition.trigger.kind !== "authenticated_manual") throw new Error("configured_workflow_trigger_mismatch");
  const { data: isAdmin } = await db.rpc("is_org_admin", { _user_id: actorId, _org_id: loaded.flow.organization_id });
  if (isAdmin !== true) throw new Error("configured_workflow_actor_not_authorized");
  const now = new Date();
  const timeZone = loaded.definition.trigger.timeZone;
  const localDate = workflowLocalDate(now, timeZone);
  return executeLoaded(db, loaded, {
    key: occurrenceKey, localDate, timeZone,
  }, startRecord);
}

const EVENT_ENTITIES: Readonly<Record<string, "clients" | "leads" | "proposals">> = {
  client_created: "clients", client_status_changed: "clients",
  lead_created: "leads", lead_created_hot: "leads", lead_created_warm: "leads",
  lead_created_cold: "leads", lead_status_changed: "leads", form_submitted: "leads",
  proposal_created: "proposals", proposal_status_changed: "proposals",
};

function workflowLocalDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function configuredNativeEventTarget(event: string, record: Readonly<Record<string, unknown>>) {
  const entity = EVENT_ENTITIES[event];
  const recordId = typeof record.id === "string" ? record.id : null;
  if (!entity || !recordId) return null;
  const identity = typeof record.event_id === "string" ? record.event_id
    : typeof record.updated_at === "string" ? record.updated_at
    : typeof record.created_at === "string" ? record.created_at : null;
  return { entity, recordId, identity };
}

export async function runConfiguredNativeEvent(
  db: SupabaseClient, organizationId: string, event: string, record: Readonly<Record<string, unknown>>,
  startRecord: StartConfiguredRecord,
) {
  const target = configuredNativeEventTarget(event, record);
  if (!target) return { matched: 0, results: [] as readonly unknown[] };
  const { data, error } = await db.from("automation_flows").select("id").eq("organization_id", organizationId)
    .eq("status", "active").eq("trigger_type", "configured_workflow");
  if (error) throw new Error("configured_workflow_event_lookup_failed");
  const results: unknown[] = [];
  for (const row of data ?? []) {
    try {
      const loaded = await loadAuthorizedConfiguredFlow(db, row.id, { organizationId });
      if (loaded.definition.trigger.kind !== "native_event" || loaded.definition.trigger.event !== event
        || loaded.definition.query.entity !== target.entity) continue;
      if (!target.identity && loaded.definition.stages.some((stage) => stage.cadence.mode === "per_run")) {
        results.push({ flowId: loaded.flow.id, error: "configured_workflow_event_identity_missing" });
        continue;
      }
      const timeZone = loaded.definition.trigger.timeZone;
      results.push(await executeLoaded(db, loaded, {
        key: `${event}:${target.recordId}:${target.identity ?? "stable"}`,
        localDate: workflowLocalDate(new Date(), timeZone),
        timeZone,
        recordId: target.recordId,
      }, startRecord));
    } catch {
      results.push({ flowId: row.id, error: "configured_workflow_unavailable" });
    }
  }
  return { matched: results.length, results };
}
