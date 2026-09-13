// Basic write tools: create a lead, create a client, move a lead between
// pipeline stages. All gated by permission (admins bypass) and audited.
import type { Tool } from "../types.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function saleReferenceCandidates(value: string): string[] {
  const raw = value.trim();
  const compact = raw.replace(/^venda\s+/i, "").trim();
  const digits = compact.match(/\d+/)?.[0] || "";
  return [...new Set([
    raw,
    compact,
    digits,
    digits ? digits.padStart(4, "0") : "",
    digits ? String(Number(digits)) : "",
  ].filter(Boolean))];
}

function normalizeLookup(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}@.+-]+/gu, " ")
    .trim();
}

async function resolveSaleByReference(ctx: any, reference: string): Promise<{ sale: any | null; error?: string; candidates?: any[] }> {
  const trimmed = reference.trim();
  if (!trimmed) return { sale: null, error: "Referência da venda em falta" };

  if (UUID_RE.test(trimmed)) {
    const { data, error } = await ctx.supabaseAdmin
      .from("sales")
      .select("id, code, total_value, seller_id, created_by")
      .eq("organization_id", ctx.orgId)
      .eq("id", trimmed)
      .maybeSingle();
    if (error) return { sale: null, error: error.message };
    return { sale: data || null };
  }

  const candidates = saleReferenceCandidates(trimmed);
  const { data, error } = await ctx.supabaseAdmin
    .from("sales")
    .select("id, code, total_value, seller_id, created_by, sale_date, status, payment_status")
    .eq("organization_id", ctx.orgId)
    .in("code", candidates)
    .limit(10);
  if (error) return { sale: null, error: error.message };
  if ((data || []).length === 1) return { sale: data![0] };
  if ((data || []).length > 1) return { sale: null, candidates: data || [] };

  const { data: searched, error: searchError } = await ctx.supabaseAdmin
    .rpc("search_sales_unaccent", { org_id: ctx.orgId, search_term: trimmed, pay_status: null, max_results: 10 });
  if (searchError) return { sale: null, error: searchError.message };
  if ((searched || []).length === 1) return { sale: searched![0] };
  if ((searched || []).length > 1) return { sale: null, candidates: searched || [] };

  return { sale: null };
}

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

