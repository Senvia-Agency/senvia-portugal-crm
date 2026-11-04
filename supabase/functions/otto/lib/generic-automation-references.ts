import type { ToolContext, ToolResult } from "./types.ts";
import type { NativeAutomationGraph } from "./generic-automation-validation.ts";

type ReferenceKind = "channel" | "template" | "list" | "member" | "stage" | "form" | "folder";
type ResourceRequest = {
  readonly kind: ReferenceKind;
  readonly table: string;
  readonly column: string;
  readonly values: readonly string[];
  readonly select: string;
  readonly accept?: (row: Readonly<Record<string, unknown>>) => boolean;
};
type ResourceCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly unavailable: boolean; readonly kind: ReferenceKind };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function stringValue(config: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = config[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function checkOwnedResource(ctx: ToolContext, request: ResourceRequest): Promise<ResourceCheck> {
  if (request.values.length === 0) return { ok: true };
  if (request.kind === "member"
    && ctx.dataScope !== "all"
    && request.values.some((value) => !ctx.scopeUserIds.has(value))) {
    return { ok: false, unavailable: false, kind: request.kind };
  }
  const client = request.kind === "channel" ? ctx.supabaseUser : ctx.supabaseAdmin;
  const { data, error } = await client
    .from(request.table)
    .select(request.select)
    .eq("organization_id", ctx.orgId)
    .in(request.column, request.values);
  const rows: unknown = data;
  if (error || !Array.isArray(rows)) return { ok: false, unavailable: true, kind: request.kind };
  const found = new Set<string>();
  for (const row of rows) {
    if (!isRecord(row) || request.accept?.(row) === false) continue;
    const value = row[request.column];
    if (typeof value === "string") found.add(value);
  }
  return request.values.every((value) => found.has(value))
    ? { ok: true }
    : { ok: false, unavailable: false, kind: request.kind };
}

function channelIsNative(row: Readonly<Record<string, unknown>>): boolean {
  const metadata = row.metadata_public;
  return row.channel_type === "whatsapp"
    && row.provider === "evolution"
    && row.archived_at === null
    && isRecord(metadata)
    && metadata.native_inbox === true;
}

function collectReferences(graph: NativeAutomationGraph, folderId: string | null): readonly ResourceRequest[] {
  const channels: string[] = [];
  const templates: string[] = [];
  const lists: string[] = [];
  const members: string[] = [];
  const stageIds: string[] = [];
  const stageKeys: string[] = [];
  const forms: string[] = [];
  for (const node of graph.nodes) {
    const cfg = node.config;
    const channel = stringValue(cfg, "channel_id");
    const template = stringValue(cfg, "template_id");
    const list = stringValue(cfg, "list_id");
    const member = stringValue(cfg, "user_id") ?? stringValue(cfg, "assigned_to");
    const stage = stringValue(cfg, "stage");
    const form = stringValue(cfg, "form_slug");
    if (channel) channels.push(channel);
    if (template) templates.push(template);
    if (list) lists.push(list);
    if (member) members.push(member);
    if (stage) stageKeys.push(stage);
    if (form) forms.push(form);
    for (const key of ["from_stage_id", "to_stage_id", "stage_id"] as const) {
      const stageId = stringValue(cfg, key);
      if (stageId) stageIds.push(stageId);
    }
    if (node.type === "condition" && cfg.field === "status") {
      const conditionStage = stringValue(cfg, "value");
      if (conditionStage) stageKeys.push(conditionStage);
    }
  }
  return [
    { kind: "channel", table: "messaging_channels", column: "id", values: unique(channels), select: "id,organization_id,channel_type,provider,archived_at,metadata_public", accept: channelIsNative },
    { kind: "template", table: "email_templates", column: "id", values: unique(templates), select: "id,organization_id" },
    { kind: "list", table: "client_lists", column: "id", values: unique(lists), select: "id,organization_id" },
    { kind: "member", table: "organization_members", column: "user_id", values: unique(members), select: "user_id,organization_id,is_active", accept: (row) => row.is_active === true },
    { kind: "stage", table: "pipeline_stages", column: "id", values: unique(stageIds), select: "id,organization_id" },
    { kind: "stage", table: "pipeline_stages", column: "key", values: unique(stageKeys), select: "key,organization_id" },
    { kind: "form", table: "forms", column: "slug", values: unique(forms), select: "slug,organization_id,is_active", accept: (row) => row.is_active === true },
    { kind: "folder", table: "automation_folders", column: "id", values: folderId ? [folderId] : [], select: "id,organization_id" },
  ];
}

const LABELS: Readonly<Record<ReferenceKind, string>> = {
  channel: "caixa de WhatsApp",
  template: "template de email",
  list: "lista",
  member: "membro",
  stage: "etapa",
  form: "formulário",
  folder: "pasta",
};

export async function validateAutomationReferences(
  ctx: ToolContext,
  graph: NativeAutomationGraph,
  folderId: string | null,
): Promise<ToolResult | null> {
  const checks = await Promise.all(collectReferences(graph, folderId).map((request) => checkOwnedResource(ctx, request)));
  const failed = checks.find((check) => !check.ok);
  if (!failed || failed.ok) return null;
  if (failed.unavailable) {
    return {
      error: "Não foi possível validar as referências da automação.",
      reason_code: "automation_reference_lookup_failed",
      _instruction: "A operação NÃO foi executada. Não inventes a validade dos recursos associados.",
    };
  }
  return {
    error: `A ${LABELS[failed.kind]} indicada não existe, não está disponível ou pertence a outra organização.`,
    reason_code: "automation_reference_invalid",
    reference_kind: failed.kind,
    _instruction: "A operação NÃO foi executada. Escolhe um recurso da organização atual.",
  };
}
