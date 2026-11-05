import { z } from "zod";

export const AUTOMATION_WORKFLOW_SCHEMA_VERSION = 1 as const;
export const WORKFLOW_ENTITIES = ["receivables", "clients", "leads", "proposals"] as const;
export const WORKFLOW_TRIGGER_KINDS = ["daily_schedule", "native_event", "authenticated_manual"] as const;
export const WORKFLOW_PREDICATE_OPERATORS = ["exists", "not_exists", "equals", "not_equals", "contains", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "before", "after", "between"] as const;
export const WORKFLOW_CADENCE_MODES = ["once", "per_run", "interval_days"] as const;
export const WORKFLOW_NATIVE_EVENTS = [
  "lead_created", "lead_created_hot", "lead_created_warm", "lead_created_cold", "lead_status_changed", "form_submitted",
  "message_received", "whatsapp_keyword", "sale_status_changed", "list_joined", "sale_renewal_due_today",
  "sale_renewal_due_in_2_days", "sale_renewal_overdue", "sale_payment_overdue_10d", "referral_month_earned",
  "referral_month_started", "referral_month_ending_2d", "subscription_renewal_due_2d", "stripe_subscription_past_due",
  "client_created", "client_status_changed", "proposal_created", "proposal_status_changed", "sale_created", "trial_started",
  "trial_day_3", "trial_day_7", "trial_expiring_3d", "trial_expiring_1d", "trial_expired", "trial_inactive_48h",
  "stripe_subscription_created", "stripe_subscription_renewed", "stripe_subscription_canceled",
] as const;
export const WORKFLOW_NATIVE_EVENT_ENTITY_RULES = [
  { event: "lead_created", entities: ["leads"] }, { event: "lead_created_hot", entities: ["leads"] },
  { event: "lead_created_warm", entities: ["leads"] }, { event: "lead_created_cold", entities: ["leads"] },
  { event: "lead_status_changed", entities: ["leads"] }, { event: "form_submitted", entities: ["leads"] },
  { event: "client_created", entities: ["clients"] }, { event: "client_status_changed", entities: ["clients"] },
  { event: "proposal_created", entities: ["proposals"] }, { event: "proposal_status_changed", entities: ["proposals"] },
] as const;
export type WorkflowEntity = (typeof WORKFLOW_ENTITIES)[number];
export type WorkflowFieldType = "text" | "number" | "date" | "datetime" | "boolean";
export type WorkflowScalar = string | number | boolean | null;
export type WorkflowFieldDefinition = { readonly name: string; readonly label: string; readonly type: WorkflowFieldType };

export const WORKFLOW_FIELD_CATALOG = {
  receivables: [
    { name: "due_date", label: "Data de vencimento", type: "date" }, { name: "outstanding_amount", label: "Valor pendente", type: "number" },
    { name: "original_amount", label: "Valor original", type: "number" }, { name: "status", label: "Estado", type: "text" },
    { name: "source", label: "Origem", type: "text" }, { name: "sale_id", label: "Venda", type: "text" },
    { name: "client_id", label: "Cliente", type: "text" }, { name: "contact_name", label: "Nome do contacto", type: "text" },
    { name: "contact_email", label: "Email do contacto", type: "text" }, { name: "contact_phone", label: "Telefone do contacto", type: "text" },
    { name: "created_at", label: "Criado em", type: "datetime" }, { name: "updated_at", label: "Atualizado em", type: "datetime" },
  ],
  clients: [
    { name: "name", label: "Nome", type: "text" }, { name: "status", label: "Estado", type: "text" },
    { name: "source", label: "Origem", type: "text" }, { name: "created_at", label: "Criado em", type: "datetime" },
    { name: "updated_at", label: "Atualizado em", type: "datetime" }, { name: "assigned_to", label: "Responsável", type: "text" },
    { name: "email", label: "Email", type: "text" }, { name: "phone", label: "Telefone", type: "text" },
  ],
  leads: [
    { name: "name", label: "Nome", type: "text" }, { name: "status", label: "Estado", type: "text" },
    { name: "source", label: "Origem", type: "text" }, { name: "created_at", label: "Criado em", type: "datetime" },
    { name: "updated_at", label: "Atualizado em", type: "datetime" }, { name: "assigned_to", label: "Responsável", type: "text" },
    { name: "email", label: "Email", type: "text" }, { name: "phone", label: "Telefone", type: "text" },
  ],
  proposals: [
    { name: "status", label: "Estado", type: "text" }, { name: "total_value", label: "Valor total", type: "number" },
    { name: "proposal_date", label: "Data da proposta", type: "date" }, { name: "created_at", label: "Criado em", type: "datetime" },
    { name: "updated_at", label: "Atualizado em", type: "datetime" }, { name: "created_by", label: "Criado por", type: "text" },
    { name: "client_id", label: "Cliente", type: "text" }, { name: "lead_id", label: "Lead", type: "text" },
  ],
} as const satisfies Readonly<Record<WorkflowEntity, readonly WorkflowFieldDefinition[]>>;

