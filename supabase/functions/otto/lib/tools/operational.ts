// Operational write tools for day-to-day CRM work. These are intentionally
// conservative: they create/update local CRM records only and do not trigger
// external fiscal providers or bulk email sends.
import type { Tool } from "../types.ts";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function isAllowedOwner(ctx: any, userId?: string | null): boolean {
  if (ctx.dataScope === "all") return true;
  const ids = Array.isArray(ctx.effectiveUserIds) ? ctx.effectiveUserIds : (ctx.userId ? [ctx.userId] : []);
  return !!userId && ids.includes(userId);
}

async function canAccessLead(ctx: any, leadId?: string | null): Promise<boolean> {
  if (!leadId) return true;
  const { data } = await ctx.supabaseAdmin
    .from("leads")
    .select("id, assigned_to")
    .eq("organization_id", ctx.orgId)
    .eq("id", leadId)
    .maybeSingle();
  return !!data && isAllowedOwner(ctx, data.assigned_to);
}

async function canAccessClient(ctx: any, clientId?: string | null): Promise<boolean> {
  if (!clientId) return true;
  const { data } = await ctx.supabaseAdmin
    .from("crm_clients")
    .select("id, assigned_to")
    .eq("organization_id", ctx.orgId)
    .eq("id", clientId)
    .maybeSingle();
  return !!data && isAllowedOwner(ctx, data.assigned_to);
}

async function canAccessSale(ctx: any, saleId?: string | null): Promise<boolean> {
  if (!saleId) return false;
  const { data: sale } = await ctx.supabaseAdmin
    .from("sales")
    .select("id, created_by, lead_id, client_id")
    .eq("organization_id", ctx.orgId)
    .eq("id", saleId)
    .maybeSingle();
  if (!sale) return false;
  return isAllowedOwner(ctx, sale.created_by) ||
    await canAccessLead(ctx, sale.lead_id) ||
    await canAccessClient(ctx, sale.client_id);
}

