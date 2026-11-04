import { z } from "https://esm.sh/zod@3.25.76";

import {
  AUTOMATION_CONDITION_OPERATORS,
  AUTOMATION_GRAPH_LIMITS,
  AUTOMATION_WAIT_UNITS,
  type NativeAutomationNodeType,
} from "./generic-automation-schema.ts";

const text = z.string().max(AUTOMATION_GRAPH_LIMITS.maxTextLength);
const identifier = z.string().trim().min(1).max(AUTOMATION_GRAPH_LIMITS.maxIdentifierLength);
const uuid = z.string().uuid();
const positiveNumber = z.number().finite().positive();
const waitUnit = z.enum(AUTOMATION_WAIT_UNITS);
const ruleSchema = z.object({
  id: identifier,
  label: z.string().max(20),
  keywords: z.array(z.string().trim().min(1).max(100)).max(50),
}).strict();
const mediaSchema = z.object({
  url: z.string().url().max(2_000),
  path: z.string().max(500).optional(),
  mimetype: z.string().max(200).optional(),
  filename: z.string().max(500).optional(),
  kind: z.enum(["image", "video", "document"]).optional(),
  size: z.number().int().nonnegative().max(16 * 1024 * 1024).optional(),
}).strict();
const legacyTimeoutSchema = z.object({ value: positiveNumber, unit: waitUnit }).strict();
const emptyConfigSchema = z.object({}).strict();
const leadCreatedSchema = z.object({ source: z.string().max(500).optional() }).strict();
const stageTriggerSchema = z.object({ from_stage_id: uuid.optional(), to_stage_id: uuid.optional() }).strict();
const formTriggerSchema = z.object({ form_slug: z.string().trim().min(1).max(100).optional() }).strict();
const messageTriggerSchema = z.object({
  channel_id: uuid.optional(),
  buffer_seconds: z.number().int().min(0).max(60).optional(),
}).strict();
const keywordTriggerSchema = z.object({
  keywords: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
}).strict();
const saleStatusTriggerSchema = z.object({
  to_status: z.enum(["pending", "active", "completed", "cancelled"]).optional(),
}).strict();
const listTriggerSchema = z.object({ list_id: uuid.optional() }).strict();
const replyFields = {
  use_buttons: z.boolean().optional(),
  timeout_amount: positiveNumber.optional(),
  timeout_unit: waitUnit.optional(),
  timeout: legacyTimeoutSchema.optional(),
  rules: z.array(ruleSchema).max(20).optional(),
  options_style: z.enum(["emoji", "number", "none"]).optional(),
};
const whatsappSchema = z.object({
  channel_id: uuid.optional(),
  message: text.optional(),
  media: mediaSchema.optional(),
  media_url: z.string().url().max(2_000).optional(),
  wait_reply: z.boolean().optional(),
  ...replyFields,
}).strict();
const emailSchema = z.object({ template_id: uuid.optional(), subject: text.optional(), html: text.optional() }).strict();
const waitSchema = z.object({ duration: positiveNumber.optional(), amount: positiveNumber.optional(), unit: waitUnit.optional() }).strict();
const waitReplySchema = z.object({ question: text.optional(), ...replyFields }).strict();
const conditionSchema = z.object({
  field: z.string().max(200).optional(),
  operator: z.enum(AUTOMATION_CONDITION_OPERATORS).optional(),
  value: text.optional(),
}).strict();
const moveStageSchema = z.object({ stage: z.string().max(200).optional(), stage_id: uuid.optional() }).strict();
const assignUserSchema = z.object({ user_id: uuid.optional() }).strict();
const listActionSchema = z.object({ list_id: uuid.optional() }).strict();
const taskSchema = z.object({
  title: text.optional(),
  description: text.optional(),
  due_in_days: z.number().int().min(0).max(3_650).optional(),
  user_id: uuid.optional(),
  assigned_to: uuid.optional(),
}).strict();
const webhookSchema = z.object({
  url: z.string().max(2_000).optional(),
  method: z.enum(["POST", "GET", "PUT", "PATCH"]).optional(),
  headers: text.optional(),
  body: text.optional(),
}).strict();
const endSchema = z.object({ reason: z.string().max(500).optional() }).strict();

export type AutomationConfigIssue = { readonly code: string; readonly message: string };
export type ConfigurableAutomationNode = {
  readonly type: NativeAutomationNodeType;
  readonly config: Readonly<Record<string, unknown>>;
};

