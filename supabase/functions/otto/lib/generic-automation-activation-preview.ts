import {
  parseAutomationWebhookBody,
  parseAutomationWebhookHeaders,
} from "./generic-automation-config.ts";
import { parseAutomationWorkflowDefinition } from "../../_shared/automation-workflow-contract.ts";
import { buildConfiguredWorkflowPreview } from "./generic-automation-workflow-preview.ts";
import {
  digestPendingActionPayload,
  parsePendingActionPayload,
} from "./pending-action-payload.ts";
import type { NativeAutomationFlow } from "./generic-automation-store.ts";
import type { ToolContext } from "./types.ts";

type CompleteConfiguredWorkflowPreview = Extract<
  Awaited<ReturnType<typeof buildConfiguredWorkflowPreview>>,
  { readonly ok: true }
>;

type ActivationSnapshot = {
  readonly ok: true;
  readonly digest: string;
  readonly summary: string;
  readonly configuredWorkflowPreview?: CompleteConfiguredWorkflowPreview;
};

export function configuredWorkflowPreviewLines(
  preview: CompleteConfiguredWorkflowPreview,
): readonly string[] {
  const immediateActions = preview.stages.reduce(
    (total, stage) => total + stage.immediateRecords,
    0,
  );
  const deferredActions = preview.stages.reduce(
    (total, stage) => total + stage.deferredRecords,
    0,
  );
  if (preview.certainty === "exact") {
    return [
      `Prévia exata em ${preview.observedLocalDate} (${preview.timeZone}): ${preview.scannedRecords} registos avaliados, ${preview.recordsWithImmediateActions} com ações imediatas e ${immediateActions} ações imediatas elegíveis.`,
      ...preview.stages.map((stage) =>
        `• Etapa ${stage.stageId}: ${stage.immediateRecords} ações imediatas elegíveis.`
      ),
      "Os dados serão revalidados no momento de cada ação.",
    ];
  }
  return [
    `Prévia em ${preview.observedLocalDate} (${preview.timeZone}): ${preview.scannedRecords} registos avaliados, ${preview.recordsWithImmediateActions} com ações imediatas e até ${preview.recordsWithDeferredActions} com ações depois de esperas.`,
    `Ações elegíveis: ${immediateActions} imediatas e até ${deferredActions} depois de esperas.`,
    ...preview.stages.map((stage) =>
      `• Etapa ${stage.stageId}: ${stage.immediateRecords} imediatas e até ${stage.deferredRecords} depois de esperas.`
    ),
    "As ações depois de esperas são um limite superior; condições, alterações dos dados e revalidação podem reduzir esse total.",
  ];
}

type ActivationSnapshotFailure = {
  readonly ok: false;
  readonly reasonCode?: "catchup_estimate_unavailable";
};

type EmailTemplateSnapshot = {
  readonly id: string;
  readonly name: string;
  readonly subject: string;
  readonly htmlContent: string;
  readonly updatedAt: string;
};

type ChannelSnapshot = {
  readonly id: string;
  readonly label: string;
  readonly status: string;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function replyOptions(
  config: Readonly<Record<string, unknown>>,
  waitsForReply: boolean,
): string {
  if ((!waitsForReply && config.wait_reply !== true) || !Array.isArray(config.rules)) return "";
  const style = config.options_style === "number" || config.options_style === "none"
    ? config.options_style
    : "emoji";
  if (style === "none") return "";
  const rows = config.rules.flatMap((rule, index) => {
    if (!isRecord(rule)) return [];
    const label = nonEmptyString(rule.label);
    const keywords = Array.isArray(rule.keywords)
      ? rule.keywords.filter((value): value is string => typeof value === "string")
      : [];
    const text = label ?? keywords[0] ?? "";
    const number = String(index + 1);
    const marker = style === "number"
      ? `${number}.`
      : [...number].map((digit) => `${digit}️⃣`).join("");
    return [`${marker} ${text}`];
  });
  return rows.length > 0 ? `\n\n${rows.join("\n")}` : "";
}

function bodyFields(value: unknown, prefix = ""): readonly string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => bodyFields(item, `${prefix}[]`));
  }
  if (!isRecord(value)) return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const nested = bodyFields(child, path);
    return nested.length > 0 ? nested : [path];
  });
}

async function loadTemplates(
  ctx: ToolContext,
  ids: readonly string[],
): Promise<ReadonlyMap<string, EmailTemplateSnapshot> | null> {
  if (ids.length === 0) return new Map();
  const { data, error } = await ctx.supabaseAdmin.from("email_templates")
    .select("id,name,subject,html_content,updated_at")
    .eq("organization_id", ctx.orgId)
    .in("id", ids);
  if (error || !Array.isArray(data)) return null;
  const templates = new Map<string, EmailTemplateSnapshot>();
  for (const row of data) {
    if (!isRecord(row)
      || typeof row.id !== "string"
      || typeof row.name !== "string"
      || typeof row.subject !== "string"
      || typeof row.html_content !== "string"
      || typeof row.updated_at !== "string") return null;
    templates.set(row.id, {
      id: row.id,
      name: row.name,
      subject: row.subject,
      htmlContent: row.html_content,
      updatedAt: row.updated_at,
    });
  }
  return ids.every((id) => templates.has(id)) ? templates : null;
}