export const operationalTools: Tool[] = [
  {
    name: "create_proposal",
    description: "Criar uma proposta simples associada a uma lead ou cliente. Usa apenas depois de confirmar cliente/lead, valor e notas principais.",
    parameters: {
      type: "object",
      properties: {
        lead_id: { type: "string", description: "UUID da lead, se aplicável" },
        client_id: { type: "string", description: "UUID do cliente, se aplicável" },
        total_value: { type: "number", description: "Valor total da proposta" },
        proposal_type: { type: "string", description: "Tipo de proposta, opcional" },
        notes: { type: "string", description: "Notas/descrição da proposta" },
        status: { type: "string", description: "Estado da proposta. Default: draft" },
      },
      required: ["total_value"],
    },
    permission: { module: "proposals", subarea: "proposals", action: "create" },
    isWrite: true,
    execute: async (args, ctx) => {
      if (!args.lead_id && !args.client_id) {
        return { error: "Origem em falta", _instruction: "Pede uma lead ou cliente antes de criar a proposta." };
      }
      if (args.lead_id && !await canAccessLead(ctx, args.lead_id)) {
        return { error: "Sem acesso à lead", _instruction: "A lead não existe ou está fora do escopo de dados deste utilizador." };
      }
      if (args.client_id && !await canAccessClient(ctx, args.client_id)) {
        return { error: "Sem acesso ao cliente", _instruction: "O cliente não existe ou está fora do escopo de dados deste utilizador." };
      }
      const { data, error } = await ctx.supabaseAdmin
        .from("proposals")
        .insert({
          organization_id: ctx.orgId,
          lead_id: args.lead_id || null,
          client_id: args.client_id || null,
          total_value: Number(args.total_value) || 0,
          proposal_type: args.proposal_type || null,
          notes: args.notes || null,
          status: args.status || "draft",
          proposal_date: today(),
          created_by: ctx.userId,
        })
        .select("id, code, total_value, status")
        .single();
      if (error) return { error: error.message, _instruction: "ERRO ao criar proposta. Não afirmes que foi criada." };
      return { success: true, proposal: data, _instruction: "Proposta criada. Confirma com o utilizador e oferece link para Propostas. [link:Ver Propostas|/proposals]" };
    },
  },
  {
    name: "create_sale",
    description: "Criar uma venda simples associada a uma proposta, lead ou cliente. Não emite fatura.",
    parameters: {
      type: "object",
      properties: {
        proposal_id: { type: "string", description: "UUID da proposta, se aplicável" },
        lead_id: { type: "string", description: "UUID da lead, se aplicável" },
        client_id: { type: "string", description: "UUID do cliente, se aplicável" },
        total_value: { type: "number", description: "Valor total da venda" },
        status: { type: "string", description: "Estado da venda. Default: pending" },
        payment_status: { type: "string", description: "Estado de pagamento. Default: pending" },
        sale_date: { type: "string", description: "Data YYYY-MM-DD. Default: hoje" },
        notes: { type: "string", description: "Notas da venda" },
      },
      required: ["total_value"],
    },
    permission: { module: "sales", subarea: "sales", action: "create" },
    isWrite: true,
    execute: async (args, ctx) => {
      if (!args.proposal_id && !args.lead_id && !args.client_id) {
        return { error: "Origem em falta", _instruction: "Pede uma proposta, lead ou cliente antes de criar a venda." };
      }
      if (args.lead_id && !await canAccessLead(ctx, args.lead_id)) {
        return { error: "Sem acesso à lead", _instruction: "A lead não existe ou está fora do escopo de dados deste utilizador." };
      }
      if (args.client_id && !await canAccessClient(ctx, args.client_id)) {
        return { error: "Sem acesso ao cliente", _instruction: "O cliente não existe ou está fora do escopo de dados deste utilizador." };
      }
      const { data, error } = await ctx.supabaseAdmin
        .from("sales")
        .insert({
          organization_id: ctx.orgId,
          proposal_id: args.proposal_id || null,
          lead_id: args.lead_id || null,
          client_id: args.client_id || null,
          total_value: Number(args.total_value) || 0,
          subtotal: Number(args.total_value) || 0,
          status: args.status || "pending",
          payment_status: args.payment_status || "pending",
          sale_date: args.sale_date || today(),
          notes: args.notes || null,
          created_by: ctx.userId,
        })
        .select("id, code, total_value, status, payment_status")
        .single();
      if (error) return { error: error.message, _instruction: "ERRO ao criar venda. Não afirmes que foi criada." };
      return { success: true, sale: data, _instruction: "Venda criada. Confirma com o utilizador. [link:Ver Vendas|/sales]" };
    },
  },
  {
    name: "add_sale_payment",
    description: "Adicionar um pagamento a uma venda. Não emite recibo/fatura fiscal.",
    parameters: {
      type: "object",
      properties: {
        sale_id: { type: "string", description: "UUID da venda" },
        amount: { type: "number", description: "Valor do pagamento" },
        payment_date: { type: "string", description: "Data YYYY-MM-DD. Default: hoje" },
        payment_method: { type: "string", description: "Método de pagamento" },
        status: { type: "string", description: "Estado: pending ou paid. Default: paid" },
        notes: { type: "string", description: "Notas" },
      },
      required: ["sale_id", "amount"],
    },
    permission: { module: "sales", subarea: "payments", action: "add" },
    isWrite: true,
    execute: async (args, ctx) => {
      if (!await canAccessSale(ctx, args.sale_id)) {
        return { error: "Sem acesso à venda", _instruction: "A venda não existe ou está fora do escopo de dados deste utilizador." };
      }
      const { data, error } = await ctx.supabaseAdmin
        .from("sale_payments")
        .insert({
          organization_id: ctx.orgId,
          sale_id: args.sale_id,
          amount: Number(args.amount) || 0,
          payment_date: args.payment_date || today(),
          payment_method: args.payment_method || null,
          status: args.status || "paid",
          notes: args.notes || null,
        })
        .select("id, amount, payment_date, status")
        .single();
      if (error) return { error: error.message, _instruction: "ERRO ao adicionar pagamento. Não afirmes que foi adicionado." };
      return { success: true, payment: data, _instruction: "Pagamento adicionado. Confirma com o utilizador. [link:Ver Pagamentos|/finance/payments]" };
    },
  },
  {
    name: "create_expense",
    description: "Criar uma despesa no financeiro.",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "Descrição da despesa" },
        amount: { type: "number", description: "Valor" },
        expense_date: { type: "string", description: "Data YYYY-MM-DD. Default: hoje" },
        notes: { type: "string", description: "Notas" },
      },
      required: ["description", "amount"],
    },
    permission: { module: "finance", subarea: "expenses", action: "add" },
    isWrite: true,
    execute: async (args, ctx) => {
      const { data, error } = await ctx.supabaseAdmin
        .from("expenses")
        .insert({
          organization_id: ctx.orgId,
          description: args.description,
          amount: Number(args.amount) || 0,
          expense_date: args.expense_date || today(),
          notes: args.notes || null,
          created_by: ctx.userId,
        })
        .select("id, description, amount, expense_date")
        .single();
      if (error) return { error: error.message, _instruction: "ERRO ao criar despesa. Não afirmes que foi criada." };
      return { success: true, expense: data, _instruction: "Despesa criada. Confirma com o utilizador. [link:Ver Despesas|/finance/expenses]" };
    },
  },
  {
    name: "create_calendar_event",
    description: "Criar evento na agenda da organização, opcionalmente associado a uma lead ou cliente.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título do evento" },
        start_time: { type: "string", description: "Início em ISO datetime" },
        end_time: { type: "string", description: "Fim em ISO datetime, opcional" },
        description: { type: "string", description: "Descrição" },
        event_type: { type: "string", description: "Tipo do evento. Default: meeting" },
        lead_id: { type: "string", description: "UUID da lead, opcional" },
        client_id: { type: "string", description: "UUID do cliente, opcional" },
        reminder_minutes: { type: "number", description: "Lembrete em minutos" },
      },
      required: ["title", "start_time"],
    },
    permission: { module: "calendar", subarea: "events", action: "create" },
    isWrite: true,
    execute: async (args, ctx) => {
      if (args.lead_id && !await canAccessLead(ctx, args.lead_id)) {
        return { error: "Sem acesso à lead", _instruction: "A lead não existe ou está fora do escopo de dados deste utilizador." };
      }
      if (args.client_id && !await canAccessClient(ctx, args.client_id)) {
        return { error: "Sem acesso ao cliente", _instruction: "O cliente não existe ou está fora do escopo de dados deste utilizador." };
      }
      const { data, error } = await ctx.supabaseAdmin
        .from("calendar_events")
        .insert({
          organization_id: ctx.orgId,
          user_id: ctx.userId,
          title: args.title,
          start_time: args.start_time,
          end_time: args.end_time || null,
          description: args.description || null,
          event_type: args.event_type || "meeting",
          lead_id: args.lead_id || null,
          client_id: args.client_id || null,
          reminder_minutes: Number.isFinite(Number(args.reminder_minutes)) ? Number(args.reminder_minutes) : null,
        })
        .select("id, title, start_time, end_time")
        .single();
      if (error) return { error: error.message, _instruction: "ERRO ao criar evento. Não afirmes que foi criado." };
      return { success: true, event: data, _instruction: "Evento criado. Confirma com o utilizador. [link:Ver Agenda|/calendar]" };
    },
  },
  {
    name: "create_marketing_contact",
    description: "Criar contacto de marketing. Não envia emails.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome" },
        email: { type: "string", description: "Email" },
        phone: { type: "string", description: "Telefone" },
        company: { type: "string", description: "Empresa" },
        subscribed: { type: "boolean", description: "Aceita receber marketing. Default: true" },
      },
      required: ["name"],
    },
    permission: { module: "marketing", subarea: "templates", action: "create" },
    isWrite: true,
    execute: async (args, ctx) => {
      const { data, error } = await ctx.supabaseAdmin
        .from("marketing_contacts")
        .insert({
          organization_id: ctx.orgId,
          name: args.name,
          email: args.email || null,
          phone: args.phone || null,
          company: args.company || null,
          source: "otto",
          subscribed: args.subscribed !== false,
        })
        .select("id, name, email, subscribed")
        .single();
      if (error) return { error: error.message, _instruction: "ERRO ao criar contacto. Não afirmes que foi criado." };
      return { success: true, contact: data, _instruction: "Contacto de marketing criado. Confirma com o utilizador. [link:Ver Marketing|/marketing]" };
    },
  },
];