function schemaAccepts(type: NativeAutomationNodeType, config: Readonly<Record<string, unknown>>): boolean {
  switch (type) {
    case "lead_created": return leadCreatedSchema.safeParse(config).success;
    case "lead_status_changed": return stageTriggerSchema.safeParse(config).success;
    case "form_submitted": return formTriggerSchema.safeParse(config).success;
    case "message_received": return messageTriggerSchema.safeParse(config).success;
    case "whatsapp_keyword": return keywordTriggerSchema.safeParse(config).success;
    case "sale_status_changed": return saleStatusTriggerSchema.safeParse(config).success;
    case "list_joined": return listTriggerSchema.safeParse(config).success;
    case "send_whatsapp": return whatsappSchema.safeParse(config).success;
    case "send_email": return emailSchema.safeParse(config).success;
    case "wait": return waitSchema.safeParse(config).success;
    case "wait_reply": return waitReplySchema.safeParse(config).success;
    case "condition": return conditionSchema.safeParse(config).success;
    case "move_stage": return moveStageSchema.safeParse(config).success;
    case "assign_user": return assignUserSchema.safeParse(config).success;
    case "add_to_list": return listActionSchema.safeParse(config).success;
    case "create_task": return taskSchema.safeParse(config).success;
    case "webhook": return webhookSchema.safeParse(config).success;
    case "end": return endSchema.safeParse(config).success;
    case "lead_created_hot":
    case "lead_created_warm":
    case "lead_created_cold":
    case "sale_renewal_due_today":
    case "sale_renewal_due_in_2_days":
    case "sale_renewal_overdue":
    case "sale_payment_overdue_10d":
    case "referral_month_earned":
    case "referral_month_started":
    case "referral_month_ending_2d":
    case "subscription_renewal_due_2d":
    case "client_created":
    case "client_status_changed":
    case "proposal_created":
    case "proposal_status_changed":
    case "sale_created":
    case "trial_started":
    case "trial_day_3":
    case "trial_day_7":
    case "trial_expiring_3d":
    case "trial_expiring_1d":
    case "trial_expired":
    case "trial_inactive_48h":
    case "stripe_subscription_created":
    case "stripe_subscription_renewed":
    case "stripe_subscription_past_due":
    case "stripe_subscription_canceled": return emptyConfigSchema.safeParse(config).success;
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

const issue = (code: string, message: string): AutomationConfigIssue => ({ code, message });
const trimmed = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const parsedRules = (config: Readonly<Record<string, unknown>>) => z.array(ruleSchema).safeParse(config.rules);
const forbiddenWebhookHeaders = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
]);
const forbiddenWebhookKeys = new Set([
  "api_key",
  "apikey",
  "authorization",
  "client_secret",
  "cookie",
  "credential",
  "credentials",
  "password",
  "private_key",
  "refresh_token",
  "secret",
  "token",
]);

function normalizedKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonConfig(value: unknown): unknown | undefined {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value.replace(/\{\{[^{}]*\}\}/g, "0"));
  } catch {
    return undefined;
  }
}

function containsForbiddenWebhookKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenWebhookKey);
  if (!isPlainRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => (
    forbiddenWebhookKeys.has(normalizedKey(key)) || containsForbiddenWebhookKey(child)
  ));
}

export function parseAutomationWebhookHeaders(value: unknown): Readonly<Record<string, string>> | null {
  const parsed = parseJsonConfig(value);
  if (!isPlainRecord(parsed)) return null;
  const headers: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(parsed)) {
    const normalized = key.trim().toLowerCase();
    if (!normalized
      || forbiddenWebhookHeaders.has(normalized)
      || typeof rawValue !== "string"
      || /[\r\n]/.test(key)
      || /[\r\n]/.test(rawValue)) return null;
    headers[key] = rawValue;
  }
  return headers;
}

export function parseAutomationWebhookBody(value: unknown): unknown | undefined {
  const parsed = parseJsonConfig(value);
  return parsed === undefined || containsForbiddenWebhookKey(parsed) ? undefined : parsed;
}

export function isJsonAutomationConfigValid(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value !== "string") return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    try {
      JSON.parse(value.replace(/\{\{[^{}]*\}\}/g, "0"));
      return true;
    } catch {
      return false;
    }
  }
}

