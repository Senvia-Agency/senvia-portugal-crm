import { createClient as createAttachmentClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { loadAttachmentParts } from './lib/attachments.ts';
import { userRateLimit } from '../_shared/user-rate-limit.ts';
// otto — Otto 2.0 platform agent. Modular successor to otto-chat:
//   * registry-based tools (read + write + onboarding + support)
//   * auto mode detection (onboarding vs support) from real org state
//   * permission-gated, audited write actions
//   * model/provider configurable via env (defaults to Gemini 2.5 Flash)
//   * progressive SSE streaming of the final answer
//
// Runs ALONGSIDE the legacy otto-chat (which still serves production) until the
// frontend is cut over. See agent_docs and OTTO_2_TESTING.md.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { paidQuota } from "../_shared/paid-quota.ts";
import { boundedJson, ottoInput } from "../_shared/paid-input.ts";
import { corsHeaders, jsonError, streamText } from "./lib/cors.ts";
import { loadContext } from "./lib/context.ts";
import { buildSystemPrompt } from "./lib/prompts.ts";
import { getAIConfigs, chatCompletionResilient } from "./lib/ai.ts";
import { ALL_TOOLS, getToolsForModel, canUseTool, runTool } from "./lib/tools/registry.ts";

const MAX_ITERATIONS = 5;

const MODULE_LABELS: Record<string, string> = {
  clients: "Clientes", leads: "Leads", finance: "Finanças", sales: "Vendas",
  proposals: "Propostas", calendar: "Agenda", marketing: "Marketing",
  ecommerce: "E-commerce", settings: "Definições",
};

function normalizeToolCalls(message: any): any[] {
  if (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) return message.tool_calls;
  if (Array.isArray(message?.toolCalls) && message.toolCalls.length > 0) return message.toolCalls;

  const legacyCall = message?.function_call || message?.functionCall;
  if (legacyCall?.name) {
    return [{
      id: `call_${crypto.randomUUID().replace(/-/g, "")}`,
      type: "function",
      function: {
        name: legacyCall.name,
        arguments: typeof legacyCall.arguments === "string"
          ? legacyCall.arguments
          : JSON.stringify(legacyCall.arguments || legacyCall.args || {}),
      },
    }];
  }

  return [];
}

function fallbackTextFromToolResult(conversationMessages: any[]): string | null {
  const lastTool = [...conversationMessages].reverse().find((m) => m?.role === "tool" && typeof m.content === "string");
  if (!lastTool) return null;

  let data: any;
  try {
    data = JSON.parse(lastTool.content);
  } catch {
    return null;
  }

  if (data?.error) {
    if (Array.isArray(data.candidates) && data.candidates.length > 0) {
      const rows = data.candidates.slice(0, 5).map((item: any) => {
        const code = item.code || item.id || "sem referência";
        const value = item.total_value ? ` · ${item.total_value}€` : "";
        const status = item.status ? ` · ${item.status}` : "";
        return `- **${code}**${value}${status}`;
      }).join("\n");
      return `${data.error}:\n${rows}\n\n[botao:Escolher venda][botao:Pesquisar de novo]`;
    }
    return `${data.error}\n\n[botao:Pesquisar de novo][botao:Abrir suporte]`;
  }

  if (data?.sale) {
    const sale = data.sale;
    const payments = Array.isArray(data.payments) ? data.payments : [];
    const seller = sale.seller_name ? `\n- Comercial: **${sale.seller_name}**` : "";
    const client = sale.client_name ? `\n- Cliente: **${sale.client_name}**` : "";
    const audit = data.assignment_audit;
    const assignedBy = audit?.changed_by_name
      ? `\n- Última atribuição feita por: **${audit.changed_by_name}**${audit.changed_at ? ` em ${new Date(audit.changed_at).toLocaleString("pt-PT")}` : ""}`
      : "";
    return `Encontrei a venda **${sale.code || sale.id}**:\n\n- Valor: **${sale.total_value}€**\n- Estado: **${sale.status || "sem estado"}**\n- Pagamento: **${sale.payment_status || "sem estado"}**${client}${seller}${assignedBy}\n- Pagamentos registados: **${payments.length}**\n\n[link:Ver Vendas|/sales]`;
  }

  if (data?._instruction && typeof data._instruction === "string" && !data.error) {
    return data._instruction;
  }

  if (Array.isArray(data?.results)) {
    if (data.results.length === 0) return "Não encontrei resultados para essa pesquisa.\n\n[botao:Pesquisar de novo]";
    const rows = data.results.slice(0, 5).map((item: any) => {
      const label = item.code || item.name || item.full_name || item.email || item.id || "resultado";
      const value = item.total_value ? ` · ${item.total_value}€` : "";
      const status = item.status || item.payment_status ? ` · ${item.status || item.payment_status}` : "";
      const seller = item.seller_name ? ` · ${item.seller_name}` : "";
      return `- **${label}**${value}${status}${seller}`;
    }).join("\n");
    return `Encontrei **${data.count ?? data.results.length}** resultado(s):\n\n${rows}`;
  }

  if (data?.success) return "Feito com sucesso.";
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonError("Método não permitido", 405);

  try {
    const parsed = ottoInput.safeParse(await boundedJson(req));
    if (!parsed.success) return jsonError("Pedido inválido ou demasiado grande", 400);
    const { messages, organization_id, attachment_paths } = parsed.data;

    let aiConfigs;
    try {
      aiConfigs = getAIConfigs();
    } catch (e) {
      return jsonError((e as Error).message, 500);
    }

    // ── Load context (auth, org, permissions, onboarding, mode) ──
    const { ctx, hasDataAccess } = await loadContext(req, organization_id || null, attachment_paths);
    if (!hasDataAccess || !ctx || !ctx.userId) return jsonError("Sem acesso a esta organização", 403);
    const limitResponse = await userRateLimit(ctx.supabaseAdmin, ctx.userId, 'otto', corsHeaders);
    if (limitResponse) return limitResponse;
    if (!await paidQuota(ctx.supabaseAdmin, `otto:org:${ctx.orgId}`, 300, 86400)) {
      return jsonError("Limite de utilização atingido ou indisponível", 429);
    }

    // Tools available to this user.
    const toolsForModel = (hasDataAccess && ctx)
      ? getToolsForModel({ isAdmin: ctx.isAdmin, permissions: ctx.permissions })
      : [];

    // Which permissioned modules are blocked (for the prompt note).
    let blockedLabels: string[] = [];
    if (hasDataAccess && ctx && !ctx.isAdmin) {
      // Only consider read ("view") tools: a profile that can view a module but
      // not create in it still HAS access to that module's data, so it must not
      // be listed as blocked.
      const blocked = new Set<string>();
      for (const t of ALL_TOOLS) {
        if (t.permission?.action === "view" && !canUseTool(t, { isAdmin: false, permissions: ctx.permissions })) {
          blocked.add(MODULE_LABELS[t.permission.module] || t.permission.module);
        }
      }
      blockedLabels = [...blocked];
    }

    const systemContent = buildSystemPrompt(ctx, { hasDataAccess, blockedLabels });
    let conversationMessages: any[] = [{ role: "system", content: systemContent }, ...messages];
    if (attachment_paths?.length) {
      const attachmentClient = createAttachmentClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: req.headers.get('Authorization')! } }, auth: { persistSession: false },
      });
      let parts;
      try { parts = await loadAttachmentParts(attachmentClient.storage, attachment_paths, ctx.orgId); }
      catch (error) { return jsonError((error as Error).message, 400); }
      if (parts.some(part => part.type === 'file') && !aiConfigs.primary.responses) {
        return jsonError('A leitura de PDF requer a ligação de documentos do Otto. Usa uma imagem ou um ficheiro de texto enquanto essa ligação é configurada.', 422);
      }
      const last = conversationMessages[conversationMessages.length - 1];
      if (last.role !== 'user') return jsonError('Os anexos devem acompanhar uma mensagem tua.', 400);
      last.content = [{ type: 'text', text: last.content }, ...parts];
    }

    // ── Tool-calling loop ──
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const { resp, provider, model } = await chatCompletionResilient(aiConfigs, {
        messages: conversationMessages,
        tools: toolsForModel,
        stream: false,
        temperature: 0,
      });
      const providerHeaders = { "x-otto-provider": provider, "x-otto-model": model };

      if (!resp.ok) {
        const status = resp.status;
        if (status === 429) return jsonError("O Otto está com muitos pedidos. Tenta novamente em alguns segundos.", 429);
        if (status === 402) return jsonError("Créditos de IA esgotados. Contacta o administrador.", 402);
        await resp.body?.cancel();
        console.error("AI gateway error:", { status });
        // Transient gateway/model overload (already retried in chatCompletionResilient):
        // surface a soft "try again" instead of a scary 500.
        if (status >= 500) return jsonError("O Otto está com muita procura neste momento. Tenta novamente em alguns segundos.", 503);
        return jsonError("Erro ao contactar o Otto. Tenta novamente.", 500);
      }

      const result = await resp.json();
      const choice = result.choices?.[0];
      if (!choice) return jsonError("Resposta vazia do modelo.", 500);

      const assistantMessage = choice.message;
      const toolCalls = normalizeToolCalls(assistantMessage);

      // Tool calls → execute and loop.
      if (toolCalls.length > 0) {
        const normalizedAssistantMessage = { ...assistantMessage, tool_calls: toolCalls };
        delete normalizedAssistantMessage.function_call;
        delete normalizedAssistantMessage.functionCall;
        delete normalizedAssistantMessage.toolCalls;
        conversationMessages.push(normalizedAssistantMessage);
        for (const toolCall of toolCalls) {
          const fnName = toolCall.function.name;
          let fnArgs: Record<string, any> = {};
          try { fnArgs = JSON.parse(toolCall.function.arguments || "{}"); } catch { fnArgs = {}; }

          let toolResult: string;
          if (!hasDataAccess || !ctx) {
            toolResult = JSON.stringify({ error: "Sem acesso a dados", _instruction: "O utilizador não está autenticado. Informa-o." });
          } else {
            console.log("otto_tool", { tool: fnName });
            toolResult = await runTool(fnName, fnArgs, ctx);
          }
          conversationMessages.push({ role: "tool", tool_call_id: toolCall.id, content: toolResult });
        }
        continue;
      }

      // Final answer → stream it progressively. We already have the full content
      // (no second model call, so multi-step flows like tickets stay consistent);
      // streamText just chunks it so the client renders word-by-word.
      if (assistantMessage.content) {
        return streamText(assistantMessage.content, providerHeaders);
      }
      const fallback = fallbackTextFromToolResult(conversationMessages);
      if (fallback) return streamText(fallback, providerHeaders);
      return jsonError("Resposta vazia do Otto.", 500);
    }

    return streamText("Peço desculpa, não consegui processar o pedido. Tenta reformular a tua pergunta.");
  } catch (e) {
    console.error("otto error", { kind: e instanceof Error ? e.name : "unknown" });
    return jsonError("Erro ao processar o pedido", 500);
  }
});