async function loadChannels(
  ctx: ToolContext,
  ids: readonly string[],
): Promise<ReadonlyMap<string, ChannelSnapshot> | null> {
  if (ids.length === 0) return new Map();
  const { data, error } = await ctx.supabaseUser.from("messaging_channels")
    .select("id,label,status,channel_type,provider,archived_at,metadata_public")
    .eq("organization_id", ctx.orgId)
    .in("id", ids);
  if (error || !Array.isArray(data)) return null;
  const channels = new Map<string, ChannelSnapshot>();
  for (const row of data) {
    if (!isRecord(row)
      || typeof row.id !== "string"
      || typeof row.label !== "string"
      || typeof row.status !== "string"
      || row.channel_type !== "whatsapp"
      || row.provider !== "evolution"
      || row.archived_at !== null
      || !isRecord(row.metadata_public)
      || row.metadata_public.native_inbox !== true) return null;
    channels.set(row.id, { id: row.id, label: row.label, status: row.status });
  }
  return ids.every((id) => channels.has(id)) ? channels : null;
}

export async function buildAutomationActivationSnapshot(
  ctx: ToolContext,
  flow: NativeAutomationFlow,
): Promise<ActivationSnapshot | ActivationSnapshotFailure> {
  let configuredPreview = null;
  if (flow.trigger_type === "configured_workflow") {
    const definition = parseAutomationWorkflowDefinition(flow.entryNode.config.workflow);
    if (!definition.ok) return { ok: false };
    const preview = await buildConfiguredWorkflowPreview(ctx, flow, definition.value, {
      executionVersion: flow.version + 1,
    });
    if (!preview.ok) return { ok: false, reasonCode: "catchup_estimate_unavailable" };
    configuredPreview = preview;
  }
  const templateIds = unique(flow.graph.nodes.flatMap(({ type, config }) => {
    const id = type === "send_email" ? nonEmptyString(config.template_id) : null;
    return id ? [id] : [];
  }));
  const channelIds = unique(flow.graph.nodes.flatMap(({ type, config }) => {
    const id = (type === "send_whatsapp" || type === "wait_reply") ? nonEmptyString(config.channel_id) : null;
    return id ? [id] : [];
  }));
  const [templates, channels] = await Promise.all([
    loadTemplates(ctx, templateIds),
    loadChannels(ctx, channelIds),
  ]);
  if (!templates || !channels) return { ok: false };

  const effects: string[] = [];
  for (const node of flow.graph.nodes) {
    const config = node.config;
    if (node.type === "send_whatsapp" || node.type === "wait_reply") {
      const message = nonEmptyString(node.type === "wait_reply" ? config.question : config.message) ?? "";
      const media = node.type === "send_whatsapp"
        ? config.media ?? nonEmptyString(config.media_url)
        : null;
      if (!message && !media) continue;
      const channelId = nonEmptyString(config.channel_id);
      const channel = channelId ? channels.get(channelId) : null;
      if (!channelId || !channel || channel.status !== "connected") return { ok: false };
      effects.push([
        `• ${node.id} · WhatsApp`,
        `  Destinatário: telefone do contacto inscrito no fluxo.`,
        `  Canal: ${channel.label} (${channel.id}, ${channel.status}).`,
        `  Mensagem: ${message}${replyOptions(config, node.type === "wait_reply")}`,
        `  Anexo: ${media ? JSON.stringify(media) : "nenhum"}.`,
      ].join("\n"));
      continue;
    }
    if (node.type === "send_email") {
      const templateId = nonEmptyString(config.template_id);
      const template = templateId ? templates.get(templateId) : null;
      if (templateId && !template) return { ok: false };
      const subject = template?.subject ?? nonEmptyString(config.subject);
      const html = template?.htmlContent ?? nonEmptyString(config.html);
      if (!subject || !html) return { ok: false };
      effects.push([
        `• ${node.id} · Email`,
        `  Destinatário: email do contacto inscrito no fluxo.`,
        `  Template: ${template ? `${template.name} (${template.id})` : "conteúdo definido no fluxo"}.`,
        `  Assunto: ${subject}`,
        `  Conteúdo HTML: ${html}`,
      ].join("\n"));
      continue;
    }
    if (node.type === "webhook") {
      const url = nonEmptyString(config.url);
      const method = nonEmptyString(config.method) ?? "POST";
      const headers = parseAutomationWebhookHeaders(config.headers);
      const body = parseAutomationWebhookBody(config.body);
      if (!url || headers === null || body === undefined) return { ok: false };
      const fields = nonEmptyString(config.body)
        ? unique(bodyFields(body))
        : ["run_id", "flow_id", "contact.*"];
      effects.push([
        `• ${node.id} · Webhook`,
        `  Destino: ${url}`,
        `  Método: ${method}`,
        `  Cabeçalhos: ${Object.keys(headers).length > 0 ? Object.keys(headers).join(", ") : "Content-Type"}.`,
        `  Dados enviados: ${fields.join(", ")}.`,
      ].join("\n"));
    }
  }

  const snapshotPayload = parsePendingActionPayload({
    flow_id: flow.id,
    version: flow.version,
    updated_at: flow.updated_at,
    graph: flow.graph,
    templates: [...templates.values()],
    channels: [...channels.values()],
    ...(configuredPreview ? { configured_workflow_preview: configuredPreview } : {}),
  });
  if (!snapshotPayload.ok) return { ok: false };
  const digest = await digestPendingActionPayload(snapshotPayload.value);
  return {
    ok: true,
    digest,
    ...(configuredPreview ? { configuredWorkflowPreview: configuredPreview } : {}),
    summary: [
      `Ativar “${flow.name}” na versão ${flow.version}.`,
      `Gatilho: ${flow.trigger_type}.`,
      ...(configuredPreview ? configuredWorkflowPreviewLines(configuredPreview) : []),
      effects.length > 0 ? `Efeitos externos configurados:\n${effects.join("\n")}` : "Este fluxo não tem envios externos configurados.",
      configuredPreview
        ? "A ativação não executa estes efeitos agora. O motor volta a consultar os dados e revalida a elegibilidade antes de cada ação."
        : "A ativação só inscreve eventos futuros e não executa estes efeitos agora.",
    ].join("\n"),
  };
}
