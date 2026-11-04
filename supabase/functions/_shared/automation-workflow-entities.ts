import { z } from "https://esm.sh/zod@3.25.76";
import {
  evaluateWorkflowFilters, parseWorkflowQuery, parseWorkflowRecord, WORKFLOW_FIELD_CATALOG,
  type WorkflowAccessScope, type WorkflowRecord,
} from "./automation-workflow-contract.ts";
import { nativeEntitySchema, parseEntityRecord, type EntityRecord } from "./automation-workflow-entity-records.ts";
import { supabaseEntityReader, WorkflowEntityReadError, type EntityReader, type WorkflowEntityClient } from "./automation-workflow-entity-source.ts";

const uuid = z.string().uuid();
const scopeSchema = z.object({ organizationId: uuid, ownerIds: z.array(uuid).optional() }).strict();
const rawIdentity = z.object({ id: uuid, organization_id: uuid });

export interface WorkflowEntityPage {
  readonly records: readonly WorkflowRecord[];
  readonly nextCursor: string | null;
}

export interface WorkflowEntityCalendar {
  readonly todayIso: string;
  readonly timeZone: string;
}

function project(record: EntityRecord, select: readonly string[]): WorkflowRecord {
  const fields: Record<string, string | number | boolean | null> = {};
  for (const key of select) {
    const value = record.fields[key] ?? null;
    fields[key] = value;
  }
  const result = parseWorkflowRecord({ entity: record.entity, id: record.id, organizationId: record.organizationId, fields,
    ...(record.contact ? { contact: record.contact } : {}) });
  if (!result.ok) throw new WorkflowEntityReadError("invalid_result");
  return result.value;
}

function accessible(record: EntityRecord, scope: WorkflowAccessScope): boolean {
  return record.organizationId === scope.organizationId
    && (scope.ownerIds === undefined || record.ownerIds.some((id) => scope.ownerIds?.includes(id)));
}

export async function readWorkflowEntityPage(
  readRows: EntityReader,
  inputScope: unknown,
  inputQuery: unknown,
  cursor?: string,
  calendar?: WorkflowEntityCalendar,
): Promise<WorkflowEntityPage> {
  const scope = scopeSchema.parse(inputScope);
  const parsedQuery = parseWorkflowQuery(inputQuery);
  if (!parsedQuery.ok) throw new WorkflowEntityReadError("invalid_query");
  const query = parsedQuery.value;
  if (query.filters.length > 0 && !calendar) throw new WorkflowEntityReadError("invalid_query");
  const entity = nativeEntitySchema.parse(query.entity);
  const limit = query.pageSize ?? 100;
  const parsedCursor = cursor === undefined ? undefined : uuid.parse(cursor);
  const rows = z.array(z.unknown()).max(limit).parse(await readRows({ entity, organizationId: scope.organizationId,
    limit, ...(parsedCursor ? { cursor: parsedCursor } : {}) }));
  const records: WorkflowRecord[] = [];
  let lastId = parsedCursor ?? null;
  for (const input of rows) {
    const identity = rawIdentity.parse(input);
    if (lastId !== null && identity.id <= lastId) throw new WorkflowEntityReadError("invalid_result");
    lastId = identity.id;
    if (identity.organization_id !== scope.organizationId) continue;
    const record = parseEntityRecord(entity, input);
    if (!record || !accessible(record, scope)) continue;
    const projected = project(record, query.select);
    if (query.filters.length === 0 || calendar && evaluateWorkflowFilters(projected, query.filters, calendar)) records.push(projected);
  }
  return { records, nextCursor: rows.length === limit ? lastId : null };
}

export function queryWorkflowEntities(
  db: WorkflowEntityClient, scope: WorkflowAccessScope, query: unknown, cursor?: string, calendar?: WorkflowEntityCalendar,
): Promise<WorkflowEntityPage> {
  return readWorkflowEntityPage(supabaseEntityReader(db), scope, query, cursor, calendar);
}

export async function readWorkflowRecord(
  readRows: EntityReader, inputScope: unknown, inputEntity: unknown, inputId: unknown,
): Promise<WorkflowRecord | null> {
  const scope = scopeSchema.parse(inputScope);
  const entity = nativeEntitySchema.parse(inputEntity);
  const id = uuid.parse(inputId);
  const rows = z.array(z.unknown()).max(1).parse(await readRows({ entity, organizationId: scope.organizationId, id, limit: 1 }));
  if (rows.length === 0) return null;
  const identity = rawIdentity.parse(rows[0]);
  if (identity.id !== id || identity.organization_id !== scope.organizationId) return null;
  const record = parseEntityRecord(entity, rows[0]);
  return record && accessible(record, scope) ? project(record, WORKFLOW_FIELD_CATALOG[entity].map((field) => field.name)) : null;
}

export function getWorkflowRecord(
  db: WorkflowEntityClient, scope: WorkflowAccessScope, entity: unknown, id: unknown,
): Promise<WorkflowRecord | null> {
  return readWorkflowRecord(supabaseEntityReader(db), scope, entity, id);
}