const identifier = z.string().trim().min(1).max(128);
const uuid = z.string().uuid();
const receivableId = z.string().regex(/^sale_(payment|recurring_cycle):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const isoDateTime = z.string().datetime({ offset: true });
const relativeDate = z.object({ kind: z.literal("today_offset_days"), days: z.number().int().min(-3650).max(3650) }).strict();
const operandSchema = z.union([z.string().max(2_000), z.number().finite(), z.boolean(), relativeDate]);
const predicate = z.discriminatedUnion("operator", [
  z.object({ field: identifier, operator: z.enum(["exists", "not_exists"]) }).strict(),
  z.object({ field: identifier, operator: z.enum(["equals", "not_equals", "contains", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "before", "after"]), value: operandSchema }).strict(),
  z.object({ field: identifier, operator: z.literal("between"), values: z.tuple([operandSchema, operandSchema]) }).strict(),
]);
const cadence = z.discriminatedUnion("mode", [z.object({ mode: z.literal("once") }).strict(), z.object({ mode: z.literal("per_run") }).strict(), z.object({ mode: z.literal("interval_days"), days: z.number().int().min(1).max(3650) }).strict()]);
function iana(value: string): boolean { try { new Intl.DateTimeFormat("en", { timeZone: value }).format(0); return true; } catch (error) { if (error instanceof RangeError) return false; throw error; } }
const trigger = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily_schedule"), localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), timeZone: z.string().refine(iana) }).strict(),
  z.object({ kind: z.literal("native_event"), event: z.enum(WORKFLOW_NATIVE_EVENTS), timeZone: z.string().refine(iana) }).strict(),
  z.object({ kind: z.literal("authenticated_manual"), timeZone: z.string().refine(iana) }).strict(),
]);
const query = z.object({ entity: z.enum(WORKFLOW_ENTITIES), select: z.array(identifier).min(1).max(50), filters: z.array(predicate).max(50).default([]), pageSize: z.number().int().min(1).max(100).default(100) }).strict();
const stage = z.object({ id: identifier, nodeId: identifier, conditions: z.array(predicate).max(50).default([]), cadence: cadence.default({ mode: "once" }) }).strict();
const definition = z.object({ schemaVersion: z.literal(AUTOMATION_WORKFLOW_SCHEMA_VERSION), trigger, query, stages: z.array(stage).min(1).max(100) }).strict();
const draftDefinition = z.object({ schemaVersion: z.literal(AUTOMATION_WORKFLOW_SCHEMA_VERSION), trigger, query, stages: z.array(stage).max(100) }).strict();
const record = z.object({ entity: z.enum(WORKFLOW_ENTITIES), id: z.string().max(100), organizationId: uuid, fields: z.record(z.union([z.string(), z.number().finite(), z.boolean(), z.null()])), contact: z.object({ clientId: uuid.optional(), name: z.string().nullable().optional(), email: z.string().nullable().optional(), phone: z.string().nullable().optional() }).strict().optional() }).strict();
const accessScope = z.object({ organizationId: z.string().uuid(), ownerIds: z.array(z.string().uuid()).optional() }).strict();

