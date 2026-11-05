import { ENTITY_SELECTS, ENTITY_TABLES, type NativeWorkflowEntity } from "./automation-workflow-entity-records.ts";
import { z } from "https://esm.sh/zod@3.25.76";

export interface WorkflowEntityClient {
  from(table: string): unknown;
}

export interface EntityReadRequest {
  readonly entity: NativeWorkflowEntity;
  readonly organizationId: string;
  readonly limit: number;
  readonly cursor?: string;
  readonly id?: string;
}

export type EntityReader = (request: EntityReadRequest) => Promise<unknown>;

export class WorkflowEntityReadError extends Error {
  constructor(readonly code: "database_error" | "invalid_result" | "invalid_query") {
    super(`Workflow entity read failed: ${code}`);
    this.name = "WorkflowEntityReadError";
  }
}

function chain(target: unknown, method: "select" | "eq" | "gt" | "is" | "order" | "limit", ...args: readonly unknown[]): unknown {
  if (typeof target !== "object" || target === null) throw new WorkflowEntityReadError("invalid_query");
  const invoke = Reflect.get(target, method);
  if (typeof invoke !== "function") throw new WorkflowEntityReadError("invalid_query");
  return Reflect.apply(invoke, target, args);
}

export function supabaseEntityReader(db: WorkflowEntityClient): EntityReader {
  return async (request) => {
    let query = chain(db.from(ENTITY_TABLES[request.entity]), "select", ENTITY_SELECTS[request.entity]);
    query = chain(query, "eq", "organization_id", request.organizationId);
    query = chain(query, "order", "id", { ascending: true });
    query = chain(query, "limit", request.limit);
    if (request.cursor) query = chain(query, "gt", "id", request.cursor);
    if (request.id) query = chain(query, "eq", "id", request.id);
    if (request.entity === "leads") {
      query = chain(query, "is", "archived_at", null);
      query = chain(query, "eq", "automation_enabled", true);
    }
    const result = z.object({ data: z.unknown(), error: z.unknown() }).parse(await query);
    if (result.error) throw new WorkflowEntityReadError("database_error");
    return result.data;
  };
}
