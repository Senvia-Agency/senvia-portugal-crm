import {
  evaluateWorkflowFilters,
  parseWorkflowRecord,
  type WorkflowAccessScope,
  type WorkflowPage,
  type WorkflowQuery,
  type WorkflowRecord,
} from "../_shared/automation-workflow-contract.ts";
import {
  projectAutomationReceivables,
  type AutomationRecurringCycle,
  type AutomationSale,
  type AutomationSalePayment,
  type CollectibleReceivable,
} from "../_shared/automation-receivables.ts";

type Row = Readonly<Record<string, unknown>>;
type Calendar = Readonly<{ todayIso: string; timeZone: string }>;
export interface WorkflowReceivableDatabase {
  from(table: string): unknown;
}
const PAYMENT_PREFIX = "sale_payment:";
const CYCLE_PREFIX = "sale_recurring_cycle:";

function rows(value: unknown): readonly Row[] {
  return Array.isArray(value)
    ? value.filter((item): item is Row => typeof item === "object" && item !== null && !Array.isArray(item))
    : [];
}
function row(value: unknown): Row | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value)) : null;
}
function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value) throw new Error(`invalid receivable ${key}`);
  return value;
}
function optionalText(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`invalid receivable ${key}`);
  return value;
}
function numeric(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`invalid receivable ${key}`);
  return value;
}
function chain(target: unknown, method: "select" | "eq" | "in" | "is" | "order" | "limit" | "gt", ...args: readonly unknown[]): unknown {
  if (typeof target !== "object" || target === null) throw new Error("invalid receivable query");
  const invoke = Reflect.get(target, method);
  if (typeof invoke !== "function") throw new Error("invalid receivable query");
  return Reflect.apply(invoke, target, args);
}
function selectFrom(db: WorkflowReceivableDatabase, table: string, columns: string): unknown {
  return chain(db.from(table), "select", columns);
}
async function selectRows(query: unknown): Promise<readonly Row[]> {
  const result: unknown = await query;
  const response = row(result);
  if (!response) throw new Error("invalid receivable database response");
  if (response.error) throw new Error("receivable database read failed");
  return rows(response.data);
}

async function hydrate(db: WorkflowReceivableDatabase, organizationId: string, sourceRows: readonly Row[], kind: "payments" | "cycles") {
  const saleIds = [...new Set(sourceRows.map((row) => text(row, "sale_id")))];
  let salesQuery = selectFrom(db, "sales", "id,organization_id,client_id,status,created_at,updated_at");
  salesQuery = chain(salesQuery, "eq", "organization_id", organizationId);
  salesQuery = chain(salesQuery, "in", "id", saleIds);
  const salesRows = saleIds.length ? await selectRows(salesQuery) : [];
  const clientIds = [...new Set(salesRows.map((row) => optionalText(row, "client_id")).filter((id): id is string => !!id))];
  let clientsQuery = selectFrom(db, "crm_clients", "id,organization_id,name,email,phone");
  clientsQuery = chain(clientsQuery, "eq", "organization_id", organizationId);
  clientsQuery = chain(clientsQuery, "in", "id", clientIds);
  const clients = clientIds.length ? await selectRows(clientsQuery) : [];
  const sales: AutomationSale[] = salesRows.map((row) => ({
    id: text(row, "id"), organizationId: text(row, "organization_id"),
    clientId: optionalText(row, "client_id"), status: text(row, "status"),
  }));
  const cycles: AutomationRecurringCycle[] = [];
  let paymentRows = sourceRows;
  if (kind === "cycles") {
    const recurrenceIds = [...new Set(sourceRows.map((row) => text(row, "recurrence_id")))];
    let recurrenceQuery = selectFrom(db, "sale_recurrences", "id,organization_id,service_status,billing_provider");
    recurrenceQuery = chain(recurrenceQuery, "eq", "organization_id", organizationId);
    recurrenceQuery = chain(recurrenceQuery, "in", "id", recurrenceIds);
    const recurrenceRows = recurrenceIds.length ? await selectRows(recurrenceQuery) : [];
    const recurrences = new Map(recurrenceRows.map((row) => [text(row, "id"), row]));
    for (const row of sourceRows) {
      const recurrence = recurrences.get(text(row, "recurrence_id"));
      if (!recurrence || text(row, "status") === "cancelled") continue;
      cycles.push({
        id: text(row, "id"), organizationId: text(row, "organization_id"), saleId: text(row, "sale_id"),
        dueDate: text(row, "due_date"), amount: numeric(row, "amount"), status: text(row, "status"),
        paidAt: optionalText(row, "paid_at"), recurrenceServiceStatus: text(recurrence, "service_status"),
        billingProvider: text(recurrence, "billing_provider"),
      });
    }
    const cycleIds = sourceRows.map((row) => text(row, "id"));
    let paymentQuery = selectFrom(db, "sale_payments", "id,organization_id,sale_id,recurring_cycle_id,payment_date,amount,status,reversal_status,created_at,updated_at");
    paymentQuery = chain(paymentQuery, "eq", "organization_id", organizationId);
    paymentQuery = chain(paymentQuery, "in", "recurring_cycle_id", cycleIds);
    paymentRows = cycleIds.length ? await selectRows(paymentQuery) : [];
  }
  const payments: AutomationSalePayment[] = paymentRows.map((row) => {
    const status = text(row, "status");
    if (status !== "paid" && status !== "pending") throw new Error("invalid receivable payment status");
    return {
      id: text(row, "id"), organizationId: text(row, "organization_id"), saleId: text(row, "sale_id"),
      recurringCycleId: optionalText(row, "recurring_cycle_id"), dueDate: text(row, "payment_date"),
      amount: numeric(row, "amount"), status,
      reversalStatus: optionalText(row, "reversal_status"),
    };
  });
  return { projection: projectAutomationReceivables({ organizationId, sales, cycles, payments }), salesRows, clients };
}

