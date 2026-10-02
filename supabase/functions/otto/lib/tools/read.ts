// Read-only tools (search / summaries). Faithful port of the legacy otto-chat
// switch executor into the registry pattern. Behaviour is intentionally
// identical — same RPCs, same shapes, same anti-hallucination _instruction
// strings — so migrating carries no regression risk.
import type { Tool } from "../types.ts";

const ERR = (msg: string) => ({
  error: msg,
  _instruction: "ERRO NA PESQUISA. Informa o utilizador que não foi possível pesquisar. NÃO INVENTES DADOS.",
});
const EMPTY = (entity: string) => ({
  results: [],
  count: 0,
  _instruction: `ZERO RESULTADOS encontrados. Informa o utilizador que não encontraste ${entity} com esse termo. NÃO INVENTES DADOS.`,
});

function allowedUserIds(ctx: any): string[] | null {
  if (ctx.dataScope === "all") return null;
  return Array.isArray(ctx.effectiveUserIds) ? ctx.effectiveUserIds : (ctx.userId ? [ctx.userId] : []);
}

function isAllowedOwner(ctx: any, userId?: string | null): boolean {
  const ids = allowedUserIds(ctx);
  if (!ids) return true;
  return !!userId && ids.includes(userId);
}

async function filterSalesByScope(rows: any[], ctx: any): Promise<any[]> {
  const ids = allowedUserIds(ctx);
  if (!ids || rows.length === 0) return rows;
  const leadIds = [...new Set(rows.map((r: any) => r.lead_id).filter(Boolean))];
  const clientIds = [...new Set(rows.map((r: any) => r.client_id).filter(Boolean))];
  const [leadResp, clientResp] = await Promise.all([
    leadIds.length
      ? ctx.supabaseAdmin.from("leads").select("id, assigned_to").in("id", leadIds)
      : Promise.resolve({ data: [] }),
    clientIds.length
      ? ctx.supabaseAdmin.from("crm_clients").select("id, assigned_to").in("id", clientIds)
      : Promise.resolve({ data: [] }),
  ]);
  const leadOwners = Object.fromEntries((leadResp.data || []).map((l: any) => [l.id, l.assigned_to]));
  const clientOwners = Object.fromEntries((clientResp.data || []).map((c: any) => [c.id, c.assigned_to]));
  return rows.filter((r: any) =>
    isAllowedOwner(ctx, r.created_by) ||
    isAllowedOwner(ctx, leadOwners[r.lead_id]) ||
    isAllowedOwner(ctx, clientOwners[r.client_id])
  );
}

