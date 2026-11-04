import type { Tool, ToolContext } from "../types.ts";
import {
  CAMPAIGN_COLUMNS,
  UUID_RE,
  boolRecordArg,
  campaignAudienceArgs,
  campaignContentDigest,
  configuredBrevo,
  confirmationPreview,
  isRecord,
  resultError,
  resolveAudience,
  stringArg,
  stringArrayArg,
  stringRecordArg,
  verifyAudienceDigest,
} from "./marketing-shared.ts";

const CAMPAIGN_PERMISSION = { module: "marketing" as const, subarea: "campaigns" as const };

function campaignId(args: Readonly<Record<string, unknown>>): string | null {
  const id = stringArg(args, "campaign_id");
  return id && UUID_RE.test(id) ? id : null;
}

async function campaignForOrg(ctx: ToolContext, id: string) {
  return ctx.supabaseAdmin
    .from("email_campaigns")
    .select(CAMPAIGN_COLUMNS)
    .eq("organization_id", ctx.orgId)
    .eq("id", id)
    .maybeSingle();
}

async function templateForOrg(ctx: ToolContext, id: string) {
  return ctx.supabaseAdmin
    .from("email_templates")
    .select("id, organization_id, subject, html_content, is_active, updated_at")
    .eq("organization_id", ctx.orgId)
    .eq("id", id)
    .maybeSingle();
}

async function applyAudienceSettings(
  args: Readonly<Record<string, unknown>>,
  settingsData: Record<string, string>,
  ctx: ToolContext,
): Promise<{ readonly ok: true; readonly settingsData: Record<string, string> } | { readonly ok: false; readonly result: Record<string, unknown> }> {
  const listIds = stringArrayArg(args, "list_ids");
  const listId = stringArg(args, "list_id");
  const contactIds = stringArrayArg(args, "contact_ids");
  const audienceInput: Readonly<Record<string, unknown>> = listIds.length > 0 || listId || contactIds.length > 0
    ? { list_ids: listIds, list_id: listId, contact_ids: contactIds }
    : {};
  if (Object.keys(audienceInput).length === 0) return { ok: true, settingsData };
  const resolved = await resolveAudience(audienceInput, ctx);
  if (!resolved.ok) return resolved;
  const next = { ...settingsData };
  if (resolved.audience.listIds.length > 0) {
    next.audience_mode = "list";
    next.audience_list_ids = JSON.stringify(resolved.audience.listIds);
  } else {
    next.audience_mode = "individual";
    next.audience_selected_clients = JSON.stringify(resolved.audience.contacts.map((contact) => ({
      id: `marketing_${contact.id}`,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      company: contact.company,
      status: "active",
      organization_id: ctx.orgId,
    })));
  }
  return { ok: true, settingsData: next };
}

function launchPreview() {
  return {
    kind: "confirmation_required" as const,
    preview: async (args: Readonly<Record<string, unknown>>, ctx: ToolContext) => {
      const id = campaignId(args);
      if (!id) return null;
      const campaign = await campaignForOrg(ctx, id);
      if (!campaign.data || campaign.data.status !== "draft") return null;
      const stored = campaignAudienceArgs(campaign.data.settings_data);
      const explicit = stringArrayArg(args, "contact_ids").length > 0 || stringArrayArg(args, "list_ids").length > 0 || Boolean(stringArg(args, "list_id"));
      const input = explicit ? args : stored;
      const audience = await resolveAudience(input, ctx);
      if (!audience.ok) return null;
      if (typeof campaign.data.updated_at !== "string") return null;
      const scheduledInput = stringArg(args, "scheduled_at");
      const scheduledDate = scheduledInput ? new Date(scheduledInput) : null;
      if (scheduledDate && Number.isNaN(scheduledDate.getTime())) return null;
      let templateVersion: string | null = null;
      let previewSubject = campaign.data.subject || "";
      let previewHtml = campaign.data.html_content || "";
      if (campaign.data.template_id) {
        const template = await templateForOrg(ctx, campaign.data.template_id);
        if (!template.data || template.data.is_active !== true || typeof template.data.updated_at !== "string") return null;
        templateVersion = template.data.updated_at;
        previewSubject = template.data.subject;
        previewHtml = template.data.html_content;
      }
      const scheduledAt = scheduledDate?.toISOString() ?? "agora";
      return {
        title: "Lançar campanha de email",
        summary: `Colocar a campanha “${campaign.data.name}” em fila para ${audience.audience.contacts.length} contacto(s) subscrito(s), com processamento agendado para ${scheduledAt}. O provider não será chamado pelo Otto nesta etapa.
Destinatários: ${audience.audience.contacts.map((contact) => `${contact.name} <${contact.email}>`).join("; ")}
Assunto: ${previewSubject}
Conteúdo HTML: ${previewHtml}
Opções: ${JSON.stringify(campaign.data.settings || {})}
Complementos e parâmetros: ${JSON.stringify(campaign.data.settings_data || {})}`,
        destination: "/marketing/campaigns" as const,
        preparedArgs: {
          campaign_id: id,
          campaign_updated_at: campaign.data.updated_at,
          contact_ids: audience.audience.contacts.map((contact) => contact.id).sort(),
          audience_digest: audience.audience.digest,
          ...(scheduledDate ? { scheduled_at: scheduledDate.toISOString() } : {}),
          ...(templateVersion ? { template_updated_at: templateVersion } : {}),
        },
      };
    },
  };
}

