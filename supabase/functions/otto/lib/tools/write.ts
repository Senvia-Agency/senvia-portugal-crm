// Basic write tools: create a lead, create a client, move a lead between
// pipeline stages. All gated by permission (admins bypass) and audited.
import type { Tool } from "../types.ts";

// Resolve the pipeline stage key to use. If the caller passed one, validate it;
// otherwise fall back to the first stage by position.
async function resolveStageKey(ctx: any, requested?: string): Promise<{ key: string | null; error?: string }> {
  const { data: stages } = await ctx.supabaseAdmin
    .from("pipeline_stages")
    .select("key, name, position")
    .eq("organization_id", ctx.orgId)
    .order("position");
  if (!stages || stages.length === 0) return { key: null, error: "A organização ainda não tem etapas de pipeline configuradas." };
  if (requested) {
    const match = stages.find((s: any) => s.key === requested || s.name?.toLowerCase() === requested.toLowerCase());
    if (!match) return { key: null, error: `Etapa "${requested}" não existe. Etapas válidas: ${stages.map((s: any) => s.name).join(", ")}.` };
    return { key: match.key };
  }
  return { key: stages[0].key };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function textToEmailHtml(value: string): string {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

export const writeTools: Tool[] = [
  {
    name: "create_lead",
    description: "Criar uma nova lead no CRM. Usa APENAS depois de confirmares os dados com o utilizador. Nome, email e telefone são obrigatórios.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome completo da lead" },
        email: { type: "string", description: "Email da lead" },
        phone: { type: "string", description: "Telefone da lead (com indicativo)" },
        company_name: { type: "string", description: "Nome da empresa (opcional)" },
        value: { type: "number", description: "Valor estimado do negócio (opcional)" },
        stage: { type: "string", description: "Etapa do pipeline (opcional, default: primeira etapa)" },
        notes: { type: "string", description: "Notas adicionais (opcional)" },
      },
      required: ["name", "email", "phone"],
    },
    permission: { module: "leads", subarea: "kanban", action: "add" },
    isWrite: true,
    execute: async (args, ctx) => {
      if (!args.name || !args.email || !args.phone) {
        return { error: "Faltam dados", _instruction: "Pede o nome, email e telefone em falta antes de criar a lead. NÃO inventes dados." };
      }
      const { key, error: stageErr } = await resolveStageKey(ctx, args.stage);
      if (stageErr) return { error: stageErr, _instruction: "Informa o utilizador deste problema com a etapa do pipeline." };
      const { data, error } = await ctx.supabaseAdmin
        .from("leads")
        .insert({
          organization_id: ctx.orgId,
          name: args.name,
          email: args.email,
          phone: args.phone,
          company_name: args.company_name || null,
          value: typeof args.value === "number" ? args.value : null,
          status: key,
          notes: args.notes || null,
          source: "otto",
        })
        .select("id, name, status")
        .single();
      if (error) {
        return { error: error.message, _instruction: "ERRO ao criar a lead. Informa o utilizador que houve um problema técnico. NÃO digas que foi criada." };
      }
      return {
        success: true,
        lead_id: data.id,
        _instruction: `Lead **${data.name}** criada com sucesso. Informa o utilizador e oferece um link para a ver. [link:Ver Leads|/leads]`,
      };
    },
  },
  {
    name: "create_client",
    description: "Criar um novo cliente no CRM. Usa APENAS depois de confirmares os dados. O nome é obrigatório.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome do cliente" },
        email: { type: "string", description: "Email (opcional)" },
        phone: { type: "string", description: "Telefone (opcional)" },
        nif: { type: "string", description: "NIF (opcional)" },
        company: { type: "string", description: "Empresa (opcional)" },
        notes: { type: "string", description: "Notas (opcional)" },
      },
      required: ["name"],
    },
    permission: { module: "clients", subarea: "list", action: "add" },
    isWrite: true,
    execute: async (args, ctx) => {
      if (!args.name) return { error: "Nome em falta", _instruction: "Pede o nome do cliente antes de criar." };
      const { data, error } = await ctx.supabaseAdmin
        .from("crm_clients")
        .insert({
          organization_id: ctx.orgId,
          name: args.name,
          email: args.email || null,
          phone: args.phone || null,
          nif: args.nif || null,
          company: args.company || null,
          notes: args.notes || null,
          source: "otto",
        })
        .select("id, name")
        .single();
      if (error) {
        return { error: error.message, _instruction: "ERRO ao criar o cliente. Informa o utilizador. NÃO digas que foi criado." };
      }
      return {
        success: true,
        client_id: data.id,
        _instruction: `Cliente **${data.name}** criado com sucesso. Informa o utilizador. [link:Ver Clientes|/clients]`,
      };
    },
  },
  {
    name: "update_lead_status",
    description: "Mover uma lead para outra etapa do pipeline. Precisa do ID da lead (obtém-no com search_leads) e da etapa destino.",
    parameters: {
      type: "object",
      properties: {
        lead_id: { type: "string", description: "UUID da lead" },
        stage: { type: "string", description: "Etapa destino (nome ou key da etapa)" },
      },
      required: ["lead_id", "stage"],
    },
    permission: { module: "leads", subarea: "kanban", action: "edit" },
    isWrite: true,
    execute: async (args, ctx) => {
      const { key, error: stageErr } = await resolveStageKey(ctx, args.stage);
      if (stageErr || !key) return { error: stageErr || "Etapa inválida", _instruction: "Informa o utilizador da etapa inválida e lista as válidas." };
      const { data, error } = await ctx.supabaseAdmin
        .from("leads")
        .update({ status: key })
        .eq("organization_id", ctx.orgId)
        .eq("id", args.lead_id)
        .select("id, name, status")
        .maybeSingle();
      if (error) return { error: error.message, _instruction: "ERRO ao mover a lead. Informa o utilizador." };
      if (!data) return { error: "Lead não encontrada", _instruction: "A lead não existe nesta organização. Informa o utilizador. NÃO inventes." };
      return {
        success: true,
        _instruction: `Lead **${data.name}** movida para a etapa solicitada. Informa o utilizador. [link:Ver Pipeline|/leads]`,
      };
    },
  },
  {
    name: "create_email_automation",
    description: "Criar um template de email com automação ativa. Usa quando o utilizador pedir para enviar email automático após criação/mudança de estado de lead, cliente, venda ou proposta. Confirma assunto, mensagem, gatilho, estado destino e atraso antes de criar.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome interno do template/automação" },
        subject: { type: "string", description: "Assunto do email" },
        message: { type: "string", description: "Corpo do email em texto simples ou HTML" },
        trigger_type: {
          type: "string",
          enum: ["lead_created", "lead_status_changed", "client_created", "client_status_changed", "sale_status_changed", "proposal_created", "proposal_status_changed"],
          description: "Gatilho da automação",
        },
        to_status: { type: "string", description: "Estado/etapa destino quando o gatilho depende de estado. Pode ser nome ou key, ex: Contacto" },
        from_status: { type: "string", description: "Estado/etapa origem opcional. Usa 'any' ou omite para qualquer origem" },
        delay_minutes: { type: "number", description: "Atraso em minutos antes de enviar. Ex: 4320 para 3 dias" },
        category: { type: "string", enum: ["general", "proposal", "welcome", "followup", "promotion"], description: "Categoria do template" },
      },
      required: ["name", "subject", "message", "trigger_type"],
    },
    permission: { module: "marketing", subarea: "templates", action: "create" },
    isWrite: true,
    execute: async (args, ctx) => {
      const triggerType = String(args.trigger_type || "");
      const statusTriggers = new Set(["lead_status_changed", "client_status_changed", "sale_status_changed", "proposal_status_changed"]);
      const automationConfig: Record<string, string> = {};

      if (statusTriggers.has(triggerType)) {
        if (!args.to_status) {
          return { error: "Estado destino em falta", _instruction: "Pede o estado/etapa destino antes de criar a automação. NÃO inventes." };
        }

        if (triggerType === "lead_status_changed" || triggerType === "client_status_changed") {
          const { key, error } = await resolveStageKey(ctx, String(args.to_status));
          if (error || !key) return { error: error || "Estado destino inválido", _instruction: "Informa o utilizador que essa etapa não existe e pede uma etapa válida." };
          automationConfig.to_status = key;

          if (args.from_status && String(args.from_status).toLowerCase() !== "any") {
            const from = await resolveStageKey(ctx, String(args.from_status));
            if (from.error || !from.key) return { error: from.error || "Estado origem inválido", _instruction: "Informa o utilizador que essa etapa de origem não existe." };
            automationConfig.from_status = from.key;
          }
        } else {
          automationConfig.to_status = String(args.to_status);
          if (args.from_status && String(args.from_status).toLowerCase() !== "any") {
            automationConfig.from_status = String(args.from_status);
          }
        }
      }

      const rawMessage = String(args.message || "").trim();
      const htmlContent = /<\/?[a-z][\s\S]*>/i.test(rawMessage) ? rawMessage : textToEmailHtml(rawMessage);
      const delayMinutes = Number.isFinite(Number(args.delay_minutes)) ? Math.max(0, Math.round(Number(args.delay_minutes))) : 0;

      const { data, error } = await ctx.supabaseAdmin
        .from("email_templates")
        .insert({
          organization_id: ctx.orgId,
          name: args.name,
          subject: args.subject,
          html_content: htmlContent,
          category: args.category || "followup",
          variables: [],
          is_active: true,
          created_by: ctx.userId,
          automation_enabled: true,
          automation_trigger_type: triggerType,
          automation_trigger_config: automationConfig,
          automation_delay_minutes: delayMinutes,
        })
        .select("id, name, subject, automation_trigger_type, automation_trigger_config, automation_delay_minutes")
        .single();

      if (error) {
        return { error: error.message, _instruction: "ERRO ao criar a automação. Informa o utilizador que houve um problema técnico. NÃO digas que foi criada." };
      }

      return {
        success: true,
        template_id: data.id,
        template: data,
        _instruction: `Automação **${data.name}** criada e ativa. Informa o utilizador. [link:Ver Templates|/marketing/templates]`,
      };
    },
  },
];