function workflowRecord(item: CollectibleReceivable, source: Row, sales: readonly Row[], clients: readonly Row[], select?: readonly string[]): WorkflowRecord {
  const sale = sales.find((row) => row.id === item.saleId);
  const client = clients.find((row) => row.id === item.clientId);
  const all: Record<string, string | number | boolean | null> = {
    due_date: item.dueDate, outstanding_amount: item.outstandingAmount,
    original_amount: numeric(source, "amount"), status: "pending",
    source: item.kind === "recurring_cycle" ? "sale_recurring_cycle" : "sale_payment",
    sale_id: item.saleId, client_id: item.clientId,
    contact_name: client ? optionalText(client, "name") : null,
    contact_email: client ? optionalText(client, "email") : null,
    contact_phone: client ? optionalText(client, "phone") : null,
    created_at: optionalText(source, "created_at") ?? (sale ? optionalText(sale, "created_at") : null),
    updated_at: optionalText(source, "updated_at") ?? (sale ? optionalText(sale, "updated_at") : null),
  };
  const fields = Object.fromEntries((select ?? Object.keys(all)).map((key) => [key, all[key] ?? null]));
  const parsed = parseWorkflowRecord({
    entity: "receivables", id: item.receivableId, organizationId: item.organizationId, fields,
    ...(client ? { contact: { clientId: item.clientId ?? undefined, name: optionalText(client, "name"),
      email: optionalText(client, "email"), phone: optionalText(client, "phone") } } : {}),
  });
  if (!parsed.ok) throw new Error("invalid projected receivable");
  return parsed.value;
}

async function sourcePage(db: WorkflowReceivableDatabase, scope: WorkflowAccessScope, cursor: string | undefined, limit: number) {
  const cyclePhase = cursor?.startsWith(CYCLE_PREFIX) ?? false;
  const prefix = cyclePhase ? CYCLE_PREFIX : PAYMENT_PREFIX;
  const table = cyclePhase ? "sale_recurring_cycles" : "sale_payments";
  const columns = cyclePhase
    ? "id,organization_id,sale_id,recurrence_id,due_date,amount,status,paid_at,created_at,updated_at"
    : "id,organization_id,sale_id,recurring_cycle_id,payment_date,amount,status,reversal_status,created_at,updated_at";
  let query = selectFrom(db, table, columns);
  query = chain(query, "eq", "organization_id", scope.organizationId);
  query = chain(query, "order", "id");
  query = chain(query, "limit", limit);
  if (!cyclePhase) query = chain(query, "is", "recurring_cycle_id", null);
  const rawCursor = cursor?.startsWith(prefix) ? cursor.slice(prefix.length) : undefined;
  if (rawCursor) query = chain(query, "gt", "id", rawCursor);
  const data = await selectRows(query);
  return { data, kind: cyclePhase ? "cycles" as const : "payments" as const, prefix };
}

export async function queryWorkflowReceivables(db: WorkflowReceivableDatabase, scope: WorkflowAccessScope, query: WorkflowQuery,
  cursor: string | undefined, clock: Calendar): Promise<WorkflowPage> {
  if (scope.ownerIds !== undefined) throw new Error("receivables require organization-wide authorized scope");
  const page = await sourcePage(db, scope, cursor, query.pageSize);
  const hydrated = await hydrate(db, scope.organizationId, page.data, page.kind);
  const records = hydrated.projection.collectible.map((item) => workflowRecord(item,
    page.data.find((row) => row.id === item.sourceId) ?? {}, hydrated.salesRows, hydrated.clients, query.select))
    .filter((record) => evaluateWorkflowFilters(record, query.filters, clock));
  let nextCursor = page.data.length === query.pageSize ? `${page.prefix}${text(page.data[page.data.length - 1], "id")}` : null;
  if (!nextCursor && page.kind === "payments") nextCursor = CYCLE_PREFIX;
  return { records, nextCursor };
}

export async function getWorkflowReceivable(db: WorkflowReceivableDatabase, scope: WorkflowAccessScope,
  recordId: string): Promise<WorkflowRecord | null> {
  if (scope.ownerIds !== undefined) throw new Error("receivables require organization-wide authorized scope");
  const cycle = recordId.startsWith(CYCLE_PREFIX);
  const prefix = cycle ? CYCLE_PREFIX : PAYMENT_PREFIX;
  if (!recordId.startsWith(prefix)) return null;
  const id = recordId.slice(prefix.length);
  const table = cycle ? "sale_recurring_cycles" : "sale_payments";
  const columns = cycle
    ? "id,organization_id,sale_id,recurrence_id,due_date,amount,status,paid_at,created_at,updated_at"
    : "id,organization_id,sale_id,recurring_cycle_id,payment_date,amount,status,reversal_status,created_at,updated_at";
  let query = selectFrom(db, table, columns);
  query = chain(query, "eq", "organization_id", scope.organizationId);
  query = chain(query, "eq", "id", id);
  if (!cycle) query = chain(query, "is", "recurring_cycle_id", null);
  query = chain(query, "limit", 1);
  const source = await selectRows(query);
  if (source.length !== 1) return null;
  const hydrated = await hydrate(db, scope.organizationId, source, cycle ? "cycles" : "payments");
  const item = hydrated.projection.collectible.find((candidate) => candidate.receivableId === recordId);
  return item ? workflowRecord(item, source[0], hydrated.salesRows, hydrated.clients) : null;
}