export type WorkflowPredicate = z.infer<typeof predicate>;
export type WorkflowFilter = WorkflowPredicate;
export type WorkflowCondition = WorkflowPredicate;
export type WorkflowCadence = z.infer<typeof cadence>;
export type WorkflowTrigger = z.infer<typeof trigger>;
export type WorkflowQuery = z.infer<typeof query>;
export type WorkflowStage = z.infer<typeof stage>;
export type AutomationWorkflowDefinition = z.infer<typeof definition>;
export type AutomationWorkflowDraft = z.infer<typeof draftDefinition>;
export type WorkflowRecord = z.infer<typeof record>;
export type WorkflowAccessScope = z.infer<typeof accessScope>;
export type WorkflowQueryRequest = { readonly query: WorkflowQuery; readonly scope: WorkflowAccessScope; readonly cursor?: string };
export type WorkflowPage = { readonly records: readonly WorkflowRecord[]; readonly nextCursor: string | null };
export type WorkflowEvaluationClock = { readonly todayIso: string; readonly timeZone: string };
export type WorkflowParseIssue = { readonly path: string; readonly message: string };
export type WorkflowParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly WorkflowParseIssue[] };

export function getWorkflowFieldType(entity: WorkflowEntity, field: string): WorkflowFieldType | null { return WORKFLOW_FIELD_CATALOG[entity].find((item) => item.name === field)?.type ?? null; }
const ops = { text: new Set(["exists", "not_exists", "equals", "not_equals", "contains"]), number: new Set(["exists", "not_exists", "equals", "not_equals", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "between"]), date: new Set(["exists", "not_exists", "equals", "not_equals", "before", "after", "between"]), datetime: new Set(["exists", "not_exists", "equals", "not_equals", "before", "after", "between"]), boolean: new Set(["exists", "not_exists", "equals", "not_equals"]) } as const;
function issue(path: string, message: string): WorkflowParseIssue { return { path, message }; }
function zIssues(error: z.ZodError): WorkflowParseIssue[] { return error.issues.map((item) => issue(item.path.join("."), item.message)); }
function predicateIssues(entity: WorkflowEntity, item: WorkflowPredicate, path: string): WorkflowParseIssue[] {
  const type = getWorkflowFieldType(entity, item.field); if (!type) return [issue(`${path}.field`, "Campo não pertence à entidade")];
  if (!ops[type].has(item.operator)) return [issue(`${path}.operator`, `Operador incompatível com ${type}`)];
  const values = "values" in item ? item.values : "value" in item ? [item.value] : [];
  const invalid = values.some((value) => type === "number" ? typeof value !== "number" : type === "boolean" ? typeof value !== "boolean" : type === "date" ? !(typeof value === "string" ? isoDate.safeParse(value).success : relativeDate.safeParse(value).success) : type === "datetime" ? !(typeof value === "string" ? isoDateTime.safeParse(value).success || isoDate.safeParse(value).success : relativeDate.safeParse(value).success) : typeof value !== "string");
  return invalid ? [issue(path, `Valor incompatível com ${type}`)] : [];
}
function queryIssues(value: WorkflowQuery, path = "query"): WorkflowParseIssue[] {
  const selected = new Set(value.select); const issues: WorkflowParseIssue[] = [];
  if (selected.size !== value.select.length) issues.push(issue(`${path}.select`, "Campos repetidos"));
  value.select.forEach((field, index) => { if (!getWorkflowFieldType(value.entity, field)) issues.push(issue(`${path}.select.${index}`, "Campo não pertence à entidade")); });
  value.filters.forEach((item, index) => { issues.push(...predicateIssues(value.entity, item, `${path}.filters.${index}`)); if (!selected.has(item.field)) issues.push(issue(`${path}.filters.${index}.field`, "Campo filtrado deve estar em select")); }); return issues;
}
export function parseWorkflowQuery(input: unknown): WorkflowParseResult<WorkflowQuery> { const parsed = query.safeParse(input); if (!parsed.success) return { ok: false, issues: zIssues(parsed.error) }; const issues = queryIssues(parsed.data); return issues.length ? { ok: false, issues } : { ok: true, value: parsed.data }; }
export function parseWorkflowAccessScope(input: unknown): WorkflowParseResult<WorkflowAccessScope> { const parsed = accessScope.safeParse(input); return parsed.success ? { ok: true, value: parsed.data } : { ok: false, issues: zIssues(parsed.error) }; }
function validateStages(value: AutomationWorkflowDraft, issues: WorkflowParseIssue[]): void {
  const selected = new Set(value.query.select); const stages = new Set<string>(); const nodes = new Set<string>();
  value.stages.forEach((item, index) => { if (stages.has(item.id)) issues.push(issue(`stages.${index}.id`, "ID de etapa repetido")); else stages.add(item.id); if (nodes.has(item.nodeId)) issues.push(issue(`stages.${index}.nodeId`, "Nó repetido")); else nodes.add(item.nodeId); item.conditions.forEach((condition, c) => { issues.push(...predicateIssues(value.query.entity, condition, `stages.${index}.conditions.${c}`)); if (!selected.has(condition.field)) issues.push(issue(`stages.${index}.conditions.${c}.field`, "Campo condicionado deve estar em select")); }); });
}
export function parseAutomationWorkflowDraft(input: unknown): WorkflowParseResult<AutomationWorkflowDraft> { const parsed = draftDefinition.safeParse(input); if (!parsed.success) return { ok: false, issues: zIssues(parsed.error) }; const issues = queryIssues(parsed.data.query); validateStages(parsed.data, issues); return issues.length ? { ok: false, issues } : { ok: true, value: parsed.data }; }
export function parseAutomationWorkflowDefinition(input: unknown): WorkflowParseResult<AutomationWorkflowDefinition> {
  const parsed = definition.safeParse(input); if (!parsed.success) return { ok: false, issues: zIssues(parsed.error) }; const issues = queryIssues(parsed.data.query); validateStages(parsed.data, issues); if (parsed.data.trigger.kind === "native_event") { const event = parsed.data.trigger.event; const rule = WORKFLOW_NATIVE_EVENT_ENTITY_RULES.find((item) => item.event === event); if (!rule || !rule.entities.some((entity) => entity === parsed.data.query.entity)) issues.push(issue("trigger.event", "Evento nativo incompatível com a entidade")); }
  return issues.length ? { ok: false, issues } : { ok: true, value: parsed.data };
}
export function parseWorkflowRecord(input: unknown): WorkflowParseResult<WorkflowRecord> { const parsed = record.safeParse(input); if (!parsed.success) return { ok: false, issues: zIssues(parsed.error) }; const issues = Object.entries(parsed.data.fields).flatMap(([field, value]) => { const type = getWorkflowFieldType(parsed.data.entity, field); const valid = value === null || type === "text" && typeof value === "string" || type === "number" && typeof value === "number" || type === "boolean" && typeof value === "boolean" || type === "date" && typeof value === "string" && isoDate.safeParse(value).success || type === "datetime" && typeof value === "string" && isoDateTime.safeParse(value).success; return type && valid ? [] : [issue(`fields.${field}`, "Campo ou valor incompatível")]; }); const validId = parsed.data.entity === "receivables" ? receivableId.safeParse(parsed.data.id).success : uuid.safeParse(parsed.data.id).success; if (!validId) issues.push(issue("id", "Identificador incompatível com a entidade")); return issues.length ? { ok: false, issues } : { ok: true, value: parsed.data }; }
export function validateWorkflowStageNodeReferences(value: AutomationWorkflowDefinition, graphNodeIds: ReadonlySet<string>): readonly WorkflowParseIssue[] { return value.stages.flatMap((item, index) => graphNodeIds.has(item.nodeId) ? [] : [issue(`stages.${index}.nodeId`, "Nó não existe no grafo")]); }
function operand(value: unknown, clock: WorkflowEvaluationClock): WorkflowScalar { if (typeof value !== "object" || value === null || !("kind" in value) || !("days" in value) || value.kind !== "today_offset_days" || typeof value.days !== "number") return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null; if (!isoDate.safeParse(clock.todayIso).success) return null; const date = new Date(`${clock.todayIso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + value.days); return date.toISOString().slice(0, 10); }
function localDate(value: string, timeZone: string): string | null { const date = new Date(value); if (!Number.isFinite(date.getTime())) return null; try { const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date); const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value; const year = part("year"); const month = part("month"); const day = part("day"); return year && month && day ? `${year}-${month}-${day}` : null; } catch (error) { if (error instanceof RangeError) return null; throw error; } }
function order(actual: WorkflowScalar, expected: WorkflowScalar, type: WorkflowFieldType | null, clock: WorkflowEvaluationClock): number | null { if (type === "datetime" && typeof actual === "string" && typeof expected === "string") { if (expected.length === 10) { const day = localDate(actual, clock.timeZone); return day ? day.localeCompare(expected) : null; } const a = Date.parse(actual); const b = Date.parse(expected); return Number.isFinite(a) && Number.isFinite(b) ? a - b : null; } if (type === "date" && typeof actual === "string" && typeof expected === "string") return actual.localeCompare(expected); if (typeof actual === "number" && typeof expected === "number") return actual - expected; if (typeof actual === "string" && typeof expected === "string") return actual.localeCompare(expected); return null; }
function evaluates(value: WorkflowRecord, item: WorkflowPredicate, clock: WorkflowEvaluationClock): boolean { const actual = value.fields[item.field]; const type = getWorkflowFieldType(value.entity, item.field); if (item.operator === "exists") return actual !== undefined && actual !== null && actual !== ""; if (item.operator === "not_exists") return actual === undefined || actual === null || actual === ""; if (item.operator === "between") { const lower = order(actual ?? null, operand(item.values[0], clock), type, clock); const upper = order(actual ?? null, operand(item.values[1], clock), type, clock); return lower !== null && upper !== null && lower >= 0 && upper <= 0; } if (!("value" in item)) return false; const expected = operand(item.value, clock); const compared = order(actual ?? null, expected, type, clock); const temporal = type === "date" || type === "datetime"; switch (item.operator) { case "equals": return temporal ? compared === 0 : actual === expected; case "not_equals": return temporal ? compared !== 0 : actual !== expected; case "contains": return typeof actual === "string" && typeof expected === "string" && actual.includes(expected); case "greater_than": case "after": return compared !== null && compared > 0; case "greater_than_or_equal": return compared !== null && compared >= 0; case "less_than": case "before": return compared !== null && compared < 0; case "less_than_or_equal": return compared !== null && compared <= 0; } }
function evaluate(value: WorkflowRecord, items: readonly WorkflowPredicate[], clock: WorkflowEvaluationClock): boolean { return items.every((item) => evaluates(value, item, clock)); }
export function evaluateWorkflowFilters(value: WorkflowRecord, filters: readonly WorkflowFilter[], clock: WorkflowEvaluationClock): boolean { return evaluate(value, filters, clock); }
export function evaluateWorkflowConditions(value: WorkflowRecord, conditions: readonly WorkflowCondition[], clock: WorkflowEvaluationClock): boolean { return evaluate(value, conditions, clock); }
