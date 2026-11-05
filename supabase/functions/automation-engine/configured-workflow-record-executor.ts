import {
  evaluateWorkflowFilters,
  type AutomationWorkflowDefinition,
  type WorkflowAccessScope,
  type WorkflowPage,
  type WorkflowRecord,
} from "../_shared/automation-workflow-contract.ts";

export type ConfiguredRecordExecutionInput = {
  readonly organizationId: string;
  readonly definition: AutomationWorkflowDefinition;
  readonly scope: WorkflowAccessScope;
  readonly occurrenceLocalDate: string;
  readonly timeZone: string;
};

export type ConfiguredRecordExecutionDependencies = {
  readonly readPage: (cursor?: string) => Promise<WorkflowPage>;
  readonly readCurrentRecord: (recordId: string) => Promise<WorkflowRecord | null>;
  readonly startRecord: (record: WorkflowRecord) => Promise<void>;
};

export type ConfiguredRecordExecutionResult = {
  readonly scanned: number;
  readonly started: number;
  readonly skipped: number;
  readonly errors: readonly string[];
};

function validRecord(record: WorkflowRecord, input: ConfiguredRecordExecutionInput): boolean {
  return record.organizationId === input.organizationId
    && record.organizationId === input.scope.organizationId
    && record.entity === input.definition.query.entity;
}

export async function executeConfiguredWorkflowRecords(
  input: ConfiguredRecordExecutionInput,
  dependencies: ConfiguredRecordExecutionDependencies,
): Promise<ConfiguredRecordExecutionResult> {
  if (input.scope.organizationId !== input.organizationId) {
    return { scanned: 0, started: 0, skipped: 0, errors: ["workflow_scope_mismatch"] };
  }
  const clock = { todayIso: input.occurrenceLocalDate, timeZone: input.timeZone };
  const errors: string[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let scanned = 0;
  let started = 0;
  let skipped = 0;

  for (let pageNumber = 0; pageNumber < 10_000; pageNumber++) {
    let page: WorkflowPage;
    try { page = await dependencies.readPage(cursor); }
    catch { errors.push("workflow_query_unavailable"); break; }
    for (const candidate of page.records) {
      scanned++;
      if (!validRecord(candidate, input)) { errors.push("workflow_record_scope_mismatch"); continue; }
      let current: WorkflowRecord | null;
      try { current = await dependencies.readCurrentRecord(candidate.id); }
      catch { errors.push(`workflow_record_unavailable:${candidate.id}`); continue; }
      if (!current || !validRecord(current, input)
        || !evaluateWorkflowFilters(current, input.definition.query.filters, clock)) {
        skipped++;
        continue;
      }
      try { await dependencies.startRecord(current); started++; }
      catch { errors.push(`workflow_record_start_failed:${candidate.id}`); }
    }
    if (page.nextCursor === null) break;
    if (cursors.has(page.nextCursor)) { errors.push("workflow_cursor_cycle"); break; }
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return { scanned, started, skipped, errors };
}
