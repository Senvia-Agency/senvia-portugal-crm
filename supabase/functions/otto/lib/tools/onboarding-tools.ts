// Onboarding + configuration tools. These mutate org-level settings, so they
// are admin-only and audited. get_onboarding_status is read-only and open to all.
import type { Tool } from "../types.ts";
import { STAGE_LABELS } from "../onboarding.ts";

const VALID_MODULES = [
  "proposals", "calendar", "sales", "ecommerce", "clients",
  "marketing", "finance", "energy", "prospects", "inbox", "leads",
  "automations",
];

// kebab/ascii slug for a pipeline stage key derived from its label.
function slugify(s: string): string {
  return s
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "etapa";
}

export const onboardingTools: Tool[] = [
  {
    name: "get_onboarding_status",
    module: "settings",
    description: "Verificar em que ponto da configuração e ativação está a organização (dados da empresa, pipeline, importar leads, primeiro cliente, primeira venda, primeira proposta, faturação, integrações, equipa). Usa para saber o próximo passo a sugerir.",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const c = ctx.onboarding.checks;
      const steps = [
        { key: "COMPANY_INFO", done: c.company_info },
        { key: "PIPELINE", done: c.pipeline },
        { key: "LEADS_IMPORT", done: c.leads },
        { key: "FIRST_CLIENT", done: c.clients },
        { key: "FIRST_SALE", done: c.sales },
        { key: "FIRST_PROPOSAL", done: c.proposals },
        { key: "INVOICING", done: c.invoicing },
        { key: "INTEGRATIONS", done: c.integrations },
        { key: "TEAM", done: c.team },
      ];
      const doneCount = steps.filter((s) => s.done).length;
      const next = steps.find((s) => !s.done);
      return {
        current_stage: ctx.onboarding.current_stage,
        completed: ctx.onboarding.completed,
        progress: `${doneCount}/${steps.length}`,
        steps: steps.map((s) => ({ stage: STAGE_LABELS[s.key], done: s.done })),
        next_step: next ? STAGE_LABELS[next.key] : null,
        _instruction: ctx.onboarding.completed
          ? "A configuração está completa. Felicita o utilizador e oferece ajuda no modo suporte."
          : `Próximo passo: ${next ? STAGE_LABELS[next.key] : "concluir"}. Guia o utilizador por esse passo, um de cada vez.`,
      };
    },
  },
  {
    name: "set_company_info",
    module: "settings",
    description: "Definir os dados da empresa: nome, telefone de contacto, email financeiro, nicho de negócio e/ou logótipo (URL). Só preenche os campos fornecidos pelo utilizador.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome da empresa" },
        contact_phone: { type: "string", description: "Telefone de contacto" },
        finance_email: { type: "string", description: "Email para assuntos financeiros" },
        niche: { type: "string", description: "Nicho de negócio (ex: telecom, solar, geral)" },
        logo_url: { type: "string", description: "URL do logótipo (opcional)" },
      },
      required: [],
    },
    adminOnly: true,
    isWrite: true,
    execute: async (args, ctx) => {
      const update: Record<string, any> = {};
      for (const f of ["name", "contact_phone", "finance_email", "niche", "logo_url"]) {
        if (typeof args[f] === "string" && args[f].trim()) update[f] = args[f].trim();
      }
      if (Object.keys(update).length === 0) {
        return { error: "Nada para atualizar", _instruction: "Pergunta ao utilizador que dados da empresa quer definir." };
      }
      const { error } = await ctx.supabaseAdmin.from("organizations").update(update).eq("id", ctx.orgId);
      if (error) return { error: error.message, _instruction: "ERRO ao guardar os dados da empresa. Informa o utilizador." };
      return { success: true, updated: Object.keys(update), _instruction: "Dados da empresa guardados. Confirma ao utilizador e avança para o próximo passo do onboarding." };
    },
  },
  {
    name: "setup_pipeline_stages",
    module: "settings",
    description: "Criar as etapas do pipeline de leads pela ordem dada. Usa APENAS quando a organização ainda não tem pipeline configurado (caso contrário, encaminha para Definições > Pipeline para evitar perder dados).",
    parameters: {
      type: "object",
      properties: {
        stages: {
          type: "array",
          description: "Lista ordenada de nomes das etapas, ex: ['Novo', 'Contactado', 'Proposta', 'Ganho', 'Perdido']",
          items: { type: "string" },
        },
      },
      required: ["stages"],
    },
    adminOnly: true,
    isWrite: true,
    execute: async (args, ctx) => {
      const names: string[] = Array.isArray(args.stages) ? args.stages.filter((s: any) => typeof s === "string" && s.trim()) : [];
      if (names.length < 2) return { error: "Etapas insuficientes", _instruction: "Pede ao utilizador pelo menos 2 etapas para o pipeline." };
      const { data: existing } = await ctx.supabaseAdmin
        .from("pipeline_stages").select("id").eq("organization_id", ctx.orgId).limit(1);
      if (existing && existing.length > 0) {
        return {
          error: "Pipeline já existe",
          _instruction: "A organização já tem pipeline configurado. NÃO o substituas. Encaminha o utilizador para Definições > Definições Gerais > Pipeline para o editar manualmente. [link:Ir para Definições|/settings]",
        };
      }
      const usedKeys = new Set<string>();
      const rows = names.map((name, i) => {
        let key = slugify(name);
        while (usedKeys.has(key)) key = `${key}_${i}`;
        usedKeys.add(key);
        return {
          organization_id: ctx.orgId,
          name: name.trim(),
          key,
          position: i,
          is_final_positive: false,
          is_final_negative: false,
        };
      });
      // Mark the last stage as the positive-final ("won") stage. The user can
      // adjust which stage is the lost/negative one later in Definições.
      rows[rows.length - 1].is_final_positive = true;
      const { error } = await ctx.supabaseAdmin.from("pipeline_stages").insert(rows);
      if (error) return { error: error.message, _instruction: "ERRO ao criar o pipeline. Informa o utilizador." };
      return { success: true, created: rows.length, _instruction: `Pipeline criado com ${rows.length} etapas. Confirma ao utilizador. [link:Ver Pipeline|/leads]` };
    },
  },
  {
    name: "configure_invoicing",
    module: "settings",
    description: "Configurar a faturação da organização. provider deve ser 'invoicexpress' ou 'keyinvoice'. Para InvoiceXpress são precisos api_key e account_name.",
    parameters: {
      type: "object",
      properties: {
        provider: { type: "string", enum: ["invoicexpress", "keyinvoice"], description: "Fornecedor de faturação" },
        api_key: { type: "string", description: "Chave de API (InvoiceXpress)" },
        account_name: { type: "string", description: "Nome da conta InvoiceXpress (subdomínio)" },
        username: { type: "string", description: "Utilizador (KeyInvoice)" },
        password: { type: "string", description: "Password (KeyInvoice)" },
        company_code: { type: "string", description: "Código da empresa (KeyInvoice)" },
      },
      required: ["provider"],
    },
    adminOnly: true,
    isWrite: true,
    execute: async (args, ctx) => {
      const provider = args.provider;
      const update: Record<string, any> = { billing_provider: provider };
      if (provider === "invoicexpress") {
        if (!args.api_key || !args.account_name) {
          return { error: "Dados em falta", _instruction: "Para InvoiceXpress pede a api_key e o account_name (subdomínio) ao utilizador, um de cada vez." };
        }
        update.invoicexpress_api_key = args.api_key;
        update.invoicexpress_account_name = args.account_name;
      } else if (provider === "keyinvoice") {
        if (!args.username || !args.password) {
          return { error: "Dados em falta", _instruction: "Para KeyInvoice pede o username e a password ao utilizador." };
        }
        update.keyinvoice_username = args.username;
        update.keyinvoice_password = args.password;
        if (args.company_code) update.keyinvoice_company_code = args.company_code;
      } else {
        return { error: "Provider inválido", _instruction: "O fornecedor de faturação tem de ser InvoiceXpress ou KeyInvoice." };
      }
      const { error } = await ctx.supabaseAdmin.from("organizations").update(update).eq("id", ctx.orgId);
      if (error) return { error: error.message, _instruction: "ERRO ao configurar a faturação. Informa o utilizador." };
      return { success: true, _instruction: "Faturação configurada. Confirma ao utilizador e avança no onboarding. [link:Ver Integrações|/settings]" };
    },
  },
  {
    name: "configure_brevo",
    module: "settings",
    description: "Configurar a integração Brevo para email marketing. Precisa da api_key; o sender_email é opcional.",
    parameters: {
      type: "object",
      properties: {
        api_key: { type: "string", description: "Chave de API do Brevo" },
        sender_email: { type: "string", description: "Email remetente verificado no Brevo (opcional)" },
      },
      required: ["api_key"],
    },
    adminOnly: true,
    isWrite: true,
    execute: async (args, ctx) => {
      if (!args.api_key) return { error: "api_key em falta", _instruction: "Pede a chave de API do Brevo ao utilizador." };
      const update: Record<string, any> = { brevo_api_key: args.api_key };
      if (args.sender_email) update.brevo_sender_email = args.sender_email;
      const { error } = await ctx.supabaseAdmin.from("organizations").update(update).eq("id", ctx.orgId);
      if (error) return { error: error.message, _instruction: "ERRO ao configurar o Brevo. Informa o utilizador." };
      return { success: true, _instruction: "Brevo configurado. Confirma ao utilizador. [link:Ver Integrações|/settings]" };
    },
  },
  {
    name: "setup_lead_autoreply",
    module: "settings",
    description: "Configura a RESPOSTA AUTOMÁTICA de WhatsApp aos leads novos: cria/atualiza o formulário de captação com perguntas de qualificação + as regras de IA + as mensagens por temperatura (quente/morno/frio). Usa APENAS depois de mostrares as perguntas, regras e mensagens ao utilizador e ele confirmar. Para a MESMA resposta a todos, põe o mesmo texto nos 3 templates. NOTA: o WhatsApp tem de estar LIGADO à parte para as mensagens saírem.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description: "Perguntas de qualificação a pôr no formulário (3 a 5 ideais). Prefere 'select' com opções para qualificar bem (orçamento, prazo, etc.).",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Texto da pergunta (ex.: 'Qual o teu orçamento?')" },
              type: { type: "string", description: "text | number | select | checkbox | textarea", enum: ["text", "number", "select", "checkbox", "textarea"] },
              options: { type: "array", description: "Opções (só para type 'select')", items: { type: "string" } },
              required: { type: "boolean", description: "Obrigatória? (default true)" },
            },
            required: ["label", "type"],
          },
        },
        qualification_rules: { type: "string", description: "Regras para a IA classificar a temperatura a partir das respostas. Ex.: 'Quente: orçamento alto ou prazo urgente. Morno: interesse sem urgência. Frio: só pede informação.'" },
        template_hot: { type: "string", description: "Mensagem para lead QUENTE. Usa variáveis: {{nome}}, {{empresa}}, {{campo:Etiqueta}}." },
        template_warm: { type: "string", description: "Mensagem para lead MORNO." },
        template_cold: { type: "string", description: "Mensagem para lead FRIO." },
      },
      required: ["qualification_rules"],
    },
    adminOnly: true,
    isWrite: true,
    execute: async (args, ctx) => {
      const supabase = ctx.supabaseAdmin;
      const orgId = ctx.orgId;
      const hot = (args.template_hot || "").trim();
      const warm = (args.template_warm || "").trim();
      const cold = (args.template_cold || "").trim();
      if (!hot && !warm && !cold) {
        return { error: "Sem mensagens", _instruction: "Redige pelo menos uma mensagem (quente/morno/frio, ou a mesma para todos) e mostra ao utilizador antes de configurar." };
      }
      const TYPES = ["text", "number", "select", "checkbox", "textarea"];
      const incoming = Array.isArray(args.questions) ? args.questions : [];
      const newFields = incoming.map((q: any) => ({
        id: crypto.randomUUID(),
        type: TYPES.includes(q?.type) ? q.type : "text",
        label: String(q?.label || "Pergunta"),
        placeholder: q?.placeholder ? String(q.placeholder) : "",
        required: q?.required !== false,
        options: Array.isArray(q?.options) ? q.options.map(String) : undefined,
        order: 0,
      }));
      // Find the org's form (default first); update it, or create one if none.
      const { data: form } = await supabase
        .from("forms")
        .select("id, slug, form_settings")
        .eq("organization_id", orgId)
        .order("is_default", { ascending: false })
        .limit(1)
        .maybeSingle();
      const base = (form?.form_settings && typeof form.form_settings === "object" && !Array.isArray(form.form_settings)) ? form.form_settings as Record<string, any> : {};
      const existing = Array.isArray(base.custom_fields) ? base.custom_fields : [];
      const existingLabels = new Set(existing.map((f: any) => String(f?.label || "").toLowerCase()));
      const merged = [...existing, ...newFields.filter((f) => !existingLabels.has(f.label.toLowerCase()))]
        .map((f: any, i: number) => ({ ...f, order: i }));
      const bf = base.fields || {};
      const form_settings = {
        mode: base.mode || "traditional",
        title: base.title || "Deixe o seu Contacto",
        subtitle: base.subtitle || "Preencha os dados e entraremos em contacto consigo.",
        logo_url: base.logo_url ?? null,
        primary_color: base.primary_color || "#3B82F6",
        // Phone is visible + REQUIRED: it's what the auto-WhatsApp needs.
        fields: {
          name: { visible: true, required: true, label: bf.name?.label || "Nome" },
          email: { visible: true, required: false, label: bf.email?.label || "Email" },
          phone: { visible: true, required: true, label: bf.phone?.label || "Telemóvel" },
          message: bf.message || { visible: false, required: false, label: "Mensagem" },
        },
        success_message: base.success_message || { title: "Obrigado!", description: "Recebemos o seu contacto e entraremos em contacto brevemente." },
        error_message: base.error_message || "Não foi possível enviar o formulário. Tente novamente.",
        submit_button_text: base.submit_button_text || "Enviar",
        custom_fields: merged,
      };
      const payload: Record<string, any> = {
        form_settings,
        ai_qualification_rules: (args.qualification_rules || "").trim() || null,
        msg_template_hot: hot || null,
        msg_template_warm: warm || null,
        msg_template_cold: cold || null,
      };
      let slug = form?.slug as string | undefined;
      if (form?.id) {
        const { error } = await supabase.from("forms").update(payload).eq("id", form.id);
        if (error) return { error: error.message, _instruction: "ERRO ao guardar a configuração. Avisa o utilizador que houve um problema técnico." };
      } else {
        slug = "leads-" + crypto.randomUUID().slice(0, 8);
        const { data: created, error } = await supabase
          .from("forms")
          .insert({ organization_id: orgId, name: "Captação de Leads", slug, is_default: true, is_active: true, ...payload })
          .select("slug")
          .single();
        if (error) return { error: error.message, _instruction: "ERRO ao criar o formulário. Avisa o utilizador." };
        slug = created.slug;
      }
      // Per-form mode so the form's own templates/rules apply to its leads.
      await supabase.from("organizations").update({ ai_response_mode: "per_form" }).eq("id", orgId);
      return {
        success: true,
        form_slug: slug,
        questions: merged.length,
        _instruction: `Resposta automática configurada: ${merged.length} pergunta(s) de qualificação + regras + mensagens, no formulário (telemóvel obrigatório, para o WhatsApp). DIZ AO UTILIZADOR com clareza: (1) tem de ter o WhatsApp LIGADO para as mensagens saírem (oferece ligar agora com [modal:whatsapp] se ainda não estiver); (2) pode rever e ajustar tudo em Definições > Formulários de Captação [link:Rever formulário|/settings]; (3) o link público do formulário para usar nos anúncios é senvia.app/f/${slug}.`,
      };
    },
  },
  {
    name: "set_modules",
    module: "settings",
    description: `Ativar ou desativar módulos da organização. Módulos válidos: ${VALID_MODULES.join(", ")}.`,
    parameters: {
      type: "object",
      properties: {
        enable: { type: "array", description: "Módulos a ativar", items: { type: "string" } },
        disable: { type: "array", description: "Módulos a desativar", items: { type: "string" } },
      },
      required: [],
    },
    adminOnly: true,
    isWrite: true,
    execute: async (args, ctx) => {
      const enable: string[] = (args.enable || []).filter((m: string) => VALID_MODULES.includes(m));
      const disable: string[] = (args.disable || []).filter((m: string) => VALID_MODULES.includes(m));
      if (enable.length === 0 && disable.length === 0) {
        return { error: "Nada a alterar", _instruction: `Pergunta que módulos ativar/desativar. Válidos: ${VALID_MODULES.join(", ")}.` };
      }
      const { data: orgRow } = await ctx.supabaseAdmin.from("organizations").select("enabled_modules").eq("id", ctx.orgId).maybeSingle();
      const current: Record<string, boolean> = (orgRow?.enabled_modules && typeof orgRow.enabled_modules === "object" && !Array.isArray(orgRow.enabled_modules))
        ? { ...(orgRow.enabled_modules as Record<string, boolean>) } : {};
      enable.forEach((m) => { current[m] = true; });
      disable.forEach((m) => { current[m] = false; });
      const { error } = await ctx.supabaseAdmin.from("organizations").update({ enabled_modules: current }).eq("id", ctx.orgId);
      if (error) return { error: error.message, _instruction: "ERRO ao atualizar módulos. Informa o utilizador." };
      return { success: true, enabled: enable, disabled: disable, _instruction: "Módulos atualizados. Confirma ao utilizador." };
    },
  },
  {
    name: "configure_whatsapp",
    module: "settings",
    description: "Iniciar a ligação do WhatsApp. Não liga sozinho (o utilizador tem de ler o QR no telemóvel); abre o guia visual que o leva à caixa e mostra onde carregar.",
    parameters: { type: "object", properties: {}, required: [] },
    adminOnly: true,
    execute: async (_args, _ctx) => ({
      success: true,
      _instruction: "Diz UMA frase curta a explicar que vais abrir a ligação do WhatsApp, e TERMINA a resposta com o token [modal:whatsapp]. O modal mostra o QR e as instruções; não descrevas os passos por texto.",
    }),
  },
  {
    name: "invite_member",
    module: "settings",
    description: "Ajudar a convidar um membro da equipa. Abre o guia visual que leva ao botão de adicionar acesso em Definições > Equipa.",
    parameters: { type: "object", properties: {}, required: [] },
    adminOnly: true,
    execute: async (_args, _ctx) => ({
      success: true,
      _instruction: "Diz UMA frase curta e TERMINA a resposta com o token [tour:invite_member]. O guia visual leva o utilizador ao botão de adicionar membro.",
    }),
  },
  {
    name: "import_leads",
    module: "leads",
    description: "Ajudar a importar leads de um ficheiro CSV/Excel. Abre o guia visual que leva ao botão Importar na página de Leads.",
    parameters: { type: "object", properties: {}, required: [] },
    adminOnly: true,
    execute: async (_args, _ctx) => ({
      success: true,
      _instruction: "Diz UMA frase curta e TERMINA a resposta com o token [tour:import_leads]. O guia visual leva o utilizador ao botão Importar.",
    }),
  },
  {
    name: "complete_onboarding",
    module: "settings",
    description: "Marcar a configuração inicial (onboarding) como concluída. Usa quando os passos essenciais estiverem feitos e o utilizador confirmar que quer terminar.",
    parameters: { type: "object", properties: {}, required: [] },
    adminOnly: true,
    isWrite: true,
    execute: async (_args, ctx) => {
      try {
        await ctx.supabaseAdmin
          .from("org_onboarding_state")
          .upsert({
            organization_id: ctx.orgId,
            current_stage: "COMPLETE",
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: "organization_id" });
      } catch (e) {
        return { error: "Falha ao concluir", _instruction: "Não foi possível marcar o onboarding como concluído (a tabela pode não existir). Informa o utilizador que pode continuar a usar o sistema normalmente." };
      }
      return { success: true, _instruction: "Onboarding concluído! Felicita o utilizador e passa para o modo de suporte normal. [link:Ir para o Dashboard|/dashboard]" };
    },
  },
];
