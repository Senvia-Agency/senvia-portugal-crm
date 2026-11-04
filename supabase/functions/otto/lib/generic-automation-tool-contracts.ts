import { z } from "https://esm.sh/zod@3.25.76";

import {
  AUTOMATION_GRAPH_LIMITS,
  AUTOMATION_REENTRY_POLICIES,
  AUTOMATION_FLOW_STATUSES,
  CREATABLE_AUTOMATION_TRIGGERS,
} from "./generic-automation-schema.ts";

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(160);
const description = z.string().max(2_000).nullable();
const timestamp = z.string().min(1).max(100);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const quietHours = z.object({
  enabled: z.boolean().optional(),
  start: time.optional(),
  end: time.optional(),
}).strict().refine((value) => value.enabled !== true || Boolean(value.start && value.end));

export const automationListArgsSchema = z.object({
  status: z.enum(AUTOMATION_FLOW_STATUSES).optional(),
  max_results: z.number().int().min(1).max(50).optional(),
}).strict();

export const automationFlowIdArgsSchema = z.object({ flow_id: uuid }).strict();

export const createAutomationDraftArgsSchema = z.object({
  name,
  description: description.optional(),
  trigger_type: z.enum(CREATABLE_AUTOMATION_TRIGGERS),
  graph: z.unknown().optional(),
  entry_node_id: z.string().trim().min(1).max(AUTOMATION_GRAPH_LIMITS.maxIdentifierLength).optional(),
  reentry_policy: z.enum(AUTOMATION_REENTRY_POLICIES).optional(),
  quiet_hours: quietHours.nullable().optional(),
  max_steps_per_run: z.number().int().min(1).max(AUTOMATION_GRAPH_LIMITS.maxStepsPerRun).optional(),
  folder_id: uuid.nullable().optional(),
}).strict();

export const updateAutomationDraftArgsSchema = z.object({
  flow_id: uuid,
  expected_version: z.number().int().positive(),
  expected_updated_at: timestamp,
  name: name.optional(),
  description: description.optional(),
  graph: z.unknown().optional(),
  entry_node_id: z.string().trim().min(1).max(AUTOMATION_GRAPH_LIMITS.maxIdentifierLength).optional(),
  reentry_policy: z.enum(AUTOMATION_REENTRY_POLICIES).optional(),
  quiet_hours: quietHours.nullable().optional(),
  max_steps_per_run: z.number().int().min(1).max(AUTOMATION_GRAPH_LIMITS.maxStepsPerRun).optional(),
  folder_id: uuid.nullable().optional(),
}).strict().refine((value) => [
  value.name,
  value.description,
  value.graph,
  value.entry_node_id,
  value.reentry_policy,
  value.quiet_hours,
  value.max_steps_per_run,
  value.folder_id,
].some((item) => item !== undefined));

export const automationConcurrencyArgsSchema = z.object({
  flow_id: uuid,
  expected_version: z.number().int().positive(),
  expected_updated_at: timestamp,
}).strict();

export const confirmedAutomationActivationArgsSchema = automationConcurrencyArgsSchema.extend({
  activation_snapshot_digest: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export type CreateAutomationDraftArgs = z.infer<typeof createAutomationDraftArgsSchema>;
export type UpdateAutomationDraftArgs = z.infer<typeof updateAutomationDraftArgsSchema>;
export type AutomationConcurrencyArgs = z.infer<typeof automationConcurrencyArgsSchema>;
export type ConfirmedAutomationActivationArgs = z.infer<typeof confirmedAutomationActivationArgsSchema>;

export function parseAutomationArgs<T>(schema: z.ZodType<T>, args: unknown): T | null {
  const parsed = schema.safeParse(args);
  return parsed.success ? parsed.data : null;
}

export const FLOW_ID_PARAMETERS = {
  type: "object",
  properties: { flow_id: { type: "string", format: "uuid", description: "UUID do fluxo" } },
  required: ["flow_id"],
  additionalProperties: false,
} as const;

export const CONCURRENCY_PARAMETERS = {
  type: "object",
  properties: {
    flow_id: { type: "string", format: "uuid", description: "UUID do fluxo" },
    expected_version: { type: "integer", minimum: 1, description: "Versão devolvida pela última leitura" },
    expected_updated_at: { type: "string", description: "updated_at exato devolvido pela última leitura" },
  },
  required: ["flow_id", "expected_version", "expected_updated_at"],
  additionalProperties: false,
} as const;

export const GRAPH_PARAMETER = {
  type: "object",
  description: "Grafo nativo completo. Consulta get_automation_builder_schema antes de o construir.",
  properties: {
    nodes: { type: "array", items: { type: "object" } },
    edges: { type: "array", items: { type: "object" } },
  },
  required: ["nodes", "edges"],
  additionalProperties: false,
} as const;