export function isAutomationWebhookUrlValid(value: unknown): boolean {
  const url = trimmed(value);
  if (!url) return false;
  if (url.includes("{{")) return false;
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:"
      && parsed.username === ""
      && parsed.password === ""
      && hostname !== "localhost"
      && !hostname.endsWith(".localhost")
      && !hostname.endsWith(".local")
      && !hostname.endsWith(".internal")
      && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
      && !hostname.includes(":");
  } catch {
    return false;
  }
}

export function automationNodeBranches(node: ConfigurableAutomationNode): readonly string[] {
  if (node.type === "condition") return ["yes", "no"];
  if (node.type !== "wait_reply" && !(node.type === "send_whatsapp" && node.config.wait_reply === true)) return [];
  const parsed = parsedRules(node.config);
  return parsed.success ? [...parsed.data.map(({ id }) => id), "timeout"] : [];
}

export function validateAutomationNodeConfig(
  node: ConfigurableAutomationNode,
  requireComplete: boolean,
): readonly AutomationConfigIssue[] {
  if (!schemaAccepts(node.type, node.config)) return [issue("invalid_node_config", "A configuração contém campos ou valores não suportados.")];
  if (node.type === "webhook") {
    const webhookIssues: AutomationConfigIssue[] = [];
    if (trimmed(node.config.url) && !isAutomationWebhookUrlValid(node.config.url)) {
      webhookIssues.push(issue("webhook_url_invalid", "Indique um URL HTTPS público, absoluto e sem variáveis no destino."));
    }
    if (parseAutomationWebhookHeaders(node.config.headers) === null) {
      webhookIssues.push(issue("webhook_headers_unsafe", "Os cabeçalhos têm de ser JSON com valores de texto e não podem transportar credenciais."));
    }
    if (parseAutomationWebhookBody(node.config.body) === undefined) {
      webhookIssues.push(issue("webhook_body_unsafe", "O corpo tem de ser JSON válido e não pode incluir campos de credenciais."));
    }
    if (webhookIssues.length > 0) return webhookIssues;
  }
  if (!requireComplete) return [];
  const cfg = node.config;
  switch (node.type) {
    case "whatsapp_keyword": return Array.isArray(cfg.keywords) && cfg.keywords.length > 0 ? [] : [issue("keywords_required", "Defina pelo menos uma palavra-chave.")];
    case "sale_status_changed": return trimmed(cfg.to_status) ? [] : [issue("sale_status_required", "Escolha o novo estado da venda.")];
    case "list_joined":
    case "add_to_list": return trimmed(cfg.list_id) ? [] : [issue("list_required", "Escolha uma lista da organização.")];
    case "send_whatsapp": {
      if (!trimmed(cfg.message) && !cfg.media && !trimmed(cfg.media_url)) return [issue("whatsapp_content_required", "Preencha a mensagem ou anexe um ficheiro.")];
      return cfg.wait_reply === true && automationNodeBranches(node).length < 2 ? [issue("reply_rule_required", "Defina pelo menos uma opção de resposta.")] : [];
    }
    case "send_email": return trimmed(cfg.template_id) || (trimmed(cfg.subject) && trimmed(cfg.html)) ? [] : [issue("email_content_required", "Escolha um template ou preencha o assunto e o conteúdo.")];
    case "wait": return typeof cfg.amount === "number" || typeof cfg.duration === "number" ? [] : [issue("wait_duration_required", "Defina a duração da espera.")];
    case "wait_reply": return automationNodeBranches(node).length >= 2 ? [] : [issue("reply_rule_required", "Defina pelo menos uma opção de resposta.")];
    case "condition": {
      const operator = cfg.operator;
      if (!trimmed(cfg.field) || typeof operator !== "string") return [issue("condition_required", "Defina o campo e o operador da condição.")];
      const valueless = ["exists", "not_exists", "in_clients", "in_leads", "in_crm"].includes(operator);
      return valueless || trimmed(cfg.value) ? [] : [issue("condition_value_required", "Defina o valor da condição.")];
    }
    case "move_stage": return trimmed(cfg.stage) ? [] : [issue("stage_required", "Escolha a etapa de destino.")];
    case "assign_user": return trimmed(cfg.user_id) ? [] : [issue("user_required", "Escolha um membro da organização.")];
    case "create_task": return trimmed(cfg.title) ? [] : [issue("task_title_required", "Preencha o título da tarefa.")];
    case "webhook": {
      return isAutomationWebhookUrlValid(cfg.url) ? [] : [issue("webhook_url_invalid", "Indique um URL HTTPS público e absoluto.")];
    }
    default: return [];
  }
}