export const marketingCampaignWriteTools: Tool[] = [
  {
    name: "create_email_campaign_draft",
    description: "Criar um rascunho de campanha de email nos registos nativos; não agenda nem envia.",
    module: "marketing",
    permission: { ...CAMPAIGN_PERMISSION, action: "create" },
    isWrite: true,
    confirmation: confirmationPreview("Criar rascunho de campanha", "Criar um rascunho de campanha de email editável na organização atual.", "/marketing/campaigns"),
    parameters: { type: "object", properties: { name: { type: "string" }, template_id: { type: "string" }, subject: { type: "string" }, html_content: { type: "string" }, settings: { type: "object" }, settings_data: { type: "object" }, list_id: { type: "string" }, list_ids: { type: "array", items: { type: "string" } }, contact_ids: { type: "array", items: { type: "string" } } }, required: ["name"] },
    execute: async (args, ctx) => {
      const name = stringArg(args, "name");
      if (!name) return resultError("O nome da campanha é obrigatório.", "campaign_fields_missing");
      const templateId = stringArg(args, "template_id");
      if (templateId && !UUID_RE.test(templateId)) return resultError("Indica um ID de template válido.", "invalid_template_id");
      if (templateId) {
        const template = await templateForOrg(ctx, templateId);
        if (template.error) return resultError("Não foi possível validar o template.");
        if (!template.data) return resultError("Template não encontrado nesta organização.", "template_scope_mismatch");
      }
      const subject = stringArg(args, "subject");
      const html = stringArg(args, "html_content");
      if (!templateId && (!subject || !html)) return resultError("Uma campanha sem template precisa de assunto e HTML.", "campaign_content_missing");
      const audienceSettings = await applyAudienceSettings(args, stringRecordArg(args, "settings_data"), ctx);
      if (!audienceSettings.ok) return audienceSettings.result;
      const payload = {
        organization_id: ctx.orgId,
        name,
        template_id: templateId || null,
        subject,
        html_content: html,
        settings: boolRecordArg(args, "settings"),
        settings_data: audienceSettings.settingsData,
        status: "draft",
        created_by: ctx.userId,
      };
      const { data, error } = await ctx.supabaseAdmin.from("email_campaigns").insert(payload).select(CAMPAIGN_COLUMNS).single();
      if (error) return resultError("Não foi possível criar o rascunho de campanha.");
      return { success: true, campaign: data, destination: "/marketing/campaigns" };
    },
  },
  {
    name: "update_email_campaign_draft",
    description: "Editar um rascunho de campanha de email da organização atual; campanhas já processadas não são reescritas.",
    module: "marketing",
    permission: { ...CAMPAIGN_PERMISSION, action: "edit" },
    isWrite: true,
    confirmation: confirmationPreview("Editar rascunho de campanha", "Guardar as alterações no rascunho de campanha selecionado.", "/marketing/campaigns"),
    parameters: { type: "object", properties: { campaign_id: { type: "string" }, name: { type: "string" }, template_id: { type: ["string", "null"] }, subject: { type: ["string", "null"] }, html_content: { type: ["string", "null"] }, settings: { type: "object" }, settings_data: { type: "object" }, list_id: { type: "string" }, list_ids: { type: "array", items: { type: "string" } }, contact_ids: { type: "array", items: { type: "string" } } }, required: ["campaign_id"] },
    execute: async (args, ctx) => {
      const id = campaignId(args);
      if (!id) return resultError("Indica um ID de campanha válido.", "invalid_campaign_id");
      const current = await campaignForOrg(ctx, id);
      if (current.error) return resultError("Não foi possível ler a campanha.");
      if (!current.data) return resultError("Campanha não encontrada nesta organização.", "campaign_not_found");
      if (current.data.status !== "draft") return resultError("Só é possível editar campanhas em rascunho.", "campaign_not_editable");
      const update: Record<string, unknown> = {};
      if (typeof args.name === "string" && args.name.trim()) update.name = args.name.trim();
      if ("template_id" in args) {
        const templateId = stringArg(args, "template_id");
        if (templateId && !UUID_RE.test(templateId)) return resultError("Indica um ID de template válido.", "invalid_template_id");
        if (templateId) {
          const template = await templateForOrg(ctx, templateId);
          if (template.error || !template.data) return resultError("Template não encontrado nesta organização.", "template_scope_mismatch");
        }
        update.template_id = templateId;
      }
      if ("subject" in args) update.subject = typeof args.subject === "string" ? args.subject.trim() || null : null;
      if ("html_content" in args) update.html_content = typeof args.html_content === "string" ? args.html_content.trim() || null : null;
      if (isRecord(args.settings)) update.settings = boolRecordArg(args, "settings");
      const audienceSettings = await applyAudienceSettings(args, stringRecordArg(args, "settings_data"), ctx);
      if (!audienceSettings.ok) return audienceSettings.result;
      if (Object.keys(audienceSettings.settingsData).length > 0 || "settings_data" in args) update.settings_data = audienceSettings.settingsData;
      if (Object.keys(update).length === 0) return resultError("Indica pelo menos um campo para alterar.", "campaign_fields_missing");
      const { data, error } = await ctx.supabaseAdmin.from("email_campaigns").update(update).eq("organization_id", ctx.orgId).eq("id", id).select(CAMPAIGN_COLUMNS).single();
      if (error) return resultError("Não foi possível atualizar o rascunho de campanha.");
      return { success: true, campaign: data, destination: "/marketing/campaigns" };
    },
  },
  {
    name: "delete_email_campaign_draft",
    description: "Eliminar um rascunho de campanha ou uma campanha agendada ainda não processada da organização atual.",
    module: "marketing",
    permission: { ...CAMPAIGN_PERMISSION, action: "delete" },
    isWrite: true,
    confirmation: confirmationPreview("Eliminar campanha", "Eliminar a campanha selecionada e, se ainda estiver agendada, a sua fila pendente.", "/marketing/campaigns"),
    parameters: { type: "object", properties: { campaign_id: { type: "string" } }, required: ["campaign_id"] },
    execute: async (args, ctx) => {
      const id = campaignId(args);
      if (!id) return resultError("Indica um ID de campanha válido.", "invalid_campaign_id");
      const current = await campaignForOrg(ctx, id);
      if (current.error) return resultError("Não foi possível ler a campanha.");
      if (!current.data) return resultError("Campanha não encontrada nesta organização.", "campaign_not_found");
      if (current.data.status === "sending" || current.data.status === "sent") return resultError("Campanhas já processadas não podem ser eliminadas por esta operação.", "campaign_not_deletable");
      if (current.data.status === "scheduled") {
        const { error: queueError } = await ctx.supabaseAdmin.from("email_sends").delete().eq("organization_id", ctx.orgId).eq("campaign_id", id).eq("status", "queued");
        if (queueError) return resultError("Não foi possível cancelar a fila pendente da campanha.");
      }
      const { error } = await ctx.supabaseAdmin.from("email_campaigns").delete().eq("organization_id", ctx.orgId).eq("id", id);
      if (error) return resultError("Não foi possível eliminar a campanha.");
      return { success: true, deleted_campaign_id: id, destination: "/marketing/campaigns" };
    },
  },
  {
    name: "launch_email_campaign",
    description: "Colocar uma campanha em fila nativa para o processador de campanhas. Requer confirmação única, valida consentimento e nunca chama o provider diretamente.",
    module: "marketing",
    permission: { ...CAMPAIGN_PERMISSION, action: "send" },
    isWrite: true,
    confirmation: launchPreview(),
    parameters: { type: "object", properties: { campaign_id: { type: "string" }, scheduled_at: { type: "string" }, list_id: { type: "string" }, list_ids: { type: "array", items: { type: "string" } }, contact_ids: { type: "array", items: { type: "string" } } }, required: ["campaign_id"] },
    execute: async (args, ctx) => {
      const id = campaignId(args);
      if (!id) return resultError("Indica um ID de campanha válido.", "invalid_campaign_id");
      const current = await campaignForOrg(ctx, id);
      if (current.error) return resultError("Não foi possível ler a campanha.");
      if (!current.data) return resultError("Campanha não encontrada nesta organização.", "campaign_not_found");
      if (current.data.status === "scheduled") return resultError("A campanha já está agendada.", "campaign_already_scheduled");
      if (current.data.status !== "draft") return resultError("Só é possível lançar campanhas em rascunho.", "campaign_not_launchable");
      const expectedCampaignVersion = stringArg(args, "campaign_updated_at");
      if (!expectedCampaignVersion || current.data.updated_at !== expectedCampaignVersion) {
        return resultError("A campanha mudou desde a pré-visualização. Pede uma nova confirmação antes de lançar.", "campaign_changed");
      }
      const audience = await resolveAudience(args, ctx);
      if (!audience.ok) return audience.result;
      const changed = verifyAudienceDigest(args, audience.audience);
      if (changed) return changed;
      const configured = await configuredBrevo(ctx);
      if (!configured.ok) return configured.result;
      let subject = typeof current.data.subject === "string" ? current.data.subject : "";
      let html = typeof current.data.html_content === "string" ? current.data.html_content : "";
      if (current.data.template_id) {
        const template = await templateForOrg(ctx, current.data.template_id);
        if (template.error) return resultError("Não foi possível validar o template da campanha.");
        if (!template.data || template.data.is_active !== true) return resultError("O template da campanha não existe ou não está ativo.", "template_not_sendable");
        const expectedTemplateVersion = stringArg(args, "template_updated_at");
        if (!expectedTemplateVersion || template.data.updated_at !== expectedTemplateVersion) {
          return resultError("O template da campanha mudou desde a pré-visualização. Pede uma nova confirmação antes de lançar.", "template_changed");
        }
        subject = template.data.subject;
        html = template.data.html_content;
      }
      if (!subject.trim() || !html.trim()) return resultError("A campanha precisa de assunto e conteúdo antes de ser lançada.", "campaign_content_missing");
      const settings = boolRecordArg({ settings: current.data.settings }, "settings");
      const settingsData = stringRecordArg({ settings_data: current.data.settings_data }, "settings_data");
      const contentDigest = await campaignContentDigest({
        subject,
        htmlContent: html,
        settings,
        settingsData,
      });
      const scheduledInput = stringArg(args, "scheduled_at");
      const scheduledAt = scheduledInput ? new Date(scheduledInput) : new Date();
      if (Number.isNaN(scheduledAt.getTime())) return resultError("A data de agendamento não é válida.", "invalid_schedule");
      const { error: scheduleError } = await ctx.supabaseAdmin.rpc("schedule_otto_campaign_atomic", {
        p_organization_id: ctx.orgId, p_campaign_id: id,
        p_expected_updated_at: expectedCampaignVersion,
        p_scheduled_at: scheduledAt.toISOString(),
        p_snapshot: { subject, html_content: html, settings, settings_data: settingsData, digest: contentDigest },
        p_recipients: audience.audience.contacts.map((contact) => ({ id: contact.id, email: contact.email, name: contact.name })),
      });
      if (scheduleError) return resultError("Não foi possível agendar: a campanha ou os contactos mudaram, ou a fila já existe. Nenhuma fila parcial foi gravada.", "campaign_schedule_failed");
      const updated = await campaignForOrg(ctx, id);
      return { success: true, campaign: updated.data, queued_count: audience.audience.contacts.length, audience_digest: audience.audience.digest, processing: "scheduled_campaign_worker", destination: "/marketing/campaigns" };
    },
  },
];
