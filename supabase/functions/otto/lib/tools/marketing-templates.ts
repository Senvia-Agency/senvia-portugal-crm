import type { Tool, ToolContext } from "../types.ts";
import {
  MARKETING_TEMPLATE_COLUMNS,
  MARKETING_TEMPLATE_DETAIL_COLUMNS,
  UUID_RE,
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

const TEMPLATE_PERMISSION = { module: "marketing" as const, subarea: "templates" as const };

function templateArgs(args: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const name = stringArg(args, "name");
  const subject = stringArg(args, "subject");
  const html = stringArg(args, "html_content");
  const category = stringArg(args, "category");
  const categoryId = stringArg(args, "category_id");
  if (name) values.name = name;
  if (subject) values.subject = subject;
  if (html !== null) values.html_content = html;
  if (category) values.category = category;
  if (categoryId && UUID_RE.test(categoryId)) values.category_id = categoryId;
  if (args.variables !== undefined) values.variables = stringArrayArg(args, "variables");
  if (typeof args.is_active === "boolean") values.is_active = args.is_active;
  if (typeof args.automation_enabled === "boolean") values.automation_enabled = args.automation_enabled;
  if (typeof args.automation_trigger_type === "string") values.automation_trigger_type = args.automation_trigger_type.trim() || null;
  if (args.automation_trigger_config !== undefined) values.automation_trigger_config = stringRecordArg(args, "automation_trigger_config");
  if (typeof args.automation_delay_minutes === "number" && Number.isInteger(args.automation_delay_minutes) && args.automation_delay_minutes >= 0) values.automation_delay_minutes = args.automation_delay_minutes;
  return values;
}

async function templateForOrg(ctx: ToolContext, templateId: string) {
  return ctx.supabaseAdmin
    .from("email_templates")
    .select(MARKETING_TEMPLATE_DETAIL_COLUMNS)
    .eq("organization_id", ctx.orgId)
    .eq("id", templateId)
    .maybeSingle();
}

async function categoryBelongsToOrg(ctx: ToolContext, categoryId: string): Promise<boolean> {
  const { data, error } = await ctx.supabaseAdmin
    .from("email_template_categories")
    .select("id")
    .eq("organization_id", ctx.orgId)
    .eq("id", categoryId)
    .eq("is_active", true)
    .maybeSingle();
  return !error && Boolean(data?.id);
}

function sendPreview() {
  return {
    kind: "confirmation_required" as const,
    preview: async (args: Readonly<Record<string, unknown>>, ctx: ToolContext) => {
      const templateId = stringArg(args, "template_id");
      if (!templateId || !UUID_RE.test(templateId)) return null;
      const audience = await resolveAudience(args, ctx);
      if (!audience.ok) return null;
      const { data: template } = await templateForOrg(ctx, templateId);
      if (!template || template.is_active !== true || typeof template.updated_at !== "string") return null;
      const configured = await configuredBrevo(ctx);
      if (!configured.ok) return null;
      return {
        title: "Enviar template de email",
        summary: `Enviar o template “${template.name}” para ${audience.audience.contacts.length} contacto(s) subscrito(s). O envio usa a integração Brevo configurada da organização.
Destinatários: ${audience.audience.contacts.map((contact) => `${contact.name} <${contact.email}>`).join("; ")}
Assunto: ${template.subject}
Conteúdo HTML: ${template.html_content}`,
        destination: "/marketing/templates" as const,
        preparedArgs: {
          template_id: templateId,
          template_updated_at: template.updated_at,
          contact_ids: audience.audience.contacts.map((contact) => contact.id).sort(),
          audience_digest: audience.audience.digest,
        },
      };
    },
  };
}

export const marketingTemplateTools: Tool[] = [
  {
    name: "list_email_templates",
    description: "Listar templates de email da organização atual, sem devolver o HTML completo.",
    module: "marketing",
    permission: { ...TEMPLATE_PERMISSION, action: "view" },
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const { data, error } = await ctx.supabaseAdmin
        .from("email_templates")
        .select(MARKETING_TEMPLATE_COLUMNS)
        .eq("organization_id", ctx.orgId)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) return resultError("Não foi possível listar os templates.");
      return { results: data ?? [], count: (data ?? []).length, destination: "/marketing/templates" };
    },
  },
  {
    name: "get_email_template",
    description: "Obter um template de email da organização atual, incluindo o conteúdo editável.",
    module: "marketing",
    permission: { ...TEMPLATE_PERMISSION, action: "view" },
    parameters: { type: "object", properties: { template_id: { type: "string", description: "ID do template" } }, required: ["template_id"] },
    execute: async (args, ctx) => {
      const templateId = stringArg(args, "template_id");
      if (!templateId || !UUID_RE.test(templateId)) return resultError("Indica um ID de template válido.", "invalid_template_id");
      const { data, error } = await templateForOrg(ctx, templateId);
      if (error) return resultError("Não foi possível ler o template.");
      if (!data) return resultError("Template não encontrado nesta organização.", "template_not_found");
      return { template: data, destination: "/marketing/templates" };
    },
  },
  {
    name: "create_email_template",
    description: "Criar um template de email editável na organização atual; não envia email.",
    module: "marketing",
    permission: { ...TEMPLATE_PERMISSION, action: "create" },
    isWrite: true,
    confirmation: confirmationPreview("Criar template de email", "Criar um novo template de email editável na organização atual.", "/marketing/templates"),
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" }, subject: { type: "string" }, html_content: { type: "string" }, category: { type: "string" }, category_id: { type: "string" }, variables: { type: "array", items: { type: "string" } }, is_active: { type: "boolean" }, automation_enabled: { type: "boolean" }, automation_trigger_type: { type: "string" }, automation_trigger_config: { type: "object" }, automation_delay_minutes: { type: "integer" },
      },
      required: ["name", "subject", "html_content"],
    },
    execute: async (args, ctx) => {
      const values = templateArgs(args);
      if (typeof values.name !== "string" || typeof values.subject !== "string" || typeof values.html_content !== "string") return resultError("Nome, assunto e HTML são obrigatórios.", "template_fields_missing");
      if (typeof values.category_id === "string" && !await categoryBelongsToOrg(ctx, values.category_id)) return resultError("A categoria não pertence à organização atual.", "category_scope_mismatch");
      const { data, error } = await ctx.supabaseAdmin
        .from("email_templates")
        .insert({ ...values, organization_id: ctx.orgId, created_by: ctx.userId })
        .select(MARKETING_TEMPLATE_DETAIL_COLUMNS)
        .single();
      if (error) return resultError("Não foi possível criar o template.");
      return { success: true, template: data, destination: "/marketing/templates" };
    },
  },
  {
    name: "update_email_template",
    description: "Editar os campos suportados de um template de email da organização atual; não envia email.",
    module: "marketing",
    permission: { ...TEMPLATE_PERMISSION, action: "edit" },
    isWrite: true,
    confirmation: confirmationPreview("Editar template de email", "Guardar as alterações no template de email da organização atual.", "/marketing/templates"),
    parameters: { type: "object", properties: { template_id: { type: "string" }, name: { type: "string" }, subject: { type: "string" }, html_content: { type: "string" }, category: { type: "string" }, category_id: { type: "string" }, variables: { type: "array", items: { type: "string" } }, is_active: { type: "boolean" }, automation_enabled: { type: "boolean" }, automation_trigger_type: { type: "string" }, automation_trigger_config: { type: "object" }, automation_delay_minutes: { type: "integer" } }, required: ["template_id"] },
    execute: async (args, ctx) => {
      const templateId = stringArg(args, "template_id");
      if (!templateId || !UUID_RE.test(templateId)) return resultError("Indica um ID de template válido.", "invalid_template_id");
      const current = await templateForOrg(ctx, templateId);
      if (current.error) return resultError("Não foi possível ler o template.");
      if (!current.data) return resultError("Template não encontrado nesta organização.", "template_not_found");
      const values = templateArgs(args);
      delete values.category_id;
      const requestedCategory = stringArg(args, "category_id");
      if (requestedCategory) {
        if (!UUID_RE.test(requestedCategory) || !await categoryBelongsToOrg(ctx, requestedCategory)) return resultError("A categoria não pertence à organização atual.", "category_scope_mismatch");
        values.category_id = requestedCategory;
      }
      if (Object.keys(values).length === 0) return resultError("Indica pelo menos um campo para alterar.", "template_fields_missing");
      const { data, error } = await ctx.supabaseAdmin
        .from("email_templates")
        .update(values)
        .eq("organization_id", ctx.orgId)
        .eq("id", templateId)
        .select(MARKETING_TEMPLATE_DETAIL_COLUMNS)
        .single();
      if (error) return resultError("Não foi possível atualizar o template.");
      return { success: true, template: data, destination: "/marketing/templates" };
    },
  },
  {
    name: "delete_email_template",
    description: "Eliminar um template de email da organização atual.",
    module: "marketing",
    permission: { ...TEMPLATE_PERMISSION, action: "delete" },
    isWrite: true,
    confirmation: confirmationPreview("Eliminar template de email", "Eliminar o template selecionado da organização atual.", "/marketing/templates"),
    parameters: { type: "object", properties: { template_id: { type: "string" } }, required: ["template_id"] },
    execute: async (args, ctx) => {
      const templateId = stringArg(args, "template_id");
      if (!templateId || !UUID_RE.test(templateId)) return resultError("Indica um ID de template válido.", "invalid_template_id");
      const current = await templateForOrg(ctx, templateId);
      if (current.error) return resultError("Não foi possível ler o template.");
      if (!current.data) return resultError("Template não encontrado nesta organização.", "template_not_found");
      const { error } = await ctx.supabaseAdmin.from("email_templates").delete().eq("organization_id", ctx.orgId).eq("id", templateId);
      if (error) return resultError("Não foi possível eliminar o template.");
      return { success: true, deleted_template_id: templateId, destination: "/marketing/templates" };
    },
  },
  {
    name: "send_email_template",
    description: "Enviar um template ativo para contactos de marketing subscritos. Requer confirmação única; usa o Edge autenticado de envio e nunca expõe a chave Brevo.",
    module: "marketing",
    permission: { ...TEMPLATE_PERMISSION, action: "send" },
    isWrite: true,
    confirmation: sendPreview(),
    parameters: {
      type: "object",
      properties: { template_id: { type: "string" }, contact_ids: { type: "array", items: { type: "string" } }, list_id: { type: "string" }, list_ids: { type: "array", items: { type: "string" } } },
      required: ["template_id"],
    },
    execute: async (args, ctx) => {
      const templateId = stringArg(args, "template_id");
      if (!templateId || !UUID_RE.test(templateId)) return resultError("Indica um ID de template válido.", "invalid_template_id");
      const audience = await resolveAudience(args, ctx);
      if (!audience.ok) return audience.result;
      const changed = verifyAudienceDigest(args, audience.audience);
      if (changed) return changed;
      const configured = await configuredBrevo(ctx);
      if (!configured.ok) return configured.result;
      const { data: template, error: templateError } = await templateForOrg(ctx, templateId);
      if (templateError) return resultError("Não foi possível ler o template.");
      if (!template || template.is_active !== true) return resultError("O template não existe ou não está ativo.", "template_not_sendable");
      const expectedTemplateVersion = stringArg(args, "template_updated_at");
      if (!expectedTemplateVersion || template.updated_at !== expectedTemplateVersion) {
        return resultError("O template mudou desde a pré-visualização. Pede uma nova confirmação antes de enviar.", "template_changed");
      }
      const { data, error } = await ctx.supabaseUser.functions.invoke("send-template-email", {
        body: {
          organizationId: ctx.orgId,
          sourceTemplateId: templateId,
          subject: template.subject,
          htmlContent: template.html_content,
          recipients: audience.audience.contacts.map((contact) => ({
            email: contact.email,
            name: contact.name,
            marketingContactId: contact.id,
            variables: { nome: contact.name, email: contact.email ?? "", empresa: contact.company ?? "", telefone: contact.phone ?? "" },
          })),
        },
      });
      if (error) return resultError("O envio não foi confirmado pelo Edge de email.", "send_not_confirmed");
      const summary = isRecord(data) && isRecord(data.summary) ? data.summary : {};
      const total = typeof summary.total === "number" ? summary.total : audience.audience.contacts.length;
      const sent = typeof summary.sent === "number" ? summary.sent : 0;
      const failed = typeof summary.failed === "number" ? summary.failed : Math.max(0, total - sent);
      return { success: failed < total, summary: { total, sent, failed }, audience_digest: audience.audience.digest, destination: "/marketing/reports" };
    },
  },
];