export const readTools: Tool[] = [
  {
    name: "search_clients",
    description: "Procurar clientes por nome, email, NIF ou empresa. Retorna até 10 resultados.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Termo de pesquisa (nome, email, NIF ou empresa)" } },
      required: ["query"],
    },
    permission: { module: "clients", subarea: "list", action: "view" },
    execute: async (args, ctx) => {
      const { data, error } = await ctx.supabaseAdmin
        .rpc("search_clients_unaccent", { org_id: ctx.orgId, search_term: args.query, max_results: 10 });
      if (error) return ERR(error.message);
      const scoped = (data || []).filter((c: any) => isAllowedOwner(ctx, c.assigned_to));
      const results = scoped.map((c: any) => ({
        id: c.id, code: c.code, name: c.name, email: c.email, phone: c.phone,
        nif: c.nif, company: c.company, status: c.status, total_sales: c.total_sales, total_value: c.total_value,
      }));
      if (results.length === 0) return EMPTY("clientes");
      return { results, count: results.length };
    },
  },
  {
    name: "search_leads",
    description: "Procurar leads por nome, email ou telefone. Retorna até 10 resultados.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Termo de pesquisa (nome, email ou telefone)" },
        status: { type: "string", description: "Filtrar por status/etapa do pipeline (opcional)" },
      },
      required: ["query"],
    },
    permission: { module: "leads", subarea: "kanban", action: "view" },
    execute: async (args, ctx) => {
      const { data, error } = await ctx.supabaseAdmin
        .rpc("search_leads_unaccent", { org_id: ctx.orgId, search_term: args.query, lead_status: args.status || null, max_results: 10 });
      if (error) return ERR(error.message);
      const scoped = (data || []).filter((l: any) => isAllowedOwner(ctx, l.assigned_to));
      const results = scoped.map((l: any) => ({
        id: l.id, name: l.name, email: l.email, phone: l.phone, status: l.status,
        source: l.source, assigned_to: l.assigned_to, created_at: l.created_at, value: l.value,
      }));
      if (results.length === 0) return EMPTY("leads");
      return { results, count: results.length };
    },
  },
  {
    name: "search_invoices",
    description: "Procurar faturas por referência ou nome do cliente. Retorna até 10 resultados.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Referência da fatura ou nome do cliente" },
        status: { type: "string", description: "Filtrar por status: final, sent, settled, canceled (opcional)" },
      },
      required: ["query"],
    },
    permission: { module: "finance", subarea: "invoices", action: "view" },
    execute: async (args, ctx) => {
      const { data, error } = await ctx.supabaseAdmin
        .rpc("search_invoices_unaccent", { org_id: ctx.orgId, search_term: args.query, inv_status: args.status || null, max_results: 10 });
      if (error) return ERR(error.message);
      const results = (data || []).map((i: any) => ({
        id: i.id, invoicexpress_id: i.invoicexpress_id, reference: i.reference,
        client_name: i.client_name, total: i.total, status: i.status,
        date: i.date, due_date: i.due_date, document_type: i.document_type, pdf_path: i.pdf_path,
      }));
      if (results.length === 0) return EMPTY("faturas");
      return { results, count: results.length };
    },
  },
  {
    name: "search_sales",
    description: "Procurar vendas por código ou nome do cliente. Retorna até 10 resultados.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Código da venda ou nome do cliente" },
        payment_status: { type: "string", description: "Filtrar por estado: pending, partial, paid (opcional)" },
      },
      required: ["query"],
    },
    permission: { module: "sales", subarea: "sales", action: "view" },
    execute: async (args, ctx) => {
      const { data, error } = await ctx.supabaseAdmin
        .rpc("search_sales_unaccent", { org_id: ctx.orgId, search_term: args.query, pay_status: args.payment_status || null, max_results: 10 });
      if (error) return ERR(error.message);
      const scoped = await filterSalesByScope(data || [], ctx);
      if (!scoped || scoped.length === 0) return EMPTY("vendas");
      const clientIds = [...new Set(scoped.filter((s: any) => s.client_id).map((s: any) => s.client_id))];
      if (clientIds.length > 0) {
        const { data: clients } = await ctx.supabaseAdmin.from("crm_clients").select("id, name").in("id", clientIds);
        const clientMap = Object.fromEntries((clients || []).map((c: any) => [c.id, c.name]));
        scoped.forEach((s: any) => { s.client_name = clientMap[s.client_id] || null; });
      }
      return { results: scoped, count: scoped.length };
    },
  },
  {
    name: "search_proposals",
    description: "Procurar propostas por código ou nome do cliente. Retorna até 10 resultados.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Código da proposta ou nome do cliente" },
        status: { type: "string", description: "Filtrar por status: draft, sent, accepted, rejected (opcional)" },
      },
      required: ["query"],
    },
    permission: { module: "proposals", subarea: "proposals", action: "view" },
    execute: async (args, ctx) => {
      const { data, error } = await ctx.supabaseAdmin
        .rpc("search_proposals_unaccent", { org_id: ctx.orgId, search_term: args.query, prop_status: args.status || null, max_results: 10 });
      if (error) return ERR(error.message);
      const scoped = await filterSalesByScope(data || [], ctx);
      if (!scoped || scoped.length === 0) return EMPTY("propostas");
      const propClientIds = [...new Set(scoped.filter((p: any) => p.client_id).map((p: any) => p.client_id))];
      if (propClientIds.length > 0) {
        const { data: clients } = await ctx.supabaseAdmin.from("crm_clients").select("id, name").in("id", propClientIds);
        const clientMap = Object.fromEntries((clients || []).map((c: any) => [c.id, c.name]));
        scoped.forEach((p: any) => { p.client_name = clientMap[p.client_id] || null; });
      }
      return { results: scoped, count: scoped.length };
    },
  },
  {
    name: "get_client_details",
    description: "Obter detalhes completos de um cliente específico por ID.",
    parameters: {
      type: "object",
      properties: { client_id: { type: "string", description: "UUID do cliente" } },
      required: ["client_id"],
    },
    permission: { module: "clients", subarea: "list", action: "view" },
    execute: async (args, ctx) => {
      const { data, error } = await ctx.supabaseAdmin
        .from("crm_clients")
        .select("id, code, name, email, phone, nif, company, company_nif, address_line1, city, postal_code, country, status, total_sales, total_value, total_proposals, notes, assigned_to, created_at")
        .eq("organization_id", ctx.orgId)
        .eq("id", args.client_id)
        .maybeSingle();
      if (error) return { error: error.message, _instruction: "ERRO NA PESQUISA. NÃO INVENTES DADOS." };
      if (!data) return { error: "Cliente não encontrado", _instruction: "Cliente não existe na base de dados. Informa o utilizador. NÃO INVENTES DADOS." };
      if (!isAllowedOwner(ctx, (data as any).assigned_to)) {
        return { error: "Sem acesso", _instruction: "O cliente existe, mas está fora do escopo de dados deste utilizador." };
      }
      return data;
    },
  },
  {
    name: "get_sale_details",
    description: "Obter detalhes de uma venda específica incluindo pagamentos.",
    parameters: {
      type: "object",
      properties: { sale_id: { type: "string", description: "UUID da venda" } },
      required: ["sale_id"],
    },
    permission: { module: "sales", subarea: "sales", action: "view" },
    execute: async (args, ctx) => {
      const { data: sale, error } = await ctx.supabaseAdmin
        .from("sales")
        .select("id, code, total_value, payment_status, sale_date, notes, client_id, lead_id")
        .eq("organization_id", ctx.orgId)
        .eq("id", args.sale_id)
        .maybeSingle();
      if (error) return { error: error.message, _instruction: "ERRO NA PESQUISA. NÃO INVENTES DADOS." };
      if (!sale) return { error: "Venda não encontrada", _instruction: "Venda não existe na base de dados. Informa o utilizador. NÃO INVENTES DADOS." };
      const scopedSale = await filterSalesByScope([sale], ctx);
      if (scopedSale.length === 0) {
        return { error: "Sem acesso", _instruction: "A venda existe, mas está fora do escopo de dados deste utilizador." };
      }
      const { data: payments } = await ctx.supabaseAdmin
        .from("sale_payments")
        .select("id, amount, payment_date, payment_method, status, invoice_reference")
        .eq("sale_id", args.sale_id)
        .eq("organization_id", ctx.orgId);
      if (sale.client_id) {
        const { data: client } = await ctx.supabaseAdmin.from("crm_clients").select("name").eq("id", sale.client_id).maybeSingle();
        (sale as any).client_name = client?.name || null;
      }
      return { sale, payments: payments || [] };
    },
  },
  {
    name: "get_pipeline_summary",
    description: "Obter resumo do pipeline de leads: contagem por etapa e total.",
    parameters: { type: "object", properties: {}, required: [] },
    permission: { module: "leads", subarea: "kanban", action: "view" },
    execute: async (_args, ctx) => {
      const { data: stages } = await ctx.supabaseAdmin
        .from("pipeline_stages").select("key, label:name").eq("organization_id", ctx.orgId).order("position");
      let leadQuery = ctx.supabaseAdmin.from("leads").select("status, assigned_to").eq("organization_id", ctx.orgId);
      const ids = allowedUserIds(ctx);
      if (ids) leadQuery = leadQuery.in("assigned_to", ids);
      const { data: leads } = await leadQuery;
      const counts: Record<string, number> = {};
      (leads || []).forEach((l: any) => { counts[l.status] = (counts[l.status] || 0) + 1; });
      const summary = (stages || []).map((s: any) => ({ stage: s.label, key: s.key, count: counts[s.key] || 0 }));
      return { stages: summary, total_leads: leads?.length || 0 };
    },
  },
  {
    name: "get_finance_summary",
    description: "Obter resumo financeiro de um período: total faturado, recebido, pendente, despesas e balanço. Se não forem fornecidas datas, usa o mês atual.",
    parameters: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Data início YYYY-MM-DD (opcional, default: início do mês atual)" },
        end_date: { type: "string", description: "Data fim YYYY-MM-DD (opcional, default: fim do mês atual)" },
      },
      required: [],
    },
    permission: { module: "finance", subarea: "summary", action: "view" },
    execute: async (args, ctx) => {
      const now = new Date();
      const startDate = args.start_date || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const endDateDefault = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const endDate = args.end_date || `${endDateDefault.getFullYear()}-${String(endDateDefault.getMonth() + 1).padStart(2, "0")}-${String(endDateDefault.getDate()).padStart(2, "0")}`;
      const { data: sales } = await ctx.supabaseAdmin
        .from("sales").select("id, total_value, sale_date").eq("organization_id", ctx.orgId).gte("sale_date", startDate).lte("sale_date", endDate);
      const totalBilled = (sales || []).reduce((s: number, r: any) => s + Number(r.total_value || 0), 0);
      const { data: payments } = await ctx.supabaseAdmin
        .from("sale_payments").select("amount, status").eq("organization_id", ctx.orgId).gte("payment_date", startDate).lte("payment_date", endDate);
      const totalReceived = (payments || []).filter((p: any) => p.status === "paid").reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
      const totalPending = (payments || []).filter((p: any) => p.status === "pending").reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
      const { data: expenses } = await ctx.supabaseAdmin
        .from("expenses").select("amount").eq("organization_id", ctx.orgId).gte("expense_date", startDate).lte("expense_date", endDate);
      const totalExpenses = (expenses || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
      return {
        period: { start: startDate, end: endDate },
        total_billed: totalBilled, total_received: totalReceived, total_pending: totalPending,
        total_expenses: totalExpenses, balance: totalReceived - totalExpenses, total_sales_count: sales?.length || 0,
      };
    },
  },
  {
    name: "get_upcoming_events",
    description: "Obter próximos eventos da agenda nos próximos N dias.",
    parameters: {
      type: "object",
      properties: { days: { type: "number", description: "Número de dias a consultar (default: 7)" } },
      required: [],
    },
    permission: { module: "calendar", subarea: "events", action: "view" },
    execute: async (args, ctx) => {
      const days = args.days || 7;
      const now = new Date().toISOString();
      const future = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await ctx.supabaseAdmin
        .from("calendar_events")
        .select("id, title, event_type, start_time, end_time, description, status, user_id")
        .eq("organization_id", ctx.orgId).gte("start_time", now).lte("start_time", future).order("start_time").limit(10);
      if (error) return { error: error.message, _instruction: "ERRO NA PESQUISA. NÃO INVENTES DADOS." };
      const ids = allowedUserIds(ctx);
      const scoped = ids ? (data || []).filter((e: any) => ids.includes(e.user_id)) : (data || []);
      if (scoped.length === 0) return { events: [], count: 0, _instruction: "ZERO eventos encontrados no período. Informa o utilizador. NÃO INVENTES DADOS." };
      return { events: scoped, count: scoped.length };
    },
  },
  {
    name: "search_credit_notes",
    description: "Procurar notas de crédito por referência ou nome do cliente. Retorna até 10 resultados.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Referência da nota de crédito ou nome do cliente" },
        status: { type: "string", description: "Filtrar por status (opcional)" },
      },
      required: ["query"],
    },
    permission: { module: "finance", subarea: "invoices", action: "view" },
    execute: async (args, ctx) => {
      const { data, error } = await ctx.supabaseAdmin
        .rpc("search_credit_notes_unaccent", { org_id: ctx.orgId, search_term: args.query, cn_status: args.status || null, max_results: 10 });
      if (error) return ERR(error.message);
      const results = (data || []).map((cn: any) => ({
        id: cn.id, reference: cn.reference, client_name: cn.client_name,
        total: cn.total, status: cn.status, date: cn.date, pdf_path: cn.pdf_path,
      }));
      if (results.length === 0) return EMPTY("notas de crédito");
      return { results, count: results.length };
    },
  },
];