async function resolveAssignee(ctx: any, args: Record<string, any>): Promise<{ userId: string | null; label: string | null; error?: string }> {
  const explicitUserId = typeof args.assigned_to_user_id === "string" ? args.assigned_to_user_id.trim() : "";
  const query = typeof args.assignee_query === "string" ? args.assignee_query.trim() : "";
  if (!explicitUserId && !query) return { userId: null, label: null };

  const { data: members, error: membersError } = await ctx.supabaseAdmin
    .from("organization_members")
    .select("user_id, role, is_active")
    .eq("organization_id", ctx.orgId)
    .eq("is_active", true);
  if (membersError) return { userId: null, label: null, error: membersError.message };

  const memberIds = (members || []).map((m: any) => m.user_id).filter(Boolean);
  if (memberIds.length === 0) return { userId: null, label: null, error: "Nenhum membro ativo encontrado na organização." };

  const { data: profiles, error: profilesError } = await ctx.supabaseAdmin
    .from("profiles")
    .select("id, full_name, email, phone")
    .in("id", memberIds);
  if (profilesError) return { userId: null, label: null, error: profilesError.message };

  const memberIdsSet = new Set(memberIds);
  const profileById = new Map<string, { full_name?: string; email?: string; phone?: string }>((profiles || []).map((p: any) => [p.id, p]));

  if (explicitUserId) {
    if (!memberIdsSet.has(explicitUserId)) return { userId: null, label: null, error: "O comercial indicado não pertence a esta organização ou está inativo." };
    const profile = profileById.get(explicitUserId) || {};
    return { userId: explicitUserId, label: profile.full_name || profile.email || explicitUserId };
  }

  const normalized = normalizeLookup(query);
  const matches = memberIds
    .map((userId: string) => {
      const profile = profileById.get(userId) || {};
      return {
        user_id: userId,
        full_name: profile.full_name || null,
        email: profile.email || null,
        phone: profile.phone || null,
      };
    })
    .filter((m: any) => {
      const searchable = [m.full_name, m.email, m.phone]
        .filter(Boolean)
        .map((value: string) => normalizeLookup(value));
      return searchable.some((value: string) => value.includes(normalized) || normalized.includes(value));
    });

  if (matches.length === 0) return { userId: null, label: null, error: `Não encontrei nenhum membro ativo chamado "${query}".` };
  if (matches.length > 1) {
    const labels = matches.map((m: any) => m.full_name || m.email || m.user_id).join(", ");
    return { userId: null, label: null, error: `Encontrei mais de um membro para "${query}": ${labels}.` };
  }

  const match = matches[0];
  return { userId: match.user_id, label: match.full_name || match.email || match.user_id };
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
    permission: { module: "leads", subarea: "kanban", action: "create" },
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
    permission: { module: "clients", subarea: "list", action: "create" },
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
    name: "create_sale",
    description: "Registar uma nova venda no CRM. Antes, usa prepare_sale_creation/search_clients/search_leads para consultar o banco. Usa APENAS depois de confirmares cliente/lead, valor e comercial quando existir atribuição.",
    parameters: {
      type: "object",
      properties: {
        total_value: { type: "number", description: "Valor total da venda em euros (obrigatório)" },
        client_id: { type: "string", description: "UUID do cliente associado (opcional, obtém-no com search_clients)" },
        lead_id: { type: "string", description: "UUID da lead de origem (opcional, obtém-no com search_leads)" },
        assigned_to_user_id: { type: "string", description: "UUID do comercial/responsável a atribuir ao cliente/lead antes de criar a venda (opcional)" },
        assignee_query: { type: "string", description: "Nome/email do comercial/responsável a resolver, ex: Sara (opcional; prefere assigned_to_user_id quando já foi resolvido)" },
        assign_entity_to_user: { type: "boolean", description: "Se true, atribui o cliente/lead ao comercial antes de criar a venda. Default: true quando há comercial." },
        notes: { type: "string", description: "Notas sobre a venda (opcional)" },
      },
      required: ["total_value"],
    },
    permission: { module: "sales", subarea: "sales", action: "create" },
    isWrite: true,
    execute: async (args, ctx) => {
      if (typeof args.total_value !== "number" || !(args.total_value > 0)) {
        return { error: "Valor em falta", _instruction: "Antes de pedir o valor, usa prepare_sale_creation/search_clients/search_leads para mostrar o que já encontraste. Depois pede só o valor que faltar. NÃO inventes valores." };
      }
      if (!args.client_id && !args.lead_id) {
        return { error: "Cliente/lead em falta", _instruction: "Usa prepare_sale_creation/search_clients/search_leads para encontrar o cliente ou lead antes de criar a venda. NÃO cries venda solta." };
      }

      const assignee = await resolveAssignee(ctx, args);
      if (assignee.error) {
        return { error: assignee.error, _instruction: "Informa o utilizador que não consegui resolver o comercial/responsável. Mostra opções se existirem e não cries a venda ainda." };
      }
      const shouldAssignEntity = !!assignee.userId && args.assign_entity_to_user !== false;

      // If a client_id was given, confirm it belongs to this org (avoid cross-tenant linkage).
      if (args.client_id) {
        const { data: client } = await ctx.supabaseAdmin
          .from("crm_clients")
          .select("id")
          .eq("organization_id", ctx.orgId)
          .eq("id", args.client_id)
          .maybeSingle();
        if (!client) return { error: "Cliente não encontrado", _instruction: "O cliente indicado não existe nesta organização. Usa search_clients para confirmar. NÃO inventes." };
        if (shouldAssignEntity) {
          const { error: assignError } = await ctx.supabaseAdmin
            .from("crm_clients")
            .update({ assigned_to: assignee.userId })
            .eq("organization_id", ctx.orgId)
            .eq("id", args.client_id);
          if (assignError) return { error: assignError.message, _instruction: "ERRO ao atribuir o cliente ao comercial. Não digas que a venda foi registada." };
        }
      }
      if (args.lead_id) {
        const { data: lead } = await ctx.supabaseAdmin
          .from("leads")
          .select("id")
          .eq("organization_id", ctx.orgId)
          .eq("id", args.lead_id)
          .maybeSingle();
        if (!lead) return { error: "Lead não encontrada", _instruction: "A lead indicada não existe nesta organização. Usa search_leads para confirmar. NÃO inventes." };
        if (shouldAssignEntity) {
          const { error: assignError } = await ctx.supabaseAdmin
            .from("leads")
            .update({ assigned_to: assignee.userId })
            .eq("organization_id", ctx.orgId)
            .eq("id", args.lead_id);
          if (assignError) return { error: assignError.message, _instruction: "ERRO ao atribuir a lead ao comercial. Não digas que a venda foi registada." };
        }
      }
      const { data, error } = await ctx.supabaseAdmin
        .from("sales")
        .insert({
          organization_id: ctx.orgId,
          total_value: args.total_value,
          status: "pending",
          client_id: args.client_id || null,
          lead_id: args.lead_id || null,
          notes: args.notes || null,
          created_by: ctx.userId || null,
          seller_id: assignee.userId || ctx.userId || null,
        })
        .select("id, total_value")
        .single();
      if (error) {
        return { error: error.message, _instruction: "ERRO ao registar a venda. Informa o utilizador que houve um problema técnico. NÃO digas que foi registada." };
      }
      return {
        success: true,
        sale_id: data.id,
        assigned_to_user_id: assignee.userId,
        assigned_to_name: assignee.label,
        _instruction: `Venda de **${data.total_value}€** registada com sucesso${assignee.label ? ` e atribuída a **${assignee.label}**` : ""}. Celebra brevemente e oferece um link. [link:Ver Vendas|/sales]`,
      };
    },
  },
  {
    name: "update_sale_seller",
    description: "Atribuir/alterar o comercial responsável por uma venda existente. Aceita UUID interno ou código/referência visível da venda (ex: 0002). Usa search_sales/list_team_members quando possível e APENAS depois de confirmação explícita do utilizador.",
    parameters: {
      type: "object",
      properties: {
        sale_id: { type: "string", description: "UUID interno OU código/referência visível da venda, ex: 0002" },
        sale_reference: { type: "string", description: "Código/referência visível da venda, ex: 0002 ou venda 0002 (opcional)" },
        assigned_to_user_id: { type: "string", description: "UUID do comercial/responsável (opcional)" },
        assignee_query: { type: "string", description: "Nome/email do comercial/responsável, ex: Sara (opcional; prefere assigned_to_user_id quando já foi resolvido)" },
      },
      required: ["sale_id"],
    },
    permission: { module: "sales", subarea: "sales", action: "edit" },
    isWrite: true,
    execute: async (args, ctx) => {
      const saleRef = String(args.sale_reference || args.sale_id || "").trim();
      if (!saleRef) {
        return { error: "Venda em falta", _instruction: "Usa search_sales para encontrar a venda antes de alterar o comercial. NÃO inventes IDs." };
      }

      const assignee = await resolveAssignee(ctx, args);
      if (assignee.error || !assignee.userId) {
        return { error: assignee.error || "Comercial em falta", _instruction: "Informa que falta resolver o comercial/responsável. Usa list_team_members se precisares de opções. Não alteres a venda." };
      }

      const resolvedSale = await resolveSaleByReference(ctx, saleRef);
      if (resolvedSale.error) return { error: resolvedSale.error, _instruction: "ERRO ao consultar a venda. Não digas que foi alterada." };
      if (resolvedSale.candidates?.length) {
        return {
          error: "Mais de uma venda encontrada",
          candidates: resolvedSale.candidates.map((s: any) => ({ id: s.id, code: s.code, total_value: s.total_value, status: s.status, payment_status: s.payment_status })),
          _instruction: "Há mais de uma venda possível. Mostra as opções e pede ao utilizador para escolher. NÃO alteres nada.",
        };
      }
      const existingSale = resolvedSale.sale;
      if (!existingSale) return { error: "Venda não encontrada", _instruction: `Não encontrei nenhuma venda com a referência "${saleRef}" nesta organização. Usa search_sales com outro termo ou pede mais dados. NÃO inventes.` };

      const { data, error } = await ctx.supabaseAdmin
        .from("sales")
        .update({ seller_id: assignee.userId })
        .eq("organization_id", ctx.orgId)
        .eq("id", existingSale.id)
        .select("id, code, total_value, seller_id")
        .maybeSingle();
      if (error) return { error: error.message, _instruction: "ERRO ao alterar o comercial da venda. Não digas que foi alterada." };
      if (!data) return { error: "Venda não encontrada", _instruction: "A venda deixou de estar disponível. Informa o utilizador. NÃO inventes." };

      return {
        success: true,
        sale_id: data.id,
        sale_code: data.code,
        total_value: data.total_value,
        assigned_to_user_id: assignee.userId,
        assigned_to_name: assignee.label,
        _instruction: `Venda **${data.code || data.id}** atribuída a **${assignee.label}** com sucesso. Informa o utilizador e inclui [link:Ver Vendas|/sales].`,
      };
    },
  },
  {
    name: "create_proposal",
    description: "Criar uma proposta para uma lead. Precisa do ID da lead (obtém-no com search_leads) e do valor total. Usa APENAS depois de confirmares os dados.",
    parameters: {
      type: "object",
      properties: {
        lead_id: { type: "string", description: "UUID da lead destinatária (obrigatório, obtém-no com search_leads)" },
        total_value: { type: "number", description: "Valor total da proposta em euros (obrigatório)" },
        notes: { type: "string", description: "Notas / descrição da proposta (opcional)" },
      },
      required: ["lead_id", "total_value"],
    },
    permission: { module: "proposals", subarea: "proposals", action: "create" },
    isWrite: true,
    execute: async (args, ctx) => {
      if (!args.lead_id) return { error: "Lead em falta", _instruction: "Uma proposta tem de estar associada a uma lead. Usa search_leads para encontrar a lead. NÃO inventes." };
      if (typeof args.total_value !== "number" || !(args.total_value > 0)) {
        return { error: "Valor em falta", _instruction: "Pede o valor total da proposta (um número maior que zero) antes de a criar. NÃO inventes valores." };
      }
      // Confirm the lead exists in this org before linking (proposals.lead_id is NOT NULL + FK).
      const { data: lead } = await ctx.supabaseAdmin
        .from("leads")
        .select("id, name")
        .eq("organization_id", ctx.orgId)
        .eq("id", args.lead_id)
        .maybeSingle();
      if (!lead) return { error: "Lead não encontrada", _instruction: "A lead indicada não existe nesta organização. Usa search_leads para confirmar. NÃO inventes." };
      const { data, error } = await ctx.supabaseAdmin
        .from("proposals")
        .insert({
          organization_id: ctx.orgId,
          lead_id: args.lead_id,
          total_value: args.total_value,
          status: "draft",
          notes: args.notes || null,
          created_by: ctx.userId || null,
        })
        .select("id, total_value")
        .single();
      if (error) {
        return { error: error.message, _instruction: "ERRO ao criar a proposta. Informa o utilizador que houve um problema técnico. NÃO digas que foi criada." };
      }
      return {
        success: true,
        proposal_id: data.id,
        _instruction: `Proposta de **${data.total_value}€** para **${lead.name}** criada com sucesso. Informa o utilizador e oferece um link. [link:Ver Propostas|/proposals]`,
      };
    },
  },
];
