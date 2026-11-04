// Support tools: fetch the user's own contact data and submit a support ticket.
// The ticket flow is "smart": context (org, module) is enriched automatically and
// contact data is pulled from the DB, so Otto only asks for what is genuinely
// missing and confirms once before submitting.
import type { Tool } from "../types.ts";

const SUPPORT_WHATSAPP = "351939135114";

// Map a free-text priority onto the values the DB column is known to accept.
function normalizePriority(p?: string): "low" | "medium" | "high" {
  const v = (p || "").toLowerCase();
  if (["critical", "urgent", "critico", "crítico", "high", "alta", "alto"].includes(v)) return "high";
  if (["low", "baixa", "baixo"].includes(v)) return "low";
  return "medium";
}

export const supportTools: Tool[] = [
  {
    name: "get_my_contact_info",
    module: "support",
    description: "Obter os dados de contacto do utilizador atual (nome, email) já guardados. Usa ANTES de pedir dados para o ticket, para só perguntares o que falta.",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const { data: contactProfile } = await ctx.supabaseAdmin
        .from("profiles").select("full_name").eq("id", ctx.userId).maybeSingle();
      let userEmail: string | null = null;
      try {
        const { data: authUser } = await ctx.supabaseAdmin.auth.admin.getUserById(ctx.userId!);
        userEmail = authUser?.user?.email || null;
      } catch { /* ignore */ }
      const contactName = contactProfile?.full_name || null;
      const missing: string[] = [];
      if (!contactName) missing.push("name");
      if (!userEmail) missing.push("email");
      missing.push("whatsapp"); // not stored on profiles — always confirm
      return {
        name: contactName,
        email: userEmail,
        whatsapp: null,
        missing_fields: missing,
        _instruction: `Dados encontrados: Nome=${contactName || "EM FALTA"}, Email=${userEmail || "EM FALTA"}, WhatsApp=EM FALTA. Pede só os campos em falta, e depois mostra UM resumo para confirmação antes de submeter.`,
      };
    },
  },
  {
    name: "submit_support_ticket",
    module: "support",
    description: "Submeter um ticket de suporte. O módulo/contexto é inferido automaticamente da conversa. Usa APENAS após o utilizador confirmar o resumo.",
    parameters: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Assunto curto do ticket (infere da conversa)" },
        description: { type: "string", description: "Descrição detalhada do problema" },
        priority: { type: "string", description: "Prioridade inferida: low, medium, high (critical→high)" },
        module: { type: "string", description: "Módulo afetado, inferido do contexto (ex: InvoiceXpress, Leads, Faturação)" },
        contact_name: { type: "string", description: "Nome do utilizador" },
        contact_whatsapp: { type: "string", description: "WhatsApp do utilizador (com indicativo)" },
        contact_email: { type: "string", description: "Email do utilizador" },
      },
      required: ["subject", "description", "contact_name", "contact_whatsapp", "contact_email"],
    },
    isWrite: true,
    execute: async (args, ctx) => {
      const priority = normalizePriority(args.priority);
      const module = args.module || "Geral";

      // Enrich the description with auto-detected context.
      const enrichedDescription =
        `${args.description}\n\n— Contexto automático —\n` +
        `Módulo: ${module}\n` +
        `Organização: ${ctx.org.name}\n` +
        `Nicho: ${ctx.org.niche || "n/d"}`;

      const insertRow: Record<string, any> = {
        organization_id: ctx.orgId,
        user_id: ctx.userId,
        subject: args.subject,
        description: enrichedDescription,
        priority,
      };
      if (ctx.attachmentPaths && ctx.attachmentPaths.length > 0) {
        insertRow.attachments = ctx.attachmentPaths;
      }

      const { data: ticket, error } = await ctx.supabaseAdmin
        .from("support_tickets")
        .insert(insertRow)
        .select("id, ticket_code, created_at")
        .single();
      if (error) {
        console.error("Ticket insert error:", error);
        return { error: error.message, _instruction: "ERRO ao criar ticket. Informa o utilizador que houve um problema técnico." };
      }

      const createdAt = new Date(ticket.created_at).toLocaleString("pt-PT", { timeZone: "Europe/Lisbon" });
      const waMessage =
        `🎫 *TICKET ${ticket.ticket_code}*\n\n` +
        `*Org:* ${ctx.org.name}\n\n` +
        `📞 *DADOS DE CONTACTO:*\n` +
        `*Nome:* ${args.contact_name}\n` +
        `*WhatsApp:* ${args.contact_whatsapp}\n` +
        `*Email:* ${args.contact_email}\n\n` +
        `*Assunto:* ${args.subject}\n` +
        `*Módulo:* ${module}\n` +
        `*Descrição:* ${args.description}\n` +
        `*Prioridade:* ${priority}\n` +
        `*Data:* ${createdAt}`;
      const waUrl = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(waMessage)}`;

      return {
        success: true,
        ticket_code: ticket.ticket_code,
        whatsapp_url: waUrl,
        _instruction: `Ticket criado! Informa: "Ticket **${ticket.ticket_code}** registado com sucesso! Clica no botão abaixo para enviar os detalhes ao suporte via WhatsApp." [whatsapp:📩 Enviar Ticket via WhatsApp|${waUrl}] Depois informa que pode acompanhar em **Definições > Suporte**. [link:Ver Tickets|/settings]`,
      };
    },
  },
];
